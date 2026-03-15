import { signTransactionWithPrivyById } from "../privy";
import {
  resolveJupiterConditionalSpotOrder,
  summarizeJupiterTriggerOrder,
} from "./jupiter_trigger";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteJupiterConditionalSpotOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readsFalsyExecutionParam(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
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

function buildSyntheticQuote(input: {
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
}): ExecuteSwapResult["usedQuote"] {
  return {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmount: input.makingAmount,
    outAmount: input.takingAmount,
    priceImpactPct: 0,
    routePlan: [],
  };
}

export async function executeJupiterConditionalSpotOrder(
  input: ExecuteJupiterConditionalSpotOrderInput,
  deps?: {
    signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  },
): Promise<ExecuteSwapResult> {
  const route = "jupiter";
  const resolved = resolveJupiterConditionalSpotOrder(input.intent);
  const usedQuote = buildSyntheticQuote({
    inputMint: resolved.inputMint,
    outputMint: resolved.outputMint,
    makingAmount: resolved.makingAmount,
    takingAmount: resolved.takingAmount,
  });
  const simulatedLifecycle = summarizeJupiterTriggerOrder({
    order: "pending-order",
    status: resolved.orderType === "trigger" ? "Triggered" : "Open",
    makingAmount: resolved.makingAmount,
    takingAmount: resolved.takingAmount,
  }).lifecycle;

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
        lifecycle: simulatedLifecycle,
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
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "simulated",
        lifecycle: simulatedLifecycle,
      },
    };
  }

  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }
  if (input.guardEnabled) await input.guardEnabled();

  const createResponse = await input.jupiter.createTriggerOrder({
    inputMint: resolved.inputMint,
    outputMint: resolved.outputMint,
    maker: input.intent.wallet,
    payer: input.intent.wallet,
    params: {
      makingAmount: resolved.makingAmount,
      takingAmount: resolved.takingAmount,
      triggerCondition: resolved.triggerCondition,
      slippageBps: "50",
    },
  });
  const txBuiltAt = nowIso();
  const signedBase64 = await (
    deps?.signTransactionWithPrivyById ?? signTransactionWithPrivyById
  )(input.env, input.privyWalletId, createResponse.transaction);

  const safeEvaluation = evaluateSafeLaneTransaction({
    env: input.env,
    signedTransactionBase64: signedBase64,
  });
  if (!safeEvaluation.ok) {
    const failedAt = nowIso();
    return {
      status: "simulate_error",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      err: {
        code: "policy-denied",
        reason: safeEvaluation.reason,
        profile: safeEvaluation.profile,
        limits: safeEvaluation.limits,
      },
      executionMeta: {
        route,
        classification: "error",
        intentId: createResponse.requestId,
        venueSessionId: createResponse.order,
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

  const requireSimulation = !readsFalsyExecutionParam(
    input.execution?.params?.requireSimulation,
  );
  let simulatedAt: string | undefined;
  if (requireSimulation) {
    const sim = await input.rpc.simulateTransactionBase64(signedBase64, {
      commitment: input.policy.commitment,
      sigVerify: true,
    });
    simulatedAt = nowIso();
    if (sim.err) {
      return {
        status: "simulate_error",
        signature: null,
        usedQuote,
        refreshed: false,
        lastValidBlockHeight: null,
        err: {
          code: "policy-denied",
          reason: "safe-lane-simulation-failed",
          simulationError: sim.err,
        },
        executionMeta: {
          route,
          classification: "error",
          intentId: createResponse.requestId,
          venueSessionId: createResponse.order,
          lifecycle: {
            orderState: "rejected",
            fillState: "failed",
            settlementState: "failed",
            notes: ["safe-lane-simulation-failed"],
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

  const signature = await input.rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: input.policy.skipPreflight,
    preflightCommitment: input.policy.commitment,
  });
  const sentAt = nowIso();
  const confirmation = await input.rpc.confirmSignature(signature, {
    commitment: input.policy.commitment,
  });
  const confirmedAt = nowIso();
  const resultStatus = confirmation.ok
    ? normalizeConfirmationStatus(confirmation.status)
    : "error";
  const uncertainCreateSubmission =
    resultStatus === "error" &&
    typeof signature === "string" &&
    signature !== "";
  const summary = summarizeJupiterTriggerOrder({
    order: createResponse.order,
    status: resolved.orderType === "trigger" ? "Triggered" : "Open",
    makingAmount: resolved.makingAmount,
    takingAmount: resolved.takingAmount,
    openTx: signature,
  });

  return {
    status: resultStatus,
    signature,
    usedQuote,
    refreshed: false,
    lastValidBlockHeight: null,
    ...(confirmation.ok
      ? {}
      : {
          err: confirmation.err ?? {
            code: "submission-failed",
            reason: "trigger-create-confirmation-failed",
          },
        }),
    executionMeta: {
      route,
      classification:
        resultStatus === "finalized"
          ? "finalized"
          : resultStatus === "confirmed"
            ? "confirmed"
            : resultStatus === "processed"
              ? "landed"
              : "error",
      intentId: createResponse.requestId,
      venueSessionId: createResponse.order,
      lifecycle:
        resultStatus === "error" && !uncertainCreateSubmission
          ? {
              orderState: "rejected",
              fillState: "failed",
              settlementState: "failed",
              notes: ["trigger-create-confirmation-failed"],
            }
          : {
              ...summary.lifecycle,
              ...(uncertainCreateSubmission
                ? {
                    notes: [
                      ...(summary.lifecycle.notes ?? []),
                      "trigger-create-confirmation-pending",
                    ],
                  }
                : {}),
            },
      trace: {
        txBuiltAt,
        ...(simulatedAt ? { simulatedAt } : {}),
        sentAt,
        ...(resultStatus === "processed" ||
        resultStatus === "confirmed" ||
        resultStatus === "finalized"
          ? { landedAt: confirmedAt }
          : {}),
        ...(resultStatus === "confirmed" || resultStatus === "finalized"
          ? { confirmedAt }
          : {}),
        ...(resultStatus === "finalized" ? { finalizedAt: confirmedAt } : {}),
        ...(resultStatus === "error" ? { failedAt: confirmedAt } : {}),
      },
    },
  };
}
