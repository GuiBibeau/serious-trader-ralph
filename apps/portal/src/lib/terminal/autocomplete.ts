// Ghost suggestions for the perp ticket, derived from honest sources only:
// TP/SL prices from visible chart structure (fractal swing pivots,
// previous-UTC-day high/low) and size/leverage from the user's own local
// journal history. Pure module — no DOM, no network, no Date.now(); callers
// inject candles, journal entries, and the clock. Every suggestion carries
// a provenance string a human can verify against the chart.

import type { JournalEntry } from "$lib/journal";
import type { MarketPoint } from "$lib/phoenix-market-data";
import { fmtTriggerPrice } from "./trade-math";

const DAY_MS = 86_400_000;

export type SwingPoint = { ts: number; price: number; kind: "high" | "low" };

/** N-bar fractal pivots: a bar whose low is strictly the lowest of the
 * `window` bars on each side is a swing low (mirror for highs). Returns
 * chronological order. Incomplete edges (fewer than `window` bars on a
 * side) are never pivots. */
export function detectSwings(
  candles: MarketPoint[],
  window: number,
): SwingPoint[] {
  if (!Number.isInteger(window) || window < 1) return [];
  const swings: SwingPoint[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const bar = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (other.high >= bar.high) isHigh = false;
      if (other.low <= bar.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ ts: bar.ts, price: bar.high, kind: "high" });
    if (isLow) swings.push({ ts: bar.ts, price: bar.low, kind: "low" });
  }
  return swings;
}

export type GhostValue = {
  value: number;
  /** Human-verifiable one-liner, e.g. "0.3% below swing low 76.42" or
   * "prev-day low 75.10 − 0.3%". */
  provenance: string;
  /** Which rule produced it — telemetry dimension. */
  source: "swing" | "prev-day" | "r-multiple" | "journal";
};

/** Ghost stop for a prospective entry. Long: nearest swing low BELOW entry,
 * buffered `bufferPct` further below; short: mirrored above. Falls back to
 * previous-day low/high (same buffer) when no qualifying swing exists.
 * Returns null when neither source exists — never invent. */
export function ghostStop(
  candles: MarketPoint[],
  side: "buy" | "sell",
  entryPrice: number,
  opts: {
    window: number;
    bufferPct: number;
    prevDayHigh: number | null;
    prevDayLow: number | null;
  },
): GhostValue | null {
  const swings = detectSwings(candles, opts.window);
  const long = side === "buy";
  const kind = long ? "low" : "high";
  let nearest: SwingPoint | null = null;
  for (const swing of swings) {
    if (swing.kind !== kind) continue;
    if (long ? swing.price >= entryPrice : swing.price <= entryPrice) continue;
    if (
      nearest === null ||
      (long ? swing.price > nearest.price : swing.price < nearest.price)
    ) {
      nearest = swing;
    }
  }
  if (nearest !== null) {
    return {
      value: bufferedStop(nearest.price, long, opts.bufferPct),
      provenance: long
        ? `${opts.bufferPct}% below swing low ${fmtTriggerPrice(nearest.price)}`
        : `${opts.bufferPct}% above swing high ${fmtTriggerPrice(nearest.price)}`,
      source: "swing",
    };
  }
  const prevDayLevel = long ? opts.prevDayLow : opts.prevDayHigh;
  if (
    prevDayLevel !== null &&
    (long ? prevDayLevel < entryPrice : prevDayLevel > entryPrice)
  ) {
    return {
      value: bufferedStop(prevDayLevel, long, opts.bufferPct),
      provenance: long
        ? `prev-day low ${fmtTriggerPrice(prevDayLevel)} − ${opts.bufferPct}%`
        : `prev-day high ${fmtTriggerPrice(prevDayLevel)} + ${opts.bufferPct}%`,
      source: "prev-day",
    };
  }
  return null;
}

function bufferedStop(level: number, long: boolean, bufferPct: number): number {
  return long ? level * (1 - bufferPct / 100) : level * (1 + bufferPct / 100);
}

/** Ghost take-profit. Primary: nearest opposing swing beyond entry (swing
 * high above for longs, swing low below for shorts). Fallback: `rMultiple`
 * × the stop distance when a stop value is provided. Null when neither
 * applies. */
export function ghostTakeProfit(
  candles: MarketPoint[],
  side: "buy" | "sell",
  entryPrice: number,
  stopPrice: number | null,
  opts: { window: number; rMultiple: number },
): GhostValue | null {
  const swings = detectSwings(candles, opts.window);
  const long = side === "buy";
  const kind = long ? "high" : "low";
  let nearest: SwingPoint | null = null;
  for (const swing of swings) {
    if (swing.kind !== kind) continue;
    if (long ? swing.price <= entryPrice : swing.price >= entryPrice) continue;
    if (
      nearest === null ||
      (long ? swing.price < nearest.price : swing.price > nearest.price)
    ) {
      nearest = swing;
    }
  }
  if (nearest !== null) {
    return {
      value: nearest.price,
      provenance: `nearest swing ${kind} ${fmtTriggerPrice(nearest.price)}`,
      source: "swing",
    };
  }
  if (stopPrice !== null) {
    const stopDistance = Math.abs(entryPrice - stopPrice);
    if (stopDistance > 0) {
      const value = long
        ? entryPrice + opts.rMultiple * stopDistance
        : entryPrice - opts.rMultiple * stopDistance;
      if (value > 0) {
        return {
          value,
          provenance: `${opts.rMultiple}R from stop ${fmtTriggerPrice(stopPrice)}`,
          source: "r-multiple",
        };
      }
    }
  }
  return null;
}

export type GhostSizing = {
  notionalUsd: number;
  leverage: number;
  provenance: string; // e.g. "median of your last 12 SOL-PERP trades"
  sampleSize: number;
};

/** Median notional + modal leverage from the user's own journal entries for
 * `symbol` (perp/Phoenix venue entries only). Requires >= minSample entries;
 * null below that — a ghost from 2 trades is noise, not history. */
export function ghostSizing(
  entries: JournalEntry[],
  symbol: string,
  minSample: number,
): GhostSizing | null {
  const notionals: number[] = [];
  const leverages: number[] = [];
  for (const entry of entries) {
    if (entry.venue !== "perp" || entry.symbol !== symbol) continue;
    const { notionalUsd, leverage } = entry;
    if (notionalUsd === null || !Number.isFinite(notionalUsd)) continue;
    if (notionalUsd <= 0) continue;
    if (leverage === null || !Number.isFinite(leverage)) continue;
    notionals.push(notionalUsd);
    leverages.push(leverage);
  }
  const sampleSize = notionals.length;
  if (sampleSize < Math.max(1, minSample)) return null;

  const sorted = [...notionals].sort((a, b) => a - b);
  const mid = Math.floor(sampleSize / 2);
  const notionalUsd =
    sampleSize % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const counts = new Map<number, number>();
  for (const value of leverages) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let leverage = leverages[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    // Ties break to the higher frequency, then the LOWER leverage.
    if (count > bestCount || (count === bestCount && value < leverage)) {
      leverage = value;
      bestCount = count;
    }
  }

  return {
    notionalUsd,
    leverage,
    provenance: `median of your last ${sampleSize} ${symbol} trades`,
    sampleSize,
  };
}

export type StructureLevels = {
  prevDayHigh: number | null;
  prevDayLow: number | null;
  swings: SwingPoint[];
};

/** Previous-UTC-day high/low from candles (null when the loaded history
 * does not cover the full previous UTC day — honest absence, never a
 * partial-day value passed off as PDH/PDL) plus detectSwings output.
 * `nowMs` injected for determinism. Coverage means the history reaches
 * back to (or before) the previous day's UTC open AND forward into the
 * current UTC day. */
export function structureLevels(
  candles: MarketPoint[],
  window: number,
  nowMs: number,
): StructureLevels {
  const swings = detectSwings(candles, window);
  if (candles.length === 0) {
    return { prevDayHigh: null, prevDayLow: null, swings };
  }
  const todayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const prevStartMs = todayStartMs - DAY_MS;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  let high: number | null = null;
  let low: number | null = null;
  for (const candle of candles) {
    if (candle.ts < minTs) minTs = candle.ts;
    if (candle.ts > maxTs) maxTs = candle.ts;
    if (candle.ts >= prevStartMs && candle.ts < todayStartMs) {
      if (high === null || candle.high > high) high = candle.high;
      if (low === null || candle.low < low) low = candle.low;
    }
  }
  const covered = minTs <= prevStartMs && maxTs >= todayStartMs;
  if (!covered) return { prevDayHigh: null, prevDayLow: null, swings };
  return { prevDayHigh: high, prevDayLow: low, swings };
}

export const GHOST_DEFAULTS = {
  swingWindow: 5,
  stopBufferPct: 0.3,
  tpRMultiple: 2,
  sizingMinSample: 5,
} as const;
