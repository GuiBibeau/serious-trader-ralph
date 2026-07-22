// Pure money math for the perp ticket and position cards. Everything here
// is called per tick from the terminal page's `$:` statements — keep flat
// positional args and zero component state.
import type { DepthLevel, PhoenixMarketConfig } from "$lib/phoenix-market-data";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";

export type TradePreview = {
  notionalUsd: number;
  entry: number | null;
  slippageBps: number | null;
  liqPrice: number | null;
  fundingPer8hUsd: number | null;
  fillable: boolean;
};

export const TP_CHIP_PCTS = [2, 5, 10];
export const SL_CHIP_PCTS = [1, 2, 5];

export function buildTradePreview(
  side: "buy" | "sell",
  amountStr: string,
  leverage: number,
  type: "market" | "limit",
  limitStr: string,
  askLevels: DepthLevel[],
  bidLevels: DepthLevel[],
  refPrice: number | null,
  fundingPct: number | null,
): TradePreview | null {
  const notionalUsd = Number(amountStr);
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  const levels = side === "buy" ? askLevels : bidLevels;
  const best = levels[0]?.price ?? refPrice ?? null;

  let entry = best;
  let slippageBps: number | null = null;
  let fillable = true;

  if (type === "limit") {
    const limit = Number(limitStr);
    if (Number.isFinite(limit) && limit > 0) entry = limit;
  } else if (levels.length > 0 && best) {
    let remaining = notionalUsd;
    let cost = 0;
    let qty = 0;
    for (const level of levels) {
      const levelNotional = level.price * level.size;
      const take = Math.min(remaining, levelNotional);
      qty += take / level.price;
      cost += take;
      remaining -= take;
      if (remaining <= 0) break;
    }
    fillable = remaining <= 0;
    const avg = qty > 0 ? cost / qty : best;
    entry = avg;
    slippageBps = best > 0 ? Math.abs((avg - best) / best) * 10_000 : null;
  }

  const liqPrice =
    entry && leverage > 0
      ? side === "buy"
        ? entry * (1 - 1 / leverage)
        : entry * (1 + 1 / leverage)
      : null;
  const fundingPer8hUsd =
    fundingPct != null ? (fundingPct / 100) * notionalUsd : null;

  return {
    notionalUsd,
    entry,
    slippageBps,
    liqPrice,
    fundingPer8hUsd,
    fillable,
  };
}

export function clampLeverage(value: number): number {
  return Math.max(1, Math.min(20, Math.round(value)));
}

// Plain Number()-parseable price string, precision scaled to magnitude.
export function fmtTriggerPrice(value: number): string {
  if (value >= 1000) return value.toFixed(1);
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  if (value >= 0.01 || value <= 0) return value.toFixed(5);
  // Sub-cent (meme) prices: 5 fixed decimals destroy the value
  // (0.00004821 -> 0.00005). Keep 4 significant digits, still plain
  // decimals — this string round-trips through Number() in the ticket.
  const zeros = Math.max(0, -Math.floor(Math.log10(value)) - 1);
  return value.toFixed(Math.min(12, zeros + 4)).replace(/0+$/, "");
}

// Shared isolated-margin liquidation price estimate. Pure: given a signed
// size, entry, margin, and maintenance margin ratio, returns the price at
// which the subaccount's equity hits the maintenance floor — or null when
// the inputs are degenerate (flat, non-finite, zero entry, zeroed
// denominator) or the position is over-collateralized past zero (estimate
// ≤ 0). Extracted verbatim from enrichPosition's formula so the live
// position card and the paper ledger's tick agree on a single liq curve.
export function liquidationPriceEstimate(
  entry: number,
  size: number,
  margin: number,
  maintenanceMarginRatio: number,
): number | null {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(size) ||
    !Number.isFinite(margin) ||
    !Number.isFinite(maintenanceMarginRatio) ||
    entry === 0 ||
    size === 0
  ) {
    return null;
  }
  const denom = size - maintenanceMarginRatio * Math.abs(size);
  if (denom === 0) return null;
  const estimate = (entry * size - margin) / denom;
  return Number.isFinite(estimate) && estimate > 0 ? estimate : null;
}

// The trader API stopped shipping uPnL/liq per position; reconstruct
// client-side: uPnL from live mids, liq from the isolated subaccount's
// margin with an estimated maintenance ratio (half the initial margin at
// max leverage). Labeled "est." wherever rendered.
export function enrichPosition(
  position: PhoenixPosition,
  mark: number | null,
  marketConfig: PhoenixMarketConfig | undefined,
): PhoenixPosition {
  const entry = position.entryPrice;
  const upnl =
    mark !== null && entry !== null
      ? (mark - entry) * position.size
      : position.unrealizedPnl;
  const mmr = marketConfig?.maxLeverage
    ? 0.5 / marketConfig.maxLeverage
    : 0.005;
  const margin = position.marginUsd;
  let liq: number | null = position.liquidationPrice;
  if (entry !== null && margin !== null && position.size !== 0) {
    // Recomputed estimate replaces the input liq — including null when the
    // position is over-collateralized past zero (no finite positive liq).
    liq = liquidationPriceEstimate(entry, position.size, margin, mmr);
  }
  return { ...position, unrealizedPnl: upnl, liquidationPrice: liq };
}

// Risk-based sizing: notional from stop distance, guarded by a 5 bps
// minimum stop distance so a stop at the entry can't size to infinity.
export function riskNotional(
  riskUsd: number,
  entry: number,
  stop: number,
): number | null {
  return riskUsd > 0 &&
    stop > 0 &&
    entry > 0 &&
    Math.abs(entry - stop) > entry * 0.0005
    ? (riskUsd * entry) / Math.abs(entry - stop)
    : null;
}

export function liqDistancePct(
  position: PhoenixPosition,
  mark: number | null,
): number | null {
  if (mark === null || position.liquidationPrice === null || mark === 0) {
    return null;
  }
  return (Math.abs(mark - position.liquidationPrice) / mark) * 100;
}

// Factor core of the TP/SL quick-set chips: TP moves with the trade side,
// SL against it.
export function triggerPriceForPct(
  ref: number,
  side: "buy" | "sell",
  pct: number,
  kind: "tp" | "sl",
): number {
  const factor =
    kind === "tp"
      ? side === "buy"
        ? 1 + pct / 100
        : 1 - pct / 100
      : side === "buy"
        ? 1 - pct / 100
        : 1 + pct / 100;
  return ref * factor;
}

// The Phoenix ix API requires an execution price beside every TP/SL trigger
// (400 without it); it becomes the triggered close order's limit price.
// Mirror the SDK's executionPriceFromSlippageBps semantics in USD: an "ask"
// close (long position) gets a limit floor below the trigger, a "bid" close
// (short) a ceiling above. The band only binds when price gaps through the
// trigger — otherwise the close fills at the trigger or better.
export function tpSlExecutionPrice(
  triggerUsd: number,
  closeSide: "ask" | "bid",
  slippageBps: number,
): number {
  const band = slippageBps / 10_000;
  return closeSide === "ask"
    ? triggerUsd * (1 - band)
    : triggerUsd * (1 + band);
}

// Busy key for one order row — finer than the side-wide `cancel:SYM:SIDE`
// so cancelling one order never greys out its neighbours.
export function orderCancelKey(order: PhoenixOpenOrder): string {
  return `cancel:${order.symbol}:${order.side}:${order.isStopLoss ? "sl" : order.orderSequenceNumber}`;
}
