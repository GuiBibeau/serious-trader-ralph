import { buildAndSignPrivySwapTransaction } from "./privy_swap_builder";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

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

export async function executeJupiterSwap(
  input: ExecuteSwapInput,
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

  const {
    signedBase64,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    txBuiltAt,
  } = await buildAndSignPrivySwapTransaction({
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

  if (policy.simulateOnly) {
    const sim = await rpc.simulateTransactionBase64(signedBase64, {
      commitment: policy.commitment,
      sigVerify: true,
    });
    const simulatedAt = nowIso();
    const ok = !sim.err;
    log(ok ? "info" : "warn", "tx simulated", {
      ok,
      err: sim.err ?? null,
      unitsConsumed: sim.unitsConsumed ?? null,
    });
    return {
      status: ok ? "simulated" : "simulate_error",
      signature: null,
      usedQuote,
      refreshed,
      lastValidBlockHeight,
      err: sim.err ?? null,
      executionMeta: {
        route,
        classification: ok ? "simulated" : "error",
        trace: {
          txBuiltAt,
          simulatedAt,
          ...(ok ? {} : { failedAt: simulatedAt }),
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
