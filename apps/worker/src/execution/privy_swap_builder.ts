import type { JupiterQuoteResponse } from "../jupiter";
import { signTransactionWithPrivyById } from "../privy";
import { swapWithRetry } from "../swap";
import type { ExecuteSwapInput } from "./types";

export type BuiltPrivySwapTransaction = {
  signedBase64: string;
  usedQuote: JupiterQuoteResponse;
  refreshed: boolean;
  lastValidBlockHeight: number | null;
  txBuiltAt: string;
};

export async function buildAndSignPrivySwapTransaction(
  input: ExecuteSwapInput,
): Promise<BuiltPrivySwapTransaction> {
  const {
    env,
    policy,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
  } = input;

  if (!privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  const {
    swap,
    quoteResponse: usedQuote,
    refreshed,
  } = await swapWithRetry(jupiter, quoteResponse, userPublicKey, policy);
  const txBuiltAt = new Date().toISOString();

  log("info", "signing transaction", { walletId: privyWalletId });
  const signedBase64 = await signTransactionWithPrivyById(
    env,
    privyWalletId,
    swap.swapTransaction,
  );
  log("info", "transaction signed");

  return {
    signedBase64,
    usedQuote,
    refreshed,
    lastValidBlockHeight: swap.lastValidBlockHeight,
    txBuiltAt,
  };
}
