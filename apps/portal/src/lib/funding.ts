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
      // "processed" surfaces incoming funds about a slot after they land
      // instead of waiting ~12s for finality — the right trade-off for a
      // balance display (worst case a rolled-back slot briefly overstates).
      params: [
        owner,
        { mint: USDC_MINT },
        { encoding: "jsonParsed", commitment: "processed" },
      ],
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

// ── Jupiter Ultra (RPC-less swaps, gasless-capable) ────────────────────
// Order → sign → execute: Ultra builds the transaction, we sign it with
// the user's wallet, Ultra broadcasts and polls. Routed through the
// same-origin /jupiter proxy (lite-api.jup.ag). Gasless eligibility is
// derived defensively from the order response — a null means "could not
// determine", and callers must treat null as NOT gasless (honest-data
// rule: never promise free gas we can't verify).

export type UltraOrder = {
  requestId: string;
  /** base64 unsigned transaction; null when Ultra returned no route. */
  transaction: string | null;
  inAmount: string | null;
  outAmount: string | null;
  gasless: boolean | null;
  router: string | null;
  raw: Record<string, unknown>;
};

export type UltraExecuteResult = {
  status: string;
  signature: string | null;
  raw: Record<string, unknown>;
};

/** Best-effort gasless detection across Ultra response variants. */
export function deriveUltraGasless(
  raw: Record<string, unknown>,
): boolean | null {
  if (raw.gasless === true) return true;
  if (raw.gasless === false) return false;
  const router = typeof raw.router === "string" ? raw.router.toLowerCase() : "";
  const swapType =
    typeof raw.swapType === "string" ? raw.swapType.toLowerCase() : "";
  // JupiterZ / RFQ routes: the market maker is the fee payer.
  if (
    router.includes("rfq") ||
    router.includes("jupiterz") ||
    swapType === "rfq"
  )
    return true;
  const sigFee = raw.signatureFee ?? raw.signatureFeeLamports;
  if (typeof sigFee === "number") return sigFee === 0;
  return null;
}

export function parseUltraOrder(raw: Record<string, unknown>): UltraOrder {
  return {
    requestId: typeof raw.requestId === "string" ? raw.requestId : "",
    // Live API returns "" (not absent) when there's no signable route —
    // normalize both to null so callers have one no-route signal.
    transaction:
      typeof raw.transaction === "string" && raw.transaction.length > 0
        ? raw.transaction
        : null,
    inAmount: typeof raw.inAmount === "string" ? raw.inAmount : null,
    outAmount: typeof raw.outAmount === "string" ? raw.outAmount : null,
    gasless: deriveUltraGasless(raw),
    router: typeof raw.router === "string" ? raw.router : null,
    raw,
  };
}

export async function getUltraOrder(
  inputMint: string,
  outputMint: string,
  amountAtoms: string,
  taker: string,
  fetcher: typeof fetch = fetch,
): Promise<UltraOrder> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountAtoms,
    taker,
  });
  const response = await fetcher(`/jupiter/ultra/v1/order?${params}`);
  if (!response.ok) throw new Error(`ultra-order-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const order = parseUltraOrder(data);
  if (!order.requestId) throw new Error("ultra-no-request-id");
  return order;
}

export async function executeUltraOrder(
  signedTransactionBase64: string,
  requestId: string,
  fetcher: typeof fetch = fetch,
): Promise<UltraExecuteResult> {
  const response = await fetcher("/jupiter/ultra/v1/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signedTransaction: signedTransactionBase64,
      requestId,
    }),
  });
  if (!response.ok) throw new Error(`ultra-execute-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (status.toLowerCase() === "failed") {
    const err = typeof data.error === "string" ? data.error : "unknown";
    throw new Error(`ultra-execute-failed-${err}`);
  }
  return {
    status,
    signature: typeof data.signature === "string" ? data.signature : null,
    raw: data,
  };
}
