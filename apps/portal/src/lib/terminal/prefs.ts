// Terminal preference/layout persistence — storage keys, the pref
// serializer, and the pure parse/merge cores. The page keeps thin
// loadPrefs/loadLayout appliers that assign whatever parsePrefs returns;
// everything here is testable without a DOM.

import {
  PHOENIX_TIMEFRAMES,
  type PhoenixTimeframe,
} from "$lib/phoenix-market-data";

export const PREFS_STORAGE_KEY = "trader-ralph-terminal/prefs/v1";
export const ALERTS_STORAGE_KEY = "trader-ralph-terminal/alerts/v1";
export const LAYOUT_STORAGE_KEY = "trader-ralph-terminal/layout/v1";
export const CACHE_PANELS = "trader-ralph-terminal/cache/panels/v1";
export const CACHE_NEWS = "trader-ralph-terminal/cache/news/v1";
export const CACHE_MARKETS = "trader-ralph-terminal/cache/markets/v1";
export const CACHE_READS = "trader-ralph-terminal/cache/reads/v1";
export const CACHE_MAX_AGE = 30 * 60_000;
export const MARKETS_MAX_AGE = 24 * 60 * 60_000;
export const ALERT_LOG_KEY = "trader-ralph-alert-log";
export const ONBOARD_KEY = "trader-ralph-terminal/phx-referral/v2";

// Draggable dashboard: reorderable info panels (chart + book stay anchored).
// "monitor" is the markets-monitor panel; "markets" is the Phoenix markets
// list. Old payloads persisted both as "markets" — migrateLayout in
// $lib/terminal/layout maps the first occurrence to "monitor".
export const DEFAULT_PANEL_ORDER = [
  "watch",
  "monitor",
  "perp",
  "spot",
  "screener",
  "macro",
  "fred",
  "etf",
  "stablecoins",
  "oil",
  "events",
  "ideas",
  "markets",
  "journal",
];

export const SECTION_LINKS: { id: string; label: string }[] = [
  { id: "section-chart", label: "Chart" },
  { id: "section-book", label: "Book" },
  { id: "section-perp", label: "Perp" },
  { id: "section-markets", label: "Markets" },
  { id: "section-macro", label: "Macro" },
];

export type TerminalPrefs = {
  symbol: string;
  timeframe: PhoenixTimeframe;
  priceMode: "last" | "mark";
  chartScale: "price" | "percent";
  chartAxisMode: "linear" | "log";
  visibleCandleCount: number;
  tradeMode: "spot";
  spotAssetId: string;
  watchlist: string[];
  screenSort: "movers" | "volume" | "cap";
  screenHub: "all" | "crypto" | "equities" | "pre-ipo";
  sizingMode: "usd" | "risk";
  tradeAmount: string;
  tradeRiskUsd: string;
  tradeLeverage: number;
};

/**
 * Validate a raw localStorage prefs payload into the subset of fields that
 * pass the same whitelists loadPrefs applied inline — every branch below is
 * the original condition, field for field. Unknown/invalid fields are simply
 * absent from the result.
 */
export function parsePrefs(raw: string | null): Partial<TerminalPrefs> {
  const prefs: Partial<TerminalPrefs> = {};
  if (!raw) return prefs;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return prefs; // malformed persisted preferences — ignore
  }
  if (data === null || typeof data !== "object") return prefs;
  if (typeof data.symbol === "string") prefs.symbol = data.symbol;
  if (PHOENIX_TIMEFRAMES.includes(data.timeframe as PhoenixTimeframe)) {
    prefs.timeframe = data.timeframe as PhoenixTimeframe;
  }
  if (data.priceMode === "last" || data.priceMode === "mark") {
    prefs.priceMode = data.priceMode;
  }
  if (data.chartScale === "price" || data.chartScale === "percent") {
    prefs.chartScale = data.chartScale;
  }
  if (data.chartAxisMode === "linear" || data.chartAxisMode === "log") {
    prefs.chartAxisMode = data.chartAxisMode;
  }
  if (
    typeof data.visibleCandleCount === "number" &&
    Number.isFinite(data.visibleCandleCount)
  ) {
    prefs.visibleCandleCount = data.visibleCandleCount;
  }
  if (data.tradeMode === "spot") prefs.tradeMode = "spot";
  if (typeof data.spotAssetId === "string")
    prefs.spotAssetId = data.spotAssetId;
  if (Array.isArray(data.watchlist)) {
    prefs.watchlist = data.watchlist
      .filter((sym): sym is string => typeof sym === "string")
      .map((sym) => sym.toUpperCase())
      .slice(0, 24);
  }
  if (
    data.screenSort === "movers" ||
    data.screenSort === "volume" ||
    data.screenSort === "cap"
  ) {
    prefs.screenSort = data.screenSort;
  }
  if (
    data.screenHub === "all" ||
    data.screenHub === "crypto" ||
    data.screenHub === "equities" ||
    data.screenHub === "pre-ipo"
  ) {
    prefs.screenHub = data.screenHub;
  }
  if (data.sizingMode === "usd" || data.sizingMode === "risk") {
    prefs.sizingMode = data.sizingMode;
  }
  if (typeof data.tradeAmount === "string")
    prefs.tradeAmount = data.tradeAmount;
  if (typeof data.tradeRiskUsd === "string") {
    prefs.tradeRiskUsd = data.tradeRiskUsd;
  }
  if (
    typeof data.tradeLeverage === "number" &&
    [1, 2, 5, 10, 20].includes(data.tradeLeverage)
  ) {
    prefs.tradeLeverage = data.tradeLeverage;
  }
  return prefs;
}

/**
 * Merge a saved panel order against the defaults: keep saved ids that still
 * exist, append any defaults the save predates, drop unknown ids. Guards
 * layout migration across releases.
 */
export function mergeLayout(saved: unknown, defaults: string[]): string[] {
  if (!Array.isArray(saved)) return [...defaults];
  const known = saved.filter(
    (id): id is string => typeof id === "string" && defaults.includes(id),
  );
  const missing = defaults.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export function persistPrefs(
  _symbol: string,
  _timeframe: PhoenixTimeframe,
  _priceMode: "last" | "mark",
  _scale: "price" | "percent",
  _axis: "linear" | "log",
  _visible: number,
  _tradeMode: "perps" | "spot",
  _spotAssetId: string | null,
  _watchlist: string[],
  _screenSort: string,
  _screenHub: string,
  _sizingMode: string,
  _tradeAmount: string,
  _tradeRiskUsd: string,
  _tradeLeverage: number,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        symbol: _symbol,
        timeframe: _timeframe,
        priceMode: _priceMode,
        chartScale: _scale,
        chartAxisMode: _axis,
        visibleCandleCount: _visible,
        tradeMode: _tradeMode,
        spotAssetId: _spotAssetId,
        watchlist: _watchlist,
        screenSort: _screenSort,
        screenHub: _screenHub,
        sizingMode: _sizingMode,
        tradeAmount: _tradeAmount,
        tradeRiskUsd: _tradeRiskUsd,
        tradeLeverage: _tradeLeverage,
      }),
    );
  } catch {
    // storage may be unavailable (private mode, quota) — non-fatal
  }
}
