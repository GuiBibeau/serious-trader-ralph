// Market palette rows — the "/" picker for every tradable market.
// One primitive for both venues: perp markets (live mids) and the spot
// catalog (full 24h stats). Action rows (close/cancel/flatten on live
// state) lead when applicable; the handlers are injected by the page.
import type {
  PhoenixDailyStat,
  PhoenixMarketConfig,
} from "$lib/phoenix-market-data";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import type { SpotAsset } from "$lib/spot";
import { formatNumber } from "$lib/utils";

export type PaletteRow = {
  kind: "perp" | "spot" | "action";
  key: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  lev: number | null;
  price: number | null;
  change24hPct: number | null;
  volumeUsd: number | null;
  hub: "perps" | "crypto" | "equities" | "pre-ipo";
  asset?: SpotAsset;
  action?: () => void;
};
export type PaletteTab = "all" | "perps" | "crypto" | "equities" | "pre-ipo";
export const PALETTE_TABS: { key: PaletteTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "perps", label: "Perps" },
  { key: "crypto", label: "Crypto" },
  { key: "equities", label: "Equities" },
  { key: "pre-ipo", label: "Pre-IPO" },
];

export function buildPaletteRows(
  perpMarkets: PhoenixMarketConfig[],
  assets: SpotAsset[],
  mids: Record<string, number>,
  stats: Record<string, PhoenixDailyStat>,
  query: string,
  tab: PaletteTab,
  positions: PhoenixPosition[],
  orders: PhoenixOpenOrder[],
  closePosition: (position: PhoenixPosition) => void,
  cancelSymbolOrders: (symbol: string) => void,
  flattenAll: () => void,
  repeatLast: { label: string; apply: () => void } | null = null,
): PaletteRow[] {
  // Live-state actions: one Close per position, one Cancel per symbol with
  // book orders, Flatten once there is more than one position to close.
  const blank = {
    imageUrl: null,
    lev: null,
    price: null,
    change24hPct: null,
    volumeUsd: null,
    hub: "perps" as const,
  };
  const actions: PaletteRow[] = [];
  if (repeatLast) {
    actions.push({
      kind: "action",
      key: "action:repeat-last",
      symbol: "REPEAT",
      name: repeatLast.label,
      ...blank,
      action: repeatLast.apply,
    });
  }
  actions.push(
    ...positions.map(
      (position): PaletteRow => ({
        kind: "action",
        key: `action:close:${position.symbol}:${position.subaccountIndex}`,
        symbol: position.symbol,
        name: `Close ${position.symbol}-PERP${
          position.unrealizedPnl !== null
            ? ` · ${position.unrealizedPnl >= 0 ? "+" : "-"}$${formatNumber(Math.abs(position.unrealizedPnl), 2)}`
            : ""
        }`,
        ...blank,
        action: () => closePosition(position),
      }),
    ),
  );
  const bookCounts = new Map<string, number>();
  for (const order of orders) {
    if (order.isStopLoss) continue;
    bookCounts.set(order.symbol, (bookCounts.get(order.symbol) ?? 0) + 1);
  }
  for (const [symbol, count] of bookCounts) {
    actions.push({
      kind: "action",
      key: `action:cancel:${symbol}`,
      symbol,
      name: `Cancel ${count} ${symbol}-PERP order${count === 1 ? "" : "s"}`,
      ...blank,
      action: () => cancelSymbolOrders(symbol),
    });
  }
  if (positions.length > 1) {
    actions.push({
      kind: "action",
      key: "action:flatten",
      symbol: "FLATTEN",
      name: "Flatten all positions",
      ...blank,
      action: () => flattenAll(),
    });
  }
  const perps: PaletteRow[] = perpMarkets.map((market) => ({
    kind: "perp",
    key: `perp:${market.symbol}`,
    symbol: market.symbol,
    name: `${market.symbol}-PERP`,
    imageUrl: null,
    lev: market.maxLeverage,
    price: mids[market.symbol] ?? stats[market.symbol]?.lastPrice ?? null,
    change24hPct: stats[market.symbol]?.change24hPct ?? null,
    volumeUsd: stats[market.symbol]?.volume24hUsd ?? null,
    hub: "perps",
  }));
  const spots: PaletteRow[] = assets.map((asset) => ({
    kind: "spot",
    key: `spot:${asset.assetId}`,
    symbol: asset.symbol,
    name: asset.name,
    imageUrl: asset.imageUrl || null,
    lev: null,
    price: asset.price,
    change24hPct: asset.change24hPct,
    volumeUsd: asset.volume24hUsd,
    hub: asset.hub,
  }));
  for (const [index, asset] of assets.entries()) spots[index].asset = asset;
  spots.sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1));
  // Actions lead, then perps — this is a perp terminal first; spot
  // follows by volume.
  let rows =
    tab === "perps"
      ? [...actions, ...perps]
      : tab === "all"
        ? [...actions, ...perps, ...spots]
        : spots.filter((row) => row.hub === tab);
  const q = query.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (row) =>
        row.symbol.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q),
    );
  }
  return rows.slice(0, 80);
}
