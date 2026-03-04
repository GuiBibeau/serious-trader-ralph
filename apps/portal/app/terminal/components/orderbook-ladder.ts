import type { RealtimeDepthLevel } from "./realtime-transport";

export type LadderSide = "bid" | "ask";

export type LadderRow = {
  side: LadderSide;
  price: number;
  size: number;
  cumulativeSize: number;
  isTopOfBook: boolean;
};

export type LadderViewModel = {
  bids: LadderRow[];
  asks: LadderRow[];
  bestBid: LadderRow | null;
  bestAsk: LadderRow | null;
  spreadAbs: number | null;
  spreadBps: number | null;
  tickSize: number;
};

function sortRows(rows: LadderRow[], side: LadderSide): LadderRow[] {
  const sorted = [...rows].sort((a, b) =>
    side === "ask" ? a.price - b.price : b.price - a.price,
  );
  let cumulativeSize = 0;
  return sorted.map((row, index) => {
    cumulativeSize += row.size;
    return {
      ...row,
      cumulativeSize,
      isTopOfBook: index === 0,
    };
  });
}

function groupPrice(
  price: number,
  tickSize: number,
  side: LadderSide,
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return null;
  const grouped =
    side === "ask"
      ? Math.ceil(price / tickSize) * tickSize
      : Math.floor(price / tickSize) * tickSize;
  if (!Number.isFinite(grouped) || grouped <= 0) return null;
  return Number(grouped.toFixed(8));
}

function normalizeTickSize(
  bids: RealtimeDepthLevel[],
  asks: RealtimeDepthLevel[],
  groupingBps: number,
): number {
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid =
    bestBid && bestAsk
      ? (bestBid + bestAsk) / 2
      : (bestBid ?? bestAsk ?? Number.NaN);
  if (!Number.isFinite(mid) || mid <= 0) return 0.000001;
  const bps = Number.isFinite(groupingBps) ? Math.max(1, groupingBps) : 5;
  const raw = mid * (bps / 10_000);
  return Math.max(0.000001, Number(raw.toFixed(8)));
}

function buildRows(
  levels: RealtimeDepthLevel[],
  side: LadderSide,
  tickSize: number,
  maxRows: number,
): LadderRow[] {
  const grouped = new Map<number, number>();
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size)) continue;
    if (level.price <= 0 || level.size <= 0) continue;
    const groupedPrice = groupPrice(level.price, tickSize, side);
    if (groupedPrice === null) continue;
    grouped.set(groupedPrice, (grouped.get(groupedPrice) ?? 0) + level.size);
  }
  const rows = [...grouped.entries()].map(([price, size]) => ({
    side,
    price,
    size,
    cumulativeSize: 0,
    isTopOfBook: false,
  }));
  const sorted = sortRows(rows, side);
  return sorted.slice(0, Math.max(1, maxRows));
}

export function buildOrderbookLadder(input: {
  bids: RealtimeDepthLevel[];
  asks: RealtimeDepthLevel[];
  groupingBps: number;
  maxRows?: number;
}): LadderViewModel {
  const maxRows = Number.isFinite(input.maxRows)
    ? Math.max(1, Math.floor(input.maxRows ?? 10))
    : 10;
  const tickSize = normalizeTickSize(input.bids, input.asks, input.groupingBps);
  const asks = buildRows(input.asks, "ask", tickSize, maxRows);
  const bids = buildRows(input.bids, "bid", tickSize, maxRows);
  const bestAsk = asks[0] ?? null;
  const bestBid = bids[0] ?? null;
  const spreadAbs =
    bestAsk && bestBid ? Math.max(0, bestAsk.price - bestBid.price) : null;
  const spreadBps =
    spreadAbs !== null && bestAsk && bestBid
      ? (spreadAbs / ((bestAsk.price + bestBid.price) / 2)) * 10_000
      : null;
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    spreadAbs,
    spreadBps:
      spreadBps !== null && Number.isFinite(spreadBps) ? spreadBps : null,
    tickSize,
  };
}
