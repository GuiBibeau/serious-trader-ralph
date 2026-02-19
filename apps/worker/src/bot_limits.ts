import type { BotRow } from "./bots_db";
import { SOL_MINT, USDC_MINT } from "./defaults";
import { JupiterClient } from "./jupiter";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";

const BALANCE_RPC_DEFAULT = "https://api.mainnet-beta.solana.com";
const SOL_ATOMIC_PER_SOL = 1_000_000_000n;
const USDC_ATOMIC_PER_USD = 1_000_000n;

export const MAX_FREE_BOTS = 3;
export const REQUIRED_USD_ATOMIC_FOR_EXTRA_BOTS = 5_000n * USDC_ATOMIC_PER_USD;

export type BotBalanceSummary = {
  botId: string;
  walletAddress: string;
  solLamports: string;
  usdcAtomic: string;
  solUsdAtomic: string;
  totalUsdAtomic: string;
};

export type BotCreationLimits = {
  maxFreeBots: number;
  requiredUsdForExtraBots: string;
  currentUsd: string;
  currentUsdAtomic: string;
  canCreateExtraBot: boolean;
  assetBasis: "sol_usdc_only";
  valuationState: "skipped" | "computed" | "unavailable";
  baselineBotIds: string[];
  breakdown: BotBalanceSummary[];
};

export function pickBaselineBotsForValuation(
  bots: BotRow[],
  limit = MAX_FREE_BOTS,
): BotRow[] {
  return [...bots]
    .sort((a, b) => {
      const byCreated = a.createdAt.localeCompare(b.createdAt);
      if (byCreated !== 0) return byCreated;
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(1, limit));
}

function formatUsdAtomic(amount: bigint): string {
  const isNegative = amount < 0n;
  const abs = isNegative ? amount * -1n : amount;
  const whole = abs / USDC_ATOMIC_PER_USD;
  const fraction = abs % USDC_ATOMIC_PER_USD;
  const hundredth = Number(fraction / 10_000n)
    .toString()
    .padStart(2, "0");
  return `${isNegative ? "-" : ""}${whole.toString()}.${hundredth}`;
}

export function canCreateExtraBotFromAtomic(currentUsdAtomic: bigint): boolean {
  return currentUsdAtomic >= REQUIRED_USD_ATOMIC_FOR_EXTRA_BOTS;
}

async function oneSolInUsdcAtomic(env: Env): Promise<bigint> {
  const jupiter = new JupiterClient(
    env.JUPITER_BASE_URL ?? "https://lite-api.jup.ag",
    env.JUPITER_API_KEY,
  );
  const quote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: SOL_ATOMIC_PER_SOL.toString(),
    slippageBps: 50,
    swapMode: "ExactIn",
  });
  const outAmount = String(quote.outAmount ?? "").trim();
  if (!/^\d+$/.test(outAmount)) {
    throw new Error("bot-limit-valuation-unavailable");
  }
  return BigInt(outAmount);
}

async function fetchUsdBalancesForBots(
  env: Env,
  baselineBots: BotRow[],
): Promise<{ totalUsdAtomic: bigint; breakdown: BotBalanceSummary[] }> {
  const rpc = new SolanaRpc(env.BALANCE_RPC_ENDPOINT || BALANCE_RPC_DEFAULT);
  const solUsdPerSolAtomic = await oneSolInUsdcAtomic(env);

  const breakdown = await Promise.all(
    baselineBots.map(async (bot): Promise<BotBalanceSummary> => {
      const [solLamports, usdcAtomic] = await Promise.all([
        rpc.getBalanceLamports(bot.walletAddress),
        rpc.getTokenBalanceAtomic(bot.walletAddress, USDC_MINT),
      ]);
      const solUsdAtomic =
        (solLamports * solUsdPerSolAtomic) / SOL_ATOMIC_PER_SOL;
      const totalUsdAtomic = solUsdAtomic + usdcAtomic;
      return {
        botId: bot.id,
        walletAddress: bot.walletAddress,
        solLamports: solLamports.toString(),
        usdcAtomic: usdcAtomic.toString(),
        solUsdAtomic: solUsdAtomic.toString(),
        totalUsdAtomic: totalUsdAtomic.toString(),
      };
    }),
  );

  let totalUsdAtomic = 0n;
  for (const row of breakdown) {
    totalUsdAtomic += BigInt(row.totalUsdAtomic);
  }
  return { totalUsdAtomic, breakdown };
}

export async function computeBotCreationLimits(
  env: Env,
  bots: BotRow[],
  opts?: { strictValuation?: boolean },
): Promise<BotCreationLimits> {
  if (bots.length < MAX_FREE_BOTS) {
    return {
      maxFreeBots: MAX_FREE_BOTS,
      requiredUsdForExtraBots: "5000",
      currentUsd: "0.00",
      currentUsdAtomic: "0",
      canCreateExtraBot: true,
      assetBasis: "sol_usdc_only",
      valuationState: "skipped",
      baselineBotIds: pickBaselineBotsForValuation(bots).map((b) => b.id),
      breakdown: [],
    };
  }

  const baselineBots = pickBaselineBotsForValuation(bots);
  try {
    const { totalUsdAtomic, breakdown } = await fetchUsdBalancesForBots(
      env,
      baselineBots,
    );
    return {
      maxFreeBots: MAX_FREE_BOTS,
      requiredUsdForExtraBots: "5000",
      currentUsd: formatUsdAtomic(totalUsdAtomic),
      currentUsdAtomic: totalUsdAtomic.toString(),
      canCreateExtraBot: canCreateExtraBotFromAtomic(totalUsdAtomic),
      assetBasis: "sol_usdc_only",
      valuationState: "computed",
      baselineBotIds: baselineBots.map((b) => b.id),
      breakdown,
    };
  } catch (_error) {
    if (opts?.strictValuation) {
      throw new Error("bot-limit-valuation-unavailable");
    }
    return {
      maxFreeBots: MAX_FREE_BOTS,
      requiredUsdForExtraBots: "5000",
      currentUsd: "0.00",
      currentUsdAtomic: "0",
      canCreateExtraBot: false,
      assetBasis: "sol_usdc_only",
      valuationState: "unavailable",
      baselineBotIds: baselineBots.map((b) => b.id),
      breakdown: [],
    };
  }
}
