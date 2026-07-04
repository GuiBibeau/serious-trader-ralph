// Pure chart data/format helpers for the terminal page — candle/volume
// mapping, timeframe math, and the derived header strings. No chart
// handles, no component state.

import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import type {
  MarketPoint,
  PhoenixMarketConfig,
  PhoenixMarketStats,
  PhoenixTimeframe,
} from "$lib/phoenix-market-data";

export const DEFAULT_VISIBLE_CANDLES = 150;
export const MAX_VISIBLE_CANDLES = 180;

export function toCandle(
  point: MarketPoint,
  mode: "last" | "mark",
): CandlestickData<UTCTimestamp> {
  // Mark mode renders the mark-price OHLC series (the smoother series that
  // drives funding/liquidations); falls back to last-trade when absent.
  const useMark = mode === "mark";
  return {
    time: Math.floor(point.ts / 1000) as UTCTimestamp,
    open: useMark ? (point.markOpen ?? point.open) : point.open,
    high: useMark ? (point.markHigh ?? point.high) : point.high,
    low: useMark ? (point.markLow ?? point.low) : point.low,
    close: useMark ? (point.markClose ?? point.close) : point.close,
  };
}

export function toVolume(point: MarketPoint) {
  const up = point.close >= point.open;
  return {
    time: Math.floor(point.ts / 1000) as UTCTimestamp,
    value: point.volumeQuote ?? point.volume ?? 0,
    color: up ? "rgba(44, 233, 127, 0.45)" : "rgba(255, 90, 106, 0.45)",
  };
}

export function timeframeMs(timeframe: PhoenixTimeframe): number {
  if (timeframe.endsWith("m")) return Number(timeframe.slice(0, -1)) * 60_000;
  if (timeframe.endsWith("h")) {
    return Number(timeframe.slice(0, -1)) * 60 * 60_000;
  }
  return 60_000;
}

export function formatCandleCountdown(
  point: MarketPoint | null,
  timeframe: PhoenixTimeframe,
  currentTime: number,
): string {
  if (!point) return "--";
  const duration = timeframeMs(timeframe);
  const remaining = Math.max(0, point.ts + duration - currentTime);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function computeMarketChange(
  price: number | null,
  stats: PhoenixMarketStats | null,
  points: MarketPoint[],
): number | null {
  if (price && stats?.prevDayPx && stats.prevDayPx > 0) {
    return ((price - stats.prevDayPx) / stats.prevDayPx) * 100;
  }
  const latest = points.at(-1);
  const anchor = points.at(-80) ?? points.at(0);
  if (!latest || !anchor || anchor.price <= 0) return null;
  return ((latest.price - anchor.price) / anchor.price) * 100;
}

// formatChartRange runs on every live candle message (chartRangeLabel
// re-derives per chartPoints reassignment); the options never vary, so
// construct the Intl.DateTimeFormat once, lazily.
let chartRangeFormatter: Intl.DateTimeFormat | undefined;

export function formatChartRange(points: MarketPoint[]): string {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return "--";
  chartRangeFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
  return `${chartRangeFormatter.format(first.ts)} - ${chartRangeFormatter.format(last.ts)}`;
}

// Session state for the selected market from its exchange calendar.
export function sessionNote(
  mode: "perps" | "spot",
  market: PhoenixMarketConfig | null,
  nowMs: number,
): string {
  if (mode === "spot") return "24/7 · Jupiter";
  const next = market?.nextTransitionUtc;
  if (!next) return "24/7";
  const ms = Date.parse(next) - nowMs;
  if (!Number.isFinite(ms)) return "24/7";
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  const minutes = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
  const span = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  if (ms <= 0) return "session transition due";
  return market?.marketStatus === "active" ? `closes ${span}` : `opens ${span}`;
}
