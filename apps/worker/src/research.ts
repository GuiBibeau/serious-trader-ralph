import type { JupiterClient } from "./jupiter";
import type { NormalizedPolicy } from "./policy";
import { enforcePolicy } from "./policy";
import type { SolanaRpc } from "./solana_rpc";
import type { MarketSnapshot } from "./types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_DECIMALS = 9n;

function clampDecimals(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Avoid pathological padStart sizes.
  return Math.max(0, Math.min(18, Math.floor(n)));
}

function formatAtomic(amount: bigint, decimals: number, precision = 2): string {
  const d = clampDecimals(decimals, 0);
  const p = Math.max(0, Math.min(18, Math.floor(precision)));
  if (d === 0 || p === 0) return amount.toString();
  const base = 10n ** BigInt(d);
  const intPart = amount / base;
  const fracPart = amount % base;
  const fracStr = fracPart.toString().padStart(d, "0");
  const shown = fracStr.slice(0, p).padEnd(p, "0");
  return `${intPart.toString()}.${shown}`;
}

export async function gatherMarketSnapshot(
  rpc: SolanaRpc,
  jupiter: JupiterClient,
  wallet: string,
  policy: NormalizedPolicy,
  opts?: { quoteMint?: string; quoteDecimals?: number },
): Promise<MarketSnapshot> {
  const quoteMint = opts?.quoteMint ?? USDC_MINT;
  const quoteDecimals = clampDecimals(opts?.quoteDecimals, 6);

  const [solBalanceLamports, quoteBalanceAtomic] = await Promise.all([
    rpc.getBalanceLamports(wallet),
    rpc.getTokenBalanceAtomic(wallet, quoteMint),
  ]);

  // Price oracle: 1 SOL → quoteMint
  const oneSolLamports = (10n ** SOL_DECIMALS).toString();
  const priceQuote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: quoteMint,
    amount: oneSolLamports,
    slippageBps: Math.max(1, policy.slippageBps),
    swapMode: "ExactIn",
  });
  enforcePolicy(policy, priceQuote);

  const quotePerSolAtomic = BigInt(priceQuote.outAmount || "0");
  // SOL value in quote atomic
  const solValueQuoteAtomic =
    (solBalanceLamports * quotePerSolAtomic) / 10n ** SOL_DECIMALS;
  const totalQuoteAtomic = solValueQuoteAtomic + quoteBalanceAtomic;
  const baseAllocationPct =
    totalQuoteAtomic > 0n
      ? Number((solValueQuoteAtomic * 10000n) / totalQuoteAtomic) / 100
      : 0;

  return {
    ts: new Date().toISOString(),
    baseMint: SOL_MINT,
    quoteMint,
    quoteDecimals,
    baseBalanceAtomic: solBalanceLamports.toString(),
    quoteBalanceAtomic: quoteBalanceAtomic.toString(),
    basePriceQuote: formatAtomic(quotePerSolAtomic, quoteDecimals, 2),
    portfolioValueQuote: formatAtomic(totalQuoteAtomic, quoteDecimals, 2),
    baseAllocationPct: Math.round(baseAllocationPct * 100) / 100,
  };
}
