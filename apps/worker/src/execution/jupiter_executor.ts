import { buildAndSignPrivySwapTransaction } from "./privy_swap_builder";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

type JupiterExecutorDeps = {
  buildAndSignPrivySwapTransaction?: typeof buildAndSignPrivySwapTransaction;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isSafeLaneExecution(input: ExecuteSwapInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
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

export async function executeJupiterSwap(
  input: ExecuteSwapInput,
  deps: JupiterExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  const route = "jupiter";
  const {
    env,
    policy,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
    guardEnabled,
  } = input;

  if (policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: quoteResponse,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
      },
    };
  }

  if (guardEnabled) await guardEnabled();
  const buildAndSign =
    deps.buildAndSignPrivySwapTransaction ?? buildAndSignPrivySwapTransaction;
  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;

  const {
    signedBase64,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    txBuiltAt,
  } = await buildAndSign({
    env,
    policy,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
    execution: input.execution,
    guardEnabled,
  });

  const safeLane = isSafeLaneExecution(input);
  if (safeLane) {
    const safeEvaluation = evaluateSafeLane({
      env,
      signedTransactionBase64: signedBase64,
    });
    log(safeEvaluation.ok ? "info" : "warn", "safe lane tx guardrails", {
      ok: safeEvaluation.ok,
      reason: safeEvaluation.ok ? null : safeEvaluation.reason,
      profile: safeEvaluation.profile,
      limits: safeEvaluation.limits,
    });
    if (!safeEvaluation.ok) {
      const deniedAt = nowIso();
      return {
        status: "simulate_error",
        signature: null,
        usedQuote,
        refreshed,
        lastValidBlockHeight,
        err: {
          code: "policy-denied",
          reason: safeEvaluation.reason,
          profile: safeEvaluation.profile,
          limits: safeEvaluation.limits,
        },
        executionMeta: {
          route,
          classification: "error",
          trace: {
            txBuiltAt,
            failedAt: deniedAt,
          },
        },
      };
    }
  }

  const requiresSimulation =
    safeLane ||
    policy.simulateOnly ||
    readsTruthyExecutionParam(input.execution?.params?.requireSimulation);
  let simulatedAt: string | undefined;
  if (requiresSimulation) {
    const sim = await rpc.simulateTransactionBase64(signedBase64, {
      commitment: policy.commitment,
      sigVerify: true,
    });
    simulatedAt = nowIso();
    const ok = !sim.err;
    log(ok ? "info" : "warn", "tx simulated", {
      ok,
      err: sim.err ?? null,
      unitsConsumed: sim.unitsConsumed ?? null,
      lane: safeLane ? "safe" : "default",
    });
    if (!ok) {
      return {
        status: "simulate_error",
        signature: null,
        usedQuote,
        refreshed,
        lastValidBlockHeight,
        err: safeLane
          ? {
              code: "policy-denied",
              reason: "safe-lane-simulation-failed",
              simulationError: sim.err ?? null,
            }
          : (sim.err ?? null),
        executionMeta: {
          route,
          classification: "error",
          trace: {
            txBuiltAt,
            simulatedAt,
            failedAt: simulatedAt,
          },
        },
      };
    }
  }

  if (policy.simulateOnly) {
    return {
      status: "simulated",
      signature: null,
      usedQuote,
      refreshed,
      lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        trace: {
          txBuiltAt,
          ...(simulatedAt ? { simulatedAt } : {}),
        },
      },
    };
  }

  if (guardEnabled) await guardEnabled();

  const signature = await rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: policy.skipPreflight,
    preflightCommitment: policy.commitment,
  });
  const sentAt = nowIso();

  log("info", "tx submitted", {
    signature,
    lastValidBlockHeight,
  });

  const confirmation = await rpc.confirmSignature(signature, {
    commitment: policy.commitment,
  });
  const finalizedOrConfirmedAt = nowIso();
  const status = confirmation.ok
    ? normalizeConfirmationStatus(confirmation.status)
    : "error";
  log(confirmation.ok ? "info" : "warn", "tx confirmation", {
    signature,
    status,
    err: confirmation.err ?? null,
  });

  return {
    status,
    signature,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    err: confirmation.err ?? null,
    executionMeta: {
      route,
      classification:
        status === "processed"
          ? "landed"
          : status === "confirmed"
            ? "confirmed"
            : status === "finalized"
              ? "finalized"
              : "error",
      trace: {
        txBuiltAt,
        ...(simulatedAt ? { simulatedAt } : {}),
        sentAt,
        ...(status === "processed" ? { landedAt: finalizedOrConfirmedAt } : {}),
        ...(status === "confirmed"
          ? {
              landedAt: finalizedOrConfirmedAt,
              confirmedAt: finalizedOrConfirmedAt,
            }
          : {}),
        ...(status === "finalized"
          ? {
              landedAt: finalizedOrConfirmedAt,
              confirmedAt: finalizedOrConfirmedAt,
              finalizedAt: finalizedOrConfirmedAt,
            }
          : {}),
        ...(status === "error" ? { failedAt: finalizedOrConfirmedAt } : {}),
      },
    },
  };
}
