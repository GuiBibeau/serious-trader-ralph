import { signTransactionWithPrivyById } from "../privy";
import { swapWithRetry } from "../swap";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

function normalizeConfirmationStatus(
  status: string | undefined,
): Extract<ExecuteSwapResult["status"], "processed" | "confirmed" | "finalized" | "error"> {
  if (status === "processed" || status === "confirmed" || status === "finalized") {
    return status;
  }
  return "error";
}

export async function executeJupiterSwap(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
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
    };
  }

  if (guardEnabled) await guardEnabled();

  const { swap, quoteResponse: usedQuote, refreshed } = await swapWithRetry(
    jupiter,
    quoteResponse,
    userPublicKey,
    policy,
  );

  if (!privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  log("info", "signing transaction", { walletId: privyWalletId });
  const signedBase64 = await signTransactionWithPrivyById(
    env,
    privyWalletId,
    swap.swapTransaction,
  );
  log("info", "transaction signed");

  if (policy.simulateOnly) {
    const sim = await rpc.simulateTransactionBase64(signedBase64, {
      commitment: policy.commitment,
      sigVerify: true,
    });
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
      lastValidBlockHeight: swap.lastValidBlockHeight,
      err: sim.err ?? null,
    };
  }

  if (guardEnabled) await guardEnabled();

  const signature = await rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: policy.skipPreflight,
    preflightCommitment: policy.commitment,
  });

  log("info", "tx submitted", {
    signature,
    lastValidBlockHeight: swap.lastValidBlockHeight,
  });

  const confirmation = await rpc.confirmSignature(signature, {
    commitment: policy.commitment,
  });
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
    lastValidBlockHeight: swap.lastValidBlockHeight,
    err: confirmation.err ?? null,
  };
}
