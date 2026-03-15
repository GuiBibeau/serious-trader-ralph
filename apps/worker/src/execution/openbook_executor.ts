import { OpenBookClient, type OpenBookOrderOptions } from "../openbook";
import { signTransactionWithPrivyById } from "../privy";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteOpenBookClobOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

type OpenBookExecutorDeps = {
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function isSafeLaneExecution(input: ExecuteOpenBookClobOrderInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function buildLifecycle(input: {
  note: string;
  requestId: string;
  marketAddress: string;
  openOrdersAccount: string;
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  return {
    orderState: "open",
    fillState: "pending",
    settlementState: "confirmed",
    notes: [
      input.note,
      `client-order-id:${input.requestId}`,
      `market:${input.marketAddress}`,
      `open-orders:${input.openOrdersAccount}`,
    ],
  };
}

function readOpenBookOptions(
  intent: NonSwapExecutionIntent,
): OpenBookOrderOptions | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params as OpenBookOrderOptions;
}

function allowsVenueTxSmokeLiveBypass(
  input: ExecuteOpenBookClobOrderInput,
): boolean {
  return (
    input.runtimeMode === "live" &&
    input.experimentalLiveModeBypass === "venue_tx_smoke" &&
    input.subjectControlBypassReason === "strategy_lab_readiness_canary"
  );
}

export async function executeOpenBookClobOrder(
  input: ExecuteOpenBookClobOrderInput,
  deps: OpenBookExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "clob_order") {
    throw new Error("invalid-openbook-intent-family");
  }
  if (input.intent.venueKey !== "openbook") {
    throw new Error("invalid-openbook-venue");
  }
  if (input.intent.marketType !== "spot") {
    throw new Error("invalid-openbook-market-type");
  }
  if (input.intent.side !== "buy" && input.intent.side !== "sell") {
    throw new Error("invalid-openbook-side");
  }
  const allowVenueTxSmokeLiveBypass = allowsVenueTxSmokeLiveBypass(input);
  if (input.runtimeMode === "live" && !allowVenueTxSmokeLiveBypass) {
    throw new Error("openbook-live-mode-not-supported");
  }

  const route = "openbook_v2";
  const rpcEndpoint = String(input.env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("rpc-endpoint-missing");
  }
  const openbook =
    input.openbook ?? new OpenBookClient(rpcEndpoint, undefined, undefined);

  const plan = await openbook.buildPlaceOrderPlan({
    walletPublicKey: input.intent.wallet,
    instrumentId: input.intent.instrumentId,
    side: input.intent.side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    options: readOpenBookOptions(input.intent),
  });
  const lifecycle = buildLifecycle({
    note: `openbook-${plan.request.orderType}`,
    requestId: plan.request.clientOrderId,
    marketAddress: plan.market.marketAddress,
    openOrdersAccount: plan.prerequisites.openOrdersAccount,
  });

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: plan.quotePreview,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "dry_run",
        venueSessionId: plan.prerequisites.openOrdersAccount,
        intentId: plan.request.clientOrderId,
        lifecycle,
        trace: {
          txBuiltAt: nowIso(),
        },
      },
    };
  }

  if (!input.privyWalletId) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: plan.quotePreview,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        venueSessionId: plan.prerequisites.openOrdersAccount,
        intentId: plan.request.clientOrderId,
        lifecycle: {
          ...lifecycle,
          notes: [...(lifecycle.notes ?? []), "unsigned-plan-only"],
        },
        trace: {
          txBuiltAt: nowIso(),
        },
      },
    };
  }

  if (input.guardEnabled) await input.guardEnabled();

  const txBuiltAt = nowIso();
  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const signedBase64 = await signWithPrivy(
    input.env,
    input.privyWalletId,
    plan.unsignedTransactionBase64,
  );

  if (isSafeLaneExecution(input)) {
    const evaluateSafeLane =
      deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;
    const safeEvaluation = evaluateSafeLane({
      env: input.env,
      signedTransactionBase64: signedBase64,
    });
    if (!safeEvaluation.ok) {
      const failedAt = nowIso();
      return {
        status: "simulate_error",
        signature: null,
        usedQuote: plan.quotePreview,
        refreshed: false,
        lastValidBlockHeight: plan.lastValidBlockHeight,
        err: {
          code: "policy-denied",
          reason: safeEvaluation.reason,
          profile: safeEvaluation.profile,
          limits: safeEvaluation.limits,
        },
        executionMeta: {
          route,
          classification: "error",
          venueSessionId: plan.prerequisites.openOrdersAccount,
          intentId: plan.request.clientOrderId,
          lifecycle: {
            orderState: "rejected",
            fillState: "failed",
            settlementState: "failed",
            notes: [safeEvaluation.reason],
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
    input.runtimeMode === "shadow" ||
    input.runtimeMode === "paper" ||
    input.runtimeMode === "live" ||
    input.policy.simulateOnly ||
    readsTruthyExecutionParam(input.execution?.params?.requireSimulation);

  if (!requiresSimulation) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: plan.quotePreview,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        venueSessionId: plan.prerequisites.openOrdersAccount,
        intentId: plan.request.clientOrderId,
        lifecycle,
        trace: {
          txBuiltAt,
        },
      },
    };
  }

  const simulation = await input.rpc.simulateTransactionBase64(signedBase64, {
    commitment: preflightCommitment,
    sigVerify: true,
  });
  const simulatedAt = nowIso();
  if (simulation.err) {
    return {
      status: "simulate_error",
      signature: null,
      usedQuote: plan.quotePreview,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      err: simulation.err,
      executionMeta: {
        route,
        classification: "error",
        venueSessionId: plan.prerequisites.openOrdersAccount,
        intentId: plan.request.clientOrderId,
        lifecycle: {
          orderState: "rejected",
          fillState: "failed",
          settlementState: "failed",
          notes: ["openbook-simulation-failed"],
        },
        trace: {
          txBuiltAt,
          simulatedAt,
          failedAt: simulatedAt,
        },
      },
    };
  }

  if (
    input.runtimeMode === "shadow" ||
    input.runtimeMode === "paper" ||
    input.policy.simulateOnly
  ) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: plan.quotePreview,
      refreshed: false,
      lastValidBlockHeight: plan.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        venueSessionId: plan.prerequisites.openOrdersAccount,
        intentId: plan.request.clientOrderId,
        lifecycle,
        trace: {
          txBuiltAt,
          simulatedAt,
        },
      },
    };
  }

  const signature = await input.rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: input.policy.skipPreflight,
    preflightCommitment,
  });
  const sentAt = nowIso();
  const confirmation = await input.rpc.confirmSignature(signature, {
    commitment: input.policy.commitment,
  });
  const confirmedAt = nowIso();

  const status = confirmation.ok
    ? confirmation.status === "finalized"
      ? "finalized"
      : confirmation.status === "confirmed"
        ? "confirmed"
        : confirmation.status === "processed"
          ? "processed"
          : "error"
    : "error";

  return {
    status,
    signature,
    usedQuote: plan.quotePreview,
    refreshed: false,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    ...(confirmation.ok ? {} : { err: confirmation.err ?? null }),
    executionMeta: {
      route,
      classification:
        status === "finalized"
          ? "finalized"
          : status === "confirmed"
            ? "confirmed"
            : status === "processed"
              ? "submitted"
              : "error",
      venueSessionId: plan.prerequisites.openOrdersAccount,
      intentId: plan.request.clientOrderId,
      lifecycle:
        status === "error"
          ? {
              orderState: "rejected",
              fillState: "failed",
              settlementState: "failed",
              notes: ["openbook-live-submit-failed"],
            }
          : {
              ...lifecycle,
              orderState: "accepted",
              settlementState:
                status === "finalized" ? "finalized" : "confirmed",
            },
      trace: {
        txBuiltAt,
        simulatedAt,
        sentAt,
        confirmedAt,
        ...(status === "finalized" ? { finalizedAt: confirmedAt } : {}),
        ...(status === "error" ? { failedAt: confirmedAt } : {}),
      },
    },
  };
}
