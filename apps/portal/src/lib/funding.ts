// Funding helpers: read the wallet's USDC balance and build Jupiter SOL→USDC
// swaps. Jupiter calls route through the same-origin /jupiter dev proxy.

import { isRecord } from "./utils";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

export async function fetchUsdcBalance(
  rpcUrl: string,
  owner: string,
): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trader-ralph-usdc-balance",
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: USDC_MINT }, { encoding: "jsonParsed" }],
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(`usdc-rpc-${response.status}`);
  const result =
    isRecord(payload) && isRecord(payload.result) ? payload.result : null;
  const accounts = result && Array.isArray(result.value) ? result.value : [];
  let total = 0;
  for (const account of accounts) {
    const ui =
      isRecord(account) &&
      isRecord(account.account) &&
      isRecord(account.account.data) &&
      isRecord(account.account.data.parsed) &&
      isRecord(account.account.data.parsed.info) &&
      isRecord(account.account.data.parsed.info.tokenAmount)
        ? account.account.data.parsed.info.tokenAmount.uiAmount
        : null;
    if (typeof ui === "number" && Number.isFinite(ui)) total += ui;
  }
  return total;
}

export type JupiterQuote = {
  raw: unknown;
  inSol: number;
  outUsdc: number;
  priceImpactPct: number;
};

export async function getJupiterQuote(
  amountSol: number,
  slippageBps = 50,
): Promise<JupiterQuote> {
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: String(lamports),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
  });
  const response = await fetch(`/jupiter/swap/v1/quote?${params}`);
  if (!response.ok) throw new Error(`jupiter-quote-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const out = Number(data.outAmount);
  return {
    raw: data,
    inSol: amountSol,
    outUsdc: Number.isFinite(out) ? out / 1_000_000 : 0,
    priceImpactPct: Number(data.priceImpactPct ?? 0),
  };
}

export async function getJupiterSwapTransaction(
  quoteResponse: unknown,
  userPublicKey: string,
): Promise<string> {
  const response = await fetch("/jupiter/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!response.ok) throw new Error(`jupiter-swap-${response.status}`);
  const data = (await response.json()) as { swapTransaction?: string };
  if (!data.swapTransaction) throw new Error("jupiter-no-transaction");
  return data.swapTransaction;
}
