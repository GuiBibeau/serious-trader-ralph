// Terminal deep-link parsing — the ?asset=&venue=&side=… query contract is
// an external distribution surface (share links, OG cards, partner embeds),
// so its semantics are locked here as a pure parser with tests. The page
// keeps a thin applyDeepLink that assigns the parsed intent to state.
//
// Every rule below reproduces the original inline logic exactly: KNOWN key
// gating, bounds, venue/side normalization, leverage snapping, the
// bookTab/cmd/tab precedence chain, and funds > ticket > alerts overlays.

import {
  PHOENIX_TIMEFRAMES,
  type PhoenixTimeframe,
} from "$lib/phoenix-market-data";

export const DEEP_LINK_KNOWN_PARAMS = [
  "asset",
  "venue",
  "side",
  "size",
  "leverage",
  "type",
  "price",
  "tp",
  "sl",
  "ticket",
  "tf",
  "mode",
  "fund",
  "tab",
  "alerts",
  "cmd",
  "watch",
] as const;

export type TerminalDeepLinkOverlay =
  | { kind: "funds"; tab: "convert" | "phoenix" | null }
  | { kind: "ticket" }
  | { kind: "alerts" };

export type TerminalDeepLinkIntent = {
  venue: "perp" | "spot" | null;
  symbol: string | null; // perp symbol, uppercased, -PERP suffix stripped
  spotAssetId: string | null; // spot asset id, lowercased
  side: "buy" | "sell" | null;
  sizeUsd: number | null;
  leverage: number | null; // already snapped to the select's options
  orderType: "limit" | "market" | null;
  limitPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  bookTab: "book" | "trade" | null;
  timeframe: PhoenixTimeframe | null;
  priceMode: "last" | "mark" | null;
  watchSymbols: string[];
  cmd: string | null;
  overlay: TerminalDeepLinkOverlay | null;
};

/** Snap a requested leverage to the nearest allowed select option. */
export function snapLeverage(value: number, allowed: number[]): number {
  return allowed.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  );
}

/**
 * Parse a location.search string into a deep-link intent, or null when no
 * KNOWN param is present (the caller then skips history.replaceState too —
 * a URL without our params is left untouched).
 */
export function parseTerminalDeepLink(
  search: string,
): TerminalDeepLinkIntent | null {
  const params = new URLSearchParams(search);
  if (!DEEP_LINK_KNOWN_PARAMS.some((key) => params.has(key))) return null;

  const str = (key: string) => params.get(key)?.trim() || null;
  const lower = (key: string) => str(key)?.toLowerCase() ?? null;
  // Positive finite number within sane bounds, else null.
  const numParam = (key: string, max: number): number | null => {
    const value = Number(str(key));
    return Number.isFinite(value) && value > 0 && value <= max ? value : null;
  };
  const flag = (key: string) => {
    const value = lower(key);
    return value !== null && value !== "0" && value !== "false";
  };

  const asset = str("asset");
  const venueRaw = lower("venue");
  const sideRaw = lower("side");
  const isPerp = venueRaw === "perp" || venueRaw === "perps";
  const wantsSell = sideRaw === "sell" || sideRaw === "short";
  const size = numParam("size", 10_000_000);
  const tab = lower("tab");

  const intent: TerminalDeepLinkIntent = {
    venue: null,
    symbol: null,
    spotAssetId: null,
    side: null,
    sizeUsd: null,
    leverage: null,
    orderType: null,
    limitPrice: null,
    takeProfit: null,
    stopLoss: null,
    bookTab: null,
    timeframe: null,
    priceMode: null,
    watchSymbols: [],
    cmd: null,
    overlay: null,
  };

  if (isPerp) {
    intent.venue = "perp";
    if (asset) intent.symbol = asset.toUpperCase().replace(/-PERP$/, "");
    if (sideRaw) intent.side = wantsSell ? "sell" : "buy";
    if (size !== null) intent.sizeUsd = size;

    const leverage = numParam("leverage", 100);
    if (leverage !== null) {
      // Snap to the select's options so the binding displays correctly.
      intent.leverage = snapLeverage(leverage, [1, 2, 5, 10, 20]);
    }

    const limitPrice = numParam("price", 100_000_000);
    const type = lower("type");
    if (limitPrice !== null) {
      intent.orderType = "limit";
      intent.limitPrice = limitPrice;
    } else if (type === "limit" || type === "market") {
      intent.orderType = type;
    }
    const takeProfit = numParam("tp", 100_000_000);
    const stopLoss = numParam("sl", 100_000_000);
    if (takeProfit !== null) intent.takeProfit = takeProfit;
    if (stopLoss !== null) intent.stopLoss = stopLoss;

    intent.bookTab = tab === "book" ? "book" : "trade";
  } else if (asset || venueRaw || sideRaw || size !== null) {
    // Default venue is spot — the broader universe.
    intent.venue = "spot";
    if (asset) intent.spotAssetId = asset.toLowerCase();
    if (sideRaw) intent.side = wantsSell ? "sell" : "buy";
    if (size !== null) intent.sizeUsd = size;
    const spotLimit = numParam("price", 100_000_000);
    if (spotLimit !== null) {
      intent.orderType = "limit";
      intent.limitPrice = spotLimit;
    }
    if (asset || sideRaw || size !== null) {
      intent.bookTab = tab === "book" ? "book" : "trade";
    }
  }
  if (tab === "book" || tab === "trade") intent.bookTab = tab;

  const tf = lower("tf");
  if (PHOENIX_TIMEFRAMES.includes(tf as PhoenixTimeframe)) {
    intent.timeframe = tf as PhoenixTimeframe;
  }
  const mode = lower("mode");
  if (mode === "last" || mode === "mark") intent.priceMode = mode;

  const watch = str("watch");
  if (watch) {
    intent.watchSymbols = watch
      .split(",")
      .map((sym) => sym.trim().toUpperCase())
      .filter((sym) => /^[A-Z0-9]{1,12}$/.test(sym));
  }

  const cmd = str("cmd");
  if (cmd) {
    intent.cmd = cmd;
    intent.bookTab = "trade"; // cmd parses straight into the ticket
  }

  // Overlays — at most one (funds > ticket > alerts), modals never stack.
  const fund = lower("fund");
  if (fund) {
    intent.overlay = {
      kind: "funds",
      tab: fund === "convert" || fund === "phoenix" ? fund : null,
    };
  } else if (flag("ticket") && isPerp) {
    intent.overlay = { kind: "ticket" };
  } else if (flag("alerts")) {
    intent.overlay = { kind: "alerts" };
  }

  return intent;
}
