import type { LadderRow } from "./orderbook-ladder";

export type DepthCurvePoint = {
  price: number;
  cumulativeSize: number;
};

export type DepthChartModel = {
  bids: DepthCurvePoint[];
  asks: DepthCurvePoint[];
  totalBidSize: number;
  totalAskSize: number;
  spreadAbs: number | null;
  imbalance: number | null;
  sequence: number | null;
};

export function buildDepthChartModel(input: {
  bids: LadderRow[];
  asks: LadderRow[];
  sequence: number | null;
}): DepthChartModel {
  const bids = input.bids
    .map((row) => ({
      price: row.price,
      cumulativeSize: row.cumulativeSize,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.price) &&
        point.price > 0 &&
        Number.isFinite(point.cumulativeSize) &&
        point.cumulativeSize >= 0,
    );

  const asks = input.asks
    .map((row) => ({
      price: row.price,
      cumulativeSize: row.cumulativeSize,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.price) &&
        point.price > 0 &&
        Number.isFinite(point.cumulativeSize) &&
        point.cumulativeSize >= 0,
    );

  const bestBid = bids[0] ?? null;
  const bestAsk = asks[0] ?? null;
  const spreadAbs =
    bestBid && bestAsk ? Math.max(0, bestAsk.price - bestBid.price) : null;
  const totalBidSize = bids[bids.length - 1]?.cumulativeSize ?? 0;
  const totalAskSize = asks[asks.length - 1]?.cumulativeSize ?? 0;
  const depthTotal = totalBidSize + totalAskSize;
  const imbalance =
    depthTotal > 0 ? (totalBidSize - totalAskSize) / depthTotal : null;

  return {
    bids,
    asks,
    totalBidSize,
    totalAskSize,
    spreadAbs,
    imbalance,
    sequence: input.sequence,
  };
}

export function findNearestDepthPoint(
  points: DepthCurvePoint[],
  price: number,
): DepthCurvePoint | null {
  let nearest: DepthCurvePoint | null = null;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const delta = Math.abs(point.price - price);
    if (delta < nearestDelta) {
      nearest = point;
      nearestDelta = delta;
    }
  }
  return nearest;
}
