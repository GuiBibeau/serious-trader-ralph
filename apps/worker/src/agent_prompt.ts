import type { NormalizedPolicy } from "./policy";
import type { TradeIndexResult } from "./trade_index";
import type { AgentMemory, AgentStrategy, MarketSnapshot } from "./types";

function formatAtomic(amount: string, decimals: number, precision = 4): string {
  let value = 0n;
  try {
    value = BigInt(amount);
  } catch {
    return amount;
  }
  const d = Math.max(0, Math.min(18, Math.floor(decimals)));
  const p = Math.max(0, Math.min(18, Math.floor(precision)));
  if (d === 0 || p === 0) return value.toString();
  const base = 10n ** BigInt(d);
  const intPart = value / base;
  const fracPart = value % base;
  const fracStr = fracPart.toString().padStart(d, "0");
  const shown = fracStr.slice(0, p).padEnd(p, "0");
  return `${intPart.toString()}.${shown}`;
}

export function buildAgentSystemPrompt(input: {
  memory: AgentMemory;
  snapshot: MarketSnapshot;
  recentTrades: TradeIndexResult[];
  strategy: AgentStrategy;
  policy: NormalizedPolicy;
}): string {
  const { memory, snapshot, recentTrades, strategy, policy } = input;

  const maxTradesPerDay = strategy.maxTradesPerDay ?? 5;
  const remaining = Math.max(0, maxTradesPerDay - memory.tradesProposedToday);

  const observationsBlock =
    memory.observations.length > 0
      ? memory.observations
          .map((o) => `[${o.ts}] (${o.category}) ${o.content}`)
          .join("\n")
      : "(none yet)";

  const reflectionsBlock =
    memory.reflections.length > 0
      ? memory.reflections.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none yet)";

  const tradesBlock =
    recentTrades.length > 0
      ? recentTrades
          .map((t) => {
            const sig = t.signature ? ` sig=${t.signature.slice(0, 12)}…` : "";
            return `[${t.createdAt}] ${t.side} ${t.market} size=${t.size ?? "?"} price=${t.price ?? "?"} status=${t.status ?? "?"}${sig}`;
          })
          .join("\n")
      : "(no trades yet)";

  const mandate =
    strategy.mandate ||
    "Build a disciplined trading strategy. Research before acting.";
  const minConfidence = strategy.minConfidence ?? "medium";

  const baseBalanceDisplay = formatAtomic(snapshot.baseBalanceAtomic, 9, 4);
  const quoteBalanceDisplay = formatAtomic(
    snapshot.quoteBalanceAtomic,
    snapshot.quoteDecimals,
    4,
  );

  return `You are Ralph, an autonomous trading agent operating on Solana.
You run in a loop. Each tick you may call tools to observe, research, and act.

YOUR MEMORY (persists between ticks):
Thesis: ${memory.thesis || "No thesis yet. Build one from your observations."}

Recent observations:
${observationsBlock}

Learnings:
${reflectionsBlock}

CURRENT MARKET STATE:
Timestamp: ${snapshot.ts}
Base mint: ${snapshot.baseMint} (native SOL)
Quote mint: ${snapshot.quoteMint} (decimals=${snapshot.quoteDecimals})
SOL balance: ${snapshot.baseBalanceAtomic} lamports (${baseBalanceDisplay} SOL)
Quote balance: ${snapshot.quoteBalanceAtomic} atomic (${quoteBalanceDisplay})
SOL price: ${snapshot.basePriceQuote} quote per SOL
Portfolio value: ${snapshot.portfolioValueQuote} quote
SOL allocation: ${snapshot.baseAllocationPct}%

Recent trades:
${tradesBlock}

YOUR MANDATE (from the fund manager):
${mandate}

POLICY CONSTRAINTS (non-negotiable):
Allowed mints: ${policy.allowedMints.length > 0 ? policy.allowedMints.join(", ") : "any"}
Max price impact: ${(policy.maxPriceImpactPct * 100).toFixed(1)}%
Slippage tolerance: ${policy.slippageBps} bps
Min SOL reserve (fees/rent): ${policy.minSolReserveLamports} lamports
Simulate-only mode: ${policy.simulateOnly}
Dry run: ${policy.dryRun}
Trades remaining today: ${remaining} of ${maxTradesPerDay}
Minimum trade confidence: ${minConfidence}

TOOL LOOP RULES:
1. You may call tools multiple times in a tick to gather data and validate actions.
2. Execute at most ONE trade per tick (trade_jupiter_swap).
3. When you are done, call control_finish with a concise summary and reasoning.
4. If you are uncertain, gather more data or finish without trading.
5. Amounts are atomic units: lamports for SOL; token atomic units for SPL tokens.`;
}
