import { DFlowClient } from "../dflow";
import { signTransactionWithPrivyById } from "../privy";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteDFlowPredictionOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

type DFlowExecutorDeps = {
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

function nowIso(): string {
  return new Date().toISOString();
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

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function isSafeLaneExecution(input: ExecuteDFlowPredictionOrderInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function allowsVenueTxSmokeLiveBypass(
  input: ExecuteDFlowPredictionOrderInput,
): boolean {
  return (
    input.runtimeMode === "live" &&
    input.experimentalLiveModeBypass === "venue_tx_smoke" &&
    input.subjectControlBypassReason === "strategy_lab_readiness_canary"
  );
}

function buildLifecycle(input: {
  side: string;
  notes: string[];
  orderState?: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["lifecycle"]["orderState"];
  fillState?: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["lifecycle"]["fillState"];
  positionState?: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["lifecycle"]["positionState"];
  settlementState?: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["lifecycle"]["settlementState"];
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  const closing = input.side === "sell_yes" || input.side === "sell_no";
  return {
    orderState: input.orderState ?? "open",
    fillState: input.fillState ?? "pending",
    positionState: input.positionState ?? (closing ? "closing" : "opening"),
    settlementState: input.settlementState ?? "pending",
    notes: input.notes,
  };
}

function readDFlowOptions(
  intent: NonSwapExecutionIntent,
): Record<string, unknown> | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params;
}

export async function executeDFlowPredictionOrder(
  input: ExecuteDFlowPredictionOrderInput,
  deps: DFlowExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "prediction_order") {
    throw new Error("invalid-dflow-intent-family");
  }
  if (input.intent.venueKey !== "dflow") {
    throw new Error("invalid-dflow-venue");
  }
  if (input.intent.marketType !== "prediction") {
    throw new Error("invalid-dflow-market-type");
  }
  const allowLiveSmoke = allowsVenueTxSmokeLiveBypass(input);
  if (input.runtimeMode === "live" && !allowLiveSmoke) {
    throw new Error("dflow-live-mode-not-supported");
  }
  const side = String(input.intent.side ?? "").trim();
  if (
    side !== "buy_yes" &&
    side !== "buy_no" &&
    side !== "sell_yes" &&
    side !== "sell_no"
  ) {
    throw new Error("invalid-dflow-side");
  }
  const outcomeId = String(input.intent.outcomeId ?? "").trim();
  if (!outcomeId) {
    throw new Error("dflow-outcome-id-required");
  }

  const dflow = input.dflow ?? new DFlowClient(input.env);
  const preview = await dflow.describePredictionIntent({
    instrumentId: input.intent.instrumentId,
    outcomeId,
    side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    options: readDFlowOptions(input.intent),
  });
  const lifecycle = buildLifecycle({
    side,
    notes: preview.notes,
  });
  const usedQuote = dflow.buildSyntheticQuote(preview);
  const referenceSnapshot = {
    marketId: preview.market.marketId,
    title: preview.market.title,
    eventTitle: preview.market.eventTitle,
    marketStatus: preview.market.status,
    endTime: preview.market.endTime,
    settleTime: preview.market.settleTime,
    outcomeSide: preview.outcomeSide,
    outcomeMint: preview.outcomeMint,
    settlementMint: preview.settlementMint,
    priceQuote: preview.priceQuote,
    estimatedNotionalUsd: preview.estimatedNotionalUsd,
    openInterest: preview.marketAccount.openInterest,
    volume: preview.marketAccount.volume,
    redemptionStatus: preview.marketAccount.redemptionStatus,
    liveReady: preview.liveReady,
    orderType: preview.orderType,
    timeInForce: preview.timeInForce,
    quantityMode: preview.quantityMode,
  };

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route: "dflow",
        classification: "dry_run",
        intentId: preview.market.marketId,
        venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.priceQuote === null ? null : String(preview.priceQuote),
          executionDivergenceBps: null,
          snapshot: referenceSnapshot,
        },
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
        route: "dflow",
        classification: "simulated",
        intentId: preview.market.marketId,
        venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.priceQuote === null ? null : String(preview.priceQuote),
          executionDivergenceBps: null,
          snapshot: referenceSnapshot,
        },
        trace: {
          txBuiltAt: nowIso(),
          simulatedAt: nowIso(),
        },
      },
    };
  }

  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  const route = "dflow";
  const safeLane = isSafeLaneExecution(input);
  const txBuiltAt = nowIso();
  const verification =
    side === "buy_yes" || side === "buy_no"
      ? await dflow.verifyPredictionWallet(input.intent.wallet)
      : { verified: true, raw: null };
  if (!verification.verified) {
    throw new Error("dflow-wallet-not-verified");
  }
  const plan = await dflow.buildPredictionOrderTransaction({
    walletPublicKey: input.intent.wallet,
    preview,
  });
  const orderQuote = {
    ...usedQuote,
    inputMint: plan.inputMint,
    outputMint: plan.outputMint,
    inAmount: plan.inAmount,
    outAmount: plan.outAmount ?? usedQuote.outAmount,
    ...(plan.routePlan.length > 0 ? { routePlan: plan.routePlan } : {}),
  };

  if (input.guardEnabled) await input.guardEnabled();

  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const signedBase64 = await signWithPrivy(
    input.env,
    input.privyWalletId,
    plan.transactionBase64,
  );

  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;
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
        usedQuote: orderQuote,
        refreshed: false,
        lastValidBlockHeight: plan.lastValidBlockHeight,
        err: {
          code: "policy-denied",
          reason: evaluation.reason,
          profile: evaluation.profile,
          limits: evaluation.limits,
        },
        executionMeta: {
          route,
          classification: "error",
          intentId: preview.market.marketId,
          venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
          lifecycle: buildLifecycle({
            side,
            notes: [evaluation.reason],
            orderState: "rejected",
            fillState: "failed",
            settlementState: "failed",
          }),
          referencePrice: {
            verdict: "allow",
            reason: null,
            executionPrice:
              preview.priceQuote === null ? null : String(preview.priceQuote),
            executionDivergenceBps: null,
            snapshot: referenceSnapshot,
          },
          trace: {
            txBuiltAt,
            failedAt,
          },
        },
      };
    }
  }

  const preflightCommitment =
    input.policy.commitment === "finalized"
      ? "confirmed"
      : input.policy.commitment;
  const requiresSimulation =
    safeLane ||
    input.policy.simulateOnly ||
    readsTruthyExecutionParam(input.execution?.params?.requireSimulation);
  let simulatedAt: string | undefined;
  if (requiresSimulation) {
    const simulation = await input.rpc.simulateTransactionBase64(signedBase64, {
      commitment: preflightCommitment,
      sigVerify: true,
    });
    simulatedAt = nowIso();
    if (simulation.err) {
      return {
        status: "simulate_error",
        signature: null,
        usedQuote: orderQuote,
        refreshed: false,
        lastValidBlockHeight: plan.lastValidBlockHeight,
        err: simulation.err,
        executionMeta: {
          route,
          classification: "error",
          intentId: preview.market.marketId,
          venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
          lifecycle: buildLifecycle({
            side,
            notes: ["simulation-failed"],
            fillState: "failed",
            settlementState: "failed",
          }),
          referencePrice: {
            verdict: "allow",
            reason: null,
            executionPrice:
              preview.priceQuote === null ? null : String(preview.priceQuote),
            executionDivergenceBps: null,
            snapshot: referenceSnapshot,
          },
          trace: {
            txBuiltAt,
            simulatedAt,
            failedAt: simulatedAt,
          },
        },
      };
    }
  }

  if (input.policy.simulateOnly) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: orderQuote,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        intentId: preview.market.marketId,
        venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.priceQuote === null ? null : String(preview.priceQuote),
          executionDivergenceBps: null,
          snapshot: referenceSnapshot,
        },
        trace: {
          txBuiltAt,
          ...(simulatedAt ? { simulatedAt } : {}),
        },
      },
    };
  }

  const sentAt = nowIso();
  const signature = await input.rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: false,
    preflightCommitment,
  });
  const confirmation = await input.rpc.confirmSignature(signature, {
    commitment: input.policy.commitment,
  });
  const terminalAt = nowIso();
  const status = confirmation.ok
    ? normalizeConfirmationStatus(confirmation.status)
    : "error";
  const classification =
    status === "finalized"
      ? "finalized"
      : status === "confirmed"
        ? "confirmed"
        : status === "processed"
          ? "landed"
          : "error";

  return {
    status,
    signature,
    usedQuote: orderQuote,
    refreshed: false,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    ...(confirmation.ok ? {} : { err: confirmation.err ?? null }),
    executionMeta: {
      route,
      classification,
      intentId: preview.market.marketId,
      venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
      lifecycle: buildLifecycle({
        side,
        notes: [
          `executionMode:${plan.executionMode ?? "unknown"}`,
          `inputMint:${plan.inputMint}`,
          `outputMint:${plan.outputMint}`,
        ],
        orderState: confirmation.ok ? "filled" : "rejected",
        fillState: confirmation.ok ? "filled" : "failed",
        positionState:
          confirmation.ok && (side === "buy_yes" || side === "buy_no")
            ? "open"
            : confirmation.ok
              ? "closing"
              : side === "sell_yes" || side === "sell_no"
                ? "closing"
                : "opening",
        settlementState: confirmation.ok
          ? status === "finalized"
            ? "finalized"
            : "confirmed"
          : "failed",
      }),
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice:
          preview.priceQuote === null ? null : String(preview.priceQuote),
        executionDivergenceBps: null,
        snapshot: referenceSnapshot,
      },
      trace: {
        txBuiltAt,
        ...(simulatedAt ? { simulatedAt } : {}),
        sentAt,
        ...(confirmation.ok
          ? {
              landedAt: terminalAt,
              ...(status === "confirmed" || status === "finalized"
                ? { confirmedAt: terminalAt }
                : {}),
              ...(status === "finalized" ? { finalizedAt: terminalAt } : {}),
            }
          : { failedAt: terminalAt }),
      },
      dflowOrder: {
        verification,
        executionMode: plan.executionMode,
        inputMint: plan.inputMint,
        outputMint: plan.outputMint,
        inAmount: plan.inAmount,
        outAmount: plan.outAmount,
        priceImpactPct: plan.priceImpactPct,
        routePlan: plan.routePlan,
      } as Record<string, unknown>,
    },
  };
}
