// Pure row builders for the terminal's data panels — monitor, watchlist,
// screener, selected-market table, and the disconnected/edge-status
// helpers. Bodies moved verbatim from the page; the three reactive row
// builders are the same expressions parameterized on their inputs.

import type { DataPanel, DataRow } from "$lib/edge-data";
import type {
  PhoenixDailyStat,
  PhoenixMarketConfig,
  PhoenixMarketStats,
} from "$lib/phoenix-market-data";
import type { SpotAsset } from "$lib/spot";
import { formatNumber, formatPercent, formatPrice } from "$lib/utils";

export type SignalRow = DataRow;

export type MonitorSort = "volume" | "change" | "symbol";
export type ScreenSort = "movers" | "volume" | "cap";
export type ScreenHub = "all" | "crypto" | "equities" | "pre-ipo";

export type MonitorRow = {
  symbol: string;
  lev: number | null;
  mid: number | null;
  change: number | null;
  volume: number | null;
};

export type WatchRow = {
  sym: string;
  spot: SpotAsset | null;
  hasPerp: boolean;
  price: number | null;
  change: number | null;
  basisBps: number | null;
};

export function buildMonitorRows(
  markets: PhoenixMarketConfig[],
  mids: Record<string, number>,
  stats: Record<string, PhoenixDailyStat>,
  sort: MonitorSort,
): MonitorRow[] {
  return markets
    .map((config) => ({
      symbol: config.symbol,
      lev: config.maxLeverage,
      mid: mids[config.symbol] ?? stats[config.symbol]?.lastPrice ?? null,
      change: stats[config.symbol]?.change24hPct ?? null,
      volume: stats[config.symbol]?.volume24hUsd ?? null,
    }))
    .sort((a, b) =>
      sort === "symbol"
        ? a.symbol.localeCompare(b.symbol)
        : sort === "change"
          ? (b.change ?? -1e9) - (a.change ?? -1e9)
          : (b.volume ?? -1) - (a.volume ?? -1),
    );
}

export function buildWatchRows(
  watchlist: string[],
  spotAssets: SpotAsset[],
  mids: Record<string, number>,
  markets: PhoenixMarketConfig[],
): WatchRow[] {
  return watchlist.map((sym) => {
    const spot =
      spotAssets.find((asset) => asset.symbol.toUpperCase() === sym) ?? null;
    const mid = mids[sym] ?? null;
    const hasPerp =
      mid !== null || markets.some((market) => market.symbol === sym);
    return {
      sym,
      spot,
      hasPerp,
      price: spot?.price ?? mid,
      change: spot?.change24hPct ?? null,
      basisBps:
        spot?.price && mid ? ((mid - spot.price) / spot.price) * 10_000 : null,
    };
  });
}

export function buildScreenRows(
  assets: SpotAsset[],
  hub: ScreenHub,
  sort: ScreenSort,
): SpotAsset[] {
  return [...assets]
    .filter((asset) => hub === "all" || asset.hub === hub)
    .sort((a, b) =>
      sort === "movers"
        ? Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0)
        : sort === "cap"
          ? (b.marketCap ?? 0) - (a.marketCap ?? 0)
          : (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0),
    )
    .slice(0, 20);
}

export function disconnectedRows(reason: string): SignalRow[] {
  return [
    {
      label: "Status",
      value: "Not connected",
      status: reason,
    },
  ];
}

export function disconnectedPanel(reason: string): DataPanel {
  return {
    rows: disconnectedRows(reason),
    status: "not connected",
    source: "",
  };
}

export function summarizeEdgeStatus(panels: DataPanel[]): string {
  if (panels.some((panel) => panel.status === "ready")) return "ready";
  const first = panels.find((panel) => panel.status !== "ready");
  return first?.status ?? "not connected";
}

export function selectedMarketTableRows(
  market: PhoenixMarketConfig | null,
  stats: PhoenixMarketStats | null,
  price: number | null,
): SignalRow[] {
  if (!market) {
    return disconnectedRows("Phoenix market metadata loading");
  }
  return [
    {
      label: "Market",
      value: `${market.symbol}-PERP`,
      status: market.marketStatus,
    },
    {
      label: "Mark",
      value: formatPrice(stats?.markPx ?? price),
      status: `oracle ${formatPrice(stats?.oraclePx)}`,
    },
    {
      label: "Open interest",
      value: formatNumber(stats?.openInterest, 2),
      status: "base",
    },
    {
      label: "Funding",
      value: formatPercent((stats?.funding ?? 0) * 100),
      status: "rate",
    },
    {
      label: "Fees",
      value: `${formatPercent((market.makerFee ?? 0) * 100)} / ${formatPercent((market.takerFee ?? 0) * 100)}`,
      status: "maker/taker",
    },
    {
      label: "Margin",
      value: market.isolatedOnly ? "isolated only" : "cross + isolated",
      status: market.maxLeverage
        ? `${formatNumber(market.maxLeverage, 0)}x max`
        : "--",
    },
  ];
}

export function emptyMarketStats(symbol: string): PhoenixMarketStats {
  return {
    symbol,
    dayNtlVlm: null,
    prevDayPx: null,
    markPx: null,
    midPx: null,
    funding: null,
    openInterest: null,
    oraclePx: null,
  };
}
