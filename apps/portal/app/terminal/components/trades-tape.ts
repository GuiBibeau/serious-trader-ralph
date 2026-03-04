import type { RealtimeTradeTick } from "./realtime-transport";

export type TapeSideFilter = "all" | "buy" | "sell";
export type TapeDisplayMode = "compact" | "expanded";

export function filterTradeTicks(input: {
  trades: RealtimeTradeTick[];
  side: TapeSideFilter;
  minSize: number;
  mode: TapeDisplayMode;
}): RealtimeTradeTick[] {
  const side = input.side;
  const minSize = Number.isFinite(input.minSize)
    ? Math.max(0, input.minSize)
    : 0;
  const maxRows = input.mode === "compact" ? 28 : 80;

  return input.trades
    .filter((trade) => {
      if (side !== "all" && trade.side !== side) return false;
      if (!Number.isFinite(trade.size) || trade.size < minSize) return false;
      return true;
    })
    .slice(0, maxRows);
}

export function countMissingTradeTicks(trades: RealtimeTradeTick[]): number {
  let missed = 0;
  for (let i = 0; i < trades.length - 1; i += 1) {
    const current = trades[i];
    const next = trades[i + 1];
    if (!current || !next) continue;
    const gap = current.seq - next.seq;
    if (gap > 1) {
      missed += gap - 1;
    }
  }
  return missed;
}
