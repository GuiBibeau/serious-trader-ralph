import { DriftClient, type DriftOrderOptions } from "../drift";
import { signTransactionWithPrivyById } from "../privy";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteDriftPerpOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

type DriftLiveModule = typeof import("../drift_live");
type PrepareDriftLivePerpOrder = DriftLiveModule["prepareDriftLivePerpOrder"];
type ReadDriftLiveAccountSnapshot =
  DriftLiveModule["readDriftLiveAccountSnapshot"];

type DriftExecutorDeps = {
  prepareDriftLivePerpOrder?: PrepareDriftLivePerpOrder;
  readDriftLiveAccountSnapshot?: ReadDriftLiveAccountSnapshot;
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

let driftLiveModulePromise: Promise<DriftLiveModule> | null = null;

async function loadDriftLiveModule(): Promise<DriftLiveModule> {
  driftLiveModulePromise ??= import("../drift_live");
  return await driftLiveModulePromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function isSafeLaneExecution(input: ExecuteDriftPerpOrderInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function isVenueTxSmokeLiveBypass(input: ExecuteDriftPerpOrderInput): boolean {
  return (
    input.runtimeMode === "live" &&
    input.experimentalLiveModeBypass === "venue_tx_smoke" &&
    input.subjectControlBypassReason === "strategy_lab_readiness_canary"
  );
}

function normalizeConfirmationStatus(
  status: string | undefined,
): Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized" | "error"
> {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return status;
  }
  return "error";
}

function buildLifecycle(input: {
  side: string;
  note: string;
  positionState?: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["lifecycle"]["positionState"];
  notes?: string[];
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  const closing = input.side === "close_long" || input.side === "close_short";
  return {
    orderState: "open",
    fillState: "pending",
    positionState: input.positionState ?? (closing ? "closing" : "opening"),
    settlementState: "confirmed",
    notes: [input.note, ...(input.notes ?? [])],
  };
}

function readDriftOptions(
  intent: NonSwapExecutionIntent,
): DriftOrderOptions | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params as DriftOrderOptions;
}

function positionStateFromSnapshot(input: {
  side: string;
  afterDirection: "long" | "short" | "flat" | null;
}): NonNullable<
  ExecuteSwapResult["executionMeta"]
>["lifecycle"]["positionState"] {
  if (input.afterDirection === "flat") {
    return input.side === "close_long" || input.side === "close_short"
      ? "closed"
      : "flat";
  }
  return input.side === "close_long" || input.side === "close_short"
    ? "closing"
    : "open";
}

function referenceSnapshot(
  preview: Awaited<ReturnType<DriftClient["describePerpIntent"]>>,
) {
  return {
    marketName: preview.instrument.marketName,
    marketIndex: preview.instrument.marketIndex,
    oracle: preview.instrument.oracle,
    oracleSource: preview.instrument.oracleSource,
    initialMarginRatio: preview.instrument.initialMarginRatio,
    maintenanceMarginRatio: preview.instrument.maintenanceMarginRatio,
    fundingRate1hBps: preview.funding?.fundingRate1hBps ?? null,
    oraclePrice: preview.funding?.oraclePrice ?? null,
    markPrice: preview.funding?.markPrice ?? null,
    reduceOnly: preview.reduceOnly,
    swiftSupported: preview.swiftSupported,
  };
}

export async function executeDriftPerpOrder(
  input: ExecuteDriftPerpOrderInput,
  deps: DriftExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "perp_order") {
    throw new Error("invalid-drift-intent-family");
  }
  if (input.intent.venueKey !== "drift") {
    throw new Error("invalid-drift-venue");
  }
  if (input.intent.marketType !== "perp") {
    throw new Error("invalid-drift-market-type");
  }
  if (
    input.intent.side !== "long" &&
    input.intent.side !== "short" &&
    input.intent.side !== "close_long" &&
    input.intent.side !== "close_short"
  ) {
    throw new Error("invalid-drift-side");
  }

  const allowLiveSmoke = isVenueTxSmokeLiveBypass(input);
  if (input.runtimeMode === "live" && !allowLiveSmoke) {
    throw new Error("drift-live-mode-not-supported");
  }

  const route =
    String(input.execution?.adapter ?? "").trim() === "drift_swift"
      ? "drift_swift"
      : "drift";
  const drift = input.drift ?? new DriftClient(input.env);
  if (route === "drift_swift" && !drift.swiftConfigured()) {
    throw new Error("drift-swift-api-base-missing");
  }

  const preview = await drift.describePerpIntent({
    instrumentId: input.intent.instrumentId,
    side: input.intent.side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    collateralAtomic: input.intent.collateralAtomic ?? null,
    options: readDriftOptions(input.intent),
    executionAdapter: route,
  });
  const usedQuote = drift.buildSyntheticQuote(preview);
  const lifecycle = buildLifecycle({
    side: input.intent.side,
    note: `${route}:${preview.orderType}:${preview.timeInForce}`,
  });
  const routeSessionId =
    preview.instrument.marketIndex === null
      ? null
      : `perp_market:${preview.instrument.marketIndex}`;

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
        intentId: preview.instrument.marketName,
        venueSessionId: routeSessionId,
        lifecycle,
        trace: {
          txBuiltAt: nowIso(),
        },
      },
    };
  }

  if (input.runtimeMode !== "live") {
    if (input.guardEnabled) await input.guardEnabled();
    return {
      status: "simulated",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "simulated",
        intentId: preview.instrument.marketName,
        venueSessionId: routeSessionId,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.funding?.markPrice === null
              ? null
              : String(preview.funding.markPrice),
          executionDivergenceBps: null,
          snapshot: referenceSnapshot(preview),
        },
        trace: {
          txBuiltAt: nowIso(),
          simulatedAt: nowIso(),
        },
      },
    };
  }

  if (route !== "drift") {
    throw new Error("drift-swift-live-mode-not-supported");
  }
  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }
  const rpcEndpoint = String(input.env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("rpc-endpoint-missing");
  }
  const driftLiveModule =
    deps.prepareDriftLivePerpOrder && deps.readDriftLiveAccountSnapshot
      ? null
      : await loadDriftLiveModule();
  const prepareLiveOrder =
    deps.prepareDriftLivePerpOrder ??
    driftLiveModule?.prepareDriftLivePerpOrder;
  const readLiveAccountSnapshot =
    deps.readDriftLiveAccountSnapshot ??
    driftLiveModule?.readDriftLiveAccountSnapshot;
  if (!prepareLiveOrder || !readLiveAccountSnapshot) {
    throw new Error("drift-live-module-unavailable");
  }
  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;
  const safeLane = isSafeLaneExecution(input);
  const txBuiltAt = nowIso();
  let setupSignature: string | null = null;
  let setupAction: string | null = null;

  const submitSignedTransaction = async (
    signedBase64: string,
  ): Promise<{
    status: Extract<
      ExecuteSwapResult["status"],
      "processed" | "confirmed" | "finalized" | "error" | "simulate_error"
    >;
    signature: string | null;
    err: unknown;
    trace: ExecuteSwapResult["executionMeta"]["trace"];
  }> => {
    const preflightCommitment =
      input.runtimeMode === "live" ? "confirmed" : input.policy.commitment;
    if (safeLane) {
      const evaluation = evaluateSafeLane({
        env: input.env,
        signedTransactionBase64: signedBase64,
      });
      if (!evaluation.ok) {
        const failedAt = nowIso();
        return {
          status: "simulate_error",
          signature: null,
          err: {
            code: "policy-denied",
            reason: evaluation.reason,
            profile: evaluation.profile,
            limits: evaluation.limits,
          },
          trace: {
            txBuiltAt,
            failedAt,
          },
        };
      }
    }

    const requireSimulation =
      safeLane ||
      input.policy.simulateOnly ||
      readsTruthyExecutionParam(input.execution?.params?.requireSimulation);
    if (requireSimulation) {
      const simulation = await input.rpc.simulateTransactionBase64(
        signedBase64,
        {
          commitment: preflightCommitment,
          sigVerify: true,
        },
      );
      const simulatedAt = nowIso();
      if (simulation.err) {
        return {
          status: "simulate_error",
          signature: null,
          err: simulation.err,
          trace: {
            txBuiltAt,
            simulatedAt,
            failedAt: simulatedAt,
          },
        };
      }
    }

    const sentAt = nowIso();
    const signature = await input.rpc.sendTransactionBase64(signedBase64, {
      preflightCommitment,
      skipPreflight: false,
      maxRetries: 2,
    });
    const confirmation = await input.rpc.confirmSignature(signature, {
      commitment: input.policy.commitment,
      maxWaitMs: 30_000,
      pollMs: 750,
    });
    const terminalAt = nowIso();
    return {
      status: confirmation.ok
        ? normalizeConfirmationStatus(confirmation.status)
        : "error",
      signature,
      err: confirmation.ok ? null : (confirmation.err ?? null),
      trace: {
        txBuiltAt,
        sentAt,
        ...(confirmation.ok
          ? {
              landedAt: terminalAt,
              ...(confirmation.status === "confirmed" ||
              confirmation.status === "finalized"
                ? { confirmedAt: terminalAt }
                : {}),
              ...(confirmation.status === "finalized"
                ? { finalizedAt: terminalAt }
                : {}),
            }
          : { failedAt: terminalAt }),
      },
    };
  };

  if (input.guardEnabled) await input.guardEnabled();
  let plan = await prepareLiveOrder({
    rpcEndpoint,
    walletPublicKey: input.intent.wallet,
    preview,
  });
  if (plan.setupTransactionBase64) {
    const signedSetup = await signWithPrivy(
      input.env,
      input.privyWalletId,
      plan.setupTransactionBase64,
    );
    const setupResult = await submitSignedTransaction(signedSetup);
    if (
      setupResult.status !== "processed" &&
      setupResult.status !== "confirmed" &&
      setupResult.status !== "finalized"
    ) {
      return {
        status: setupResult.status,
        signature: setupResult.signature,
        usedQuote,
        refreshed: false,
        lastValidBlockHeight: plan.lastValidBlockHeight,
        err: setupResult.err,
        executionMeta: {
          route,
          classification: "error",
          intentId: preview.instrument.marketName,
          venueSessionId: plan.userAccountAddress,
          lifecycle: buildLifecycle({
            side: input.intent.side,
            note: `${route}:setup_failed`,
            notes: [String(plan.setupAction ?? "setup")],
          }),
          referencePrice: {
            verdict: "allow",
            reason: null,
            executionPrice:
              preview.funding?.markPrice === null
                ? null
                : String(preview.funding.markPrice),
            executionDivergenceBps: null,
            snapshot: referenceSnapshot(preview),
          },
          trace: setupResult.trace,
        },
      };
    }
    setupSignature = setupResult.signature;
    setupAction = plan.setupAction;
    plan = await prepareLiveOrder({
      rpcEndpoint,
      walletPublicKey: input.intent.wallet,
      preview,
    });
  }

  if (!plan.orderTransactionBase64) {
    throw new Error("drift-live-order-transaction-missing");
  }

  const signedOrder = await signWithPrivy(
    input.env,
    input.privyWalletId,
    plan.orderTransactionBase64,
  );
  const orderResult = await submitSignedTransaction(signedOrder);
  let snapshotAfter: Awaited<ReturnType<ReadDriftLiveAccountSnapshot>> | null =
    null;
  let snapshotReadError: string | null = null;
  if (orderResult.signature !== null) {
    try {
      snapshotAfter = await readLiveAccountSnapshot({
        rpcEndpoint,
        walletPublicKey: input.intent.wallet,
        instrumentId: preview.instrument.marketName,
      });
    } catch (error) {
      snapshotReadError =
        error instanceof Error ? error.message : String(error ?? "unknown");
    }
  }
  const afterDirection = snapshotAfter?.positionDirection ?? null;
  const classification =
    orderResult.status === "finalized"
      ? "finalized"
      : orderResult.status === "confirmed"
        ? "confirmed"
        : orderResult.status === "processed"
          ? "landed"
          : "error";

  return {
    status: orderResult.status,
    signature: orderResult.signature,
    usedQuote,
    refreshed: false,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    ...(orderResult.err ? { err: orderResult.err } : {}),
    executionMeta: {
      route,
      classification,
      intentId: preview.instrument.marketName,
      venueSessionId: plan.userAccountAddress,
      lifecycle: buildLifecycle({
        side: input.intent.side,
        note: `${route}:${preview.orderType}:${preview.timeInForce}`,
        positionState: positionStateFromSnapshot({
          side: input.intent.side,
          afterDirection,
        }),
        notes: [
          `marketIndex:${plan.marketIndex}`,
          ...(setupSignature ? [`setupSignature:${setupSignature}`] : []),
          ...(setupAction ? [`setupAction:${setupAction}`] : []),
          ...(snapshotReadError
            ? [`snapshotReadError:${snapshotReadError}`]
            : []),
        ],
      }),
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice:
          preview.funding?.markPrice === null
            ? null
            : String(preview.funding.markPrice),
        executionDivergenceBps: null,
        snapshot: referenceSnapshot(preview),
      },
      trace: orderResult.trace,
      driftAccount: {
        before: plan.snapshotBefore,
        after: snapshotAfter,
        setupSignature,
        setupAction,
        snapshotReadError,
      } as Record<string, unknown>,
    },
  };
}
