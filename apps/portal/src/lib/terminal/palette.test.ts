import { describe, expect, test } from "bun:test";
import type {
  PhoenixDailyStat,
  PhoenixMarketConfig,
} from "$lib/phoenix-market-data";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import type { SpotAsset } from "$lib/spot";
import { buildPaletteRows, PALETTE_TABS, type PaletteTab } from "./palette";

function market(symbol: string, maxLeverage = 20): PhoenixMarketConfig {
  return {
    symbol,
    marketStatus: "active",
    isolatedOnly: true,
    makerFee: null,
    takerFee: null,
    maxLeverage,
    commodity: false,
    nextTransitionUtc: null,
  };
}

function asset(overrides: Partial<SpotAsset> = {}): SpotAsset {
  return {
    assetId: "asset-sol",
    symbol: "SOL",
    hub: "crypto",
    name: "Solana",
    imageUrl: "https://img/sol.png",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    trustTier: "high",
    price: 150,
    change24hPct: 2.5,
    volume24hUsd: 1_000_000,
    marketCap: null,
    liquidityUsd: null,
    ...overrides,
  };
}

function phoenixPosition(
  overrides: Partial<PhoenixPosition> = {},
): PhoenixPosition {
  return {
    symbol: "SOL",
    size: 10,
    entryPrice: 100,
    liquidationPrice: null,
    unrealizedPnl: 12.5,
    positionValue: 1_000,
    takeProfitPrice: null,
    stopLossPrice: null,
    traderPdaIndex: 0,
    subaccountIndex: 1,
    marginUsd: 100,
    ...overrides,
  };
}

function order(overrides: Partial<PhoenixOpenOrder> = {}): PhoenixOpenOrder {
  return {
    symbol: "SOL",
    side: "bid",
    price: 100,
    remaining: 1,
    orderSequenceNumber: "1",
    isStopLoss: false,
    isStopLossDirection: false,
    ...overrides,
  };
}

const noop = (): void => {};

function rows(input: {
  markets?: PhoenixMarketConfig[];
  assets?: SpotAsset[];
  mids?: Record<string, number>;
  stats?: Record<string, PhoenixDailyStat>;
  query?: string;
  tab?: PaletteTab;
  positions?: PhoenixPosition[];
  orders?: PhoenixOpenOrder[];
  closePosition?: (position: PhoenixPosition) => void;
  cancelSymbolOrders?: (symbol: string) => void;
  flattenAll?: () => void;
}) {
  return buildPaletteRows(
    input.markets ?? [],
    input.assets ?? [],
    input.mids ?? {},
    input.stats ?? {},
    input.query ?? "",
    input.tab ?? "all",
    input.positions ?? [],
    input.orders ?? [],
    input.closePosition ?? noop,
    input.cancelSymbolOrders ?? noop,
    input.flattenAll ?? noop,
  );
}

describe("buildPaletteRows ordering", () => {
  test("all tab: actions lead, then perps, then spot by volume", () => {
    const result = rows({
      markets: [market("SOL"), market("BTC")],
      assets: [
        asset({ assetId: "a", symbol: "AAA", volume24hUsd: 10 }),
        asset({ assetId: "b", symbol: "BBB", volume24hUsd: 30 }),
      ],
      positions: [phoenixPosition()],
    });
    expect(result.map((row) => row.kind)).toEqual([
      "action",
      "perp",
      "perp",
      "spot",
      "spot",
    ]);
    expect(result[3].symbol).toBe("BBB");
    expect(result[4].symbol).toBe("AAA");
  });

  test("spot rows with null volume sort last", () => {
    const result = rows({
      assets: [
        asset({ assetId: "a", symbol: "AAA", volume24hUsd: null }),
        asset({ assetId: "b", symbol: "BBB", volume24hUsd: 5 }),
        asset({ assetId: "c", symbol: "CCC", volume24hUsd: 0 }),
      ],
    });
    expect(result.map((row) => row.symbol)).toEqual(["BBB", "CCC", "AAA"]);
  });
});

describe("buildPaletteRows tabs", () => {
  test("perps tab keeps actions and perps, drops spot", () => {
    const result = rows({
      markets: [market("SOL")],
      assets: [asset()],
      positions: [phoenixPosition()],
      tab: "perps",
    });
    expect(result.map((row) => row.kind)).toEqual(["action", "perp"]);
  });

  test("hub tabs filter the spot catalog only", () => {
    const result = rows({
      markets: [market("SOL")],
      assets: [
        asset({ assetId: "a", symbol: "AAA", hub: "crypto" }),
        asset({ assetId: "b", symbol: "NVDA", hub: "equities" }),
      ],
      positions: [phoenixPosition()],
      tab: "equities",
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("spot");
    expect(result[0].symbol).toBe("NVDA");
  });
});

describe("buildPaletteRows query", () => {
  const inputs = {
    markets: [market("SOL"), market("BTC")],
    assets: [asset({ assetId: "b", symbol: "WBTC", name: "Wrapped Bitcoin" })],
  };

  test("matches symbol case-insensitively", () => {
    const result = rows({ ...inputs, query: "btc" });
    expect(result.map((row) => row.symbol)).toEqual(["BTC", "WBTC"]);
  });

  test("matches name when the symbol misses", () => {
    const result = rows({ ...inputs, query: "wrapped" });
    expect(result.map((row) => row.symbol)).toEqual(["WBTC"]);
  });
});

describe("buildPaletteRows perp price fallback", () => {
  const stats: Record<string, PhoenixDailyStat> = {
    SOL: { lastPrice: 149, change24hPct: 1, volume24hUsd: 500 },
  };

  test("live mid wins, then daily lastPrice, then null", () => {
    const withMid = rows({
      markets: [market("SOL")],
      mids: { SOL: 151 },
      stats,
    });
    expect(withMid[0].price).toBe(151);
    const fromStats = rows({ markets: [market("SOL")], stats });
    expect(fromStats[0].price).toBe(149);
    const bare = rows({ markets: [market("SOL")] });
    expect(bare[0].price).toBeNull();
    expect(bare[0].change24hPct).toBeNull();
    expect(bare[0].volumeUsd).toBeNull();
  });
});

describe("buildPaletteRows action rows", () => {
  test("close rows carry the signed uPnL and call the handler with the position", () => {
    const seen: PhoenixPosition[] = [];
    const winner = phoenixPosition({ unrealizedPnl: 12.5 });
    const loser = phoenixPosition({
      symbol: "BTC",
      subaccountIndex: 2,
      unrealizedPnl: -3.25,
    });
    const result = rows({
      positions: [winner, loser],
      closePosition: (position) => seen.push(position),
    });
    expect(result[0].name).toBe("Close SOL-PERP · +$12.50");
    expect(result[1].name).toBe("Close BTC-PERP · -$3.25");
    expect(result[0].key).toBe("action:close:SOL:1");
    result[1].action?.();
    expect(seen).toEqual([loser]);
  });

  test("close row omits the uPnL segment when unknown", () => {
    const result = rows({
      positions: [phoenixPosition({ unrealizedPnl: null })],
    });
    expect(result[0].name).toBe("Close SOL-PERP");
  });

  test("cancel rows count book orders per symbol, excluding stop-losses", () => {
    const cancelled: string[] = [];
    const result = rows({
      orders: [
        order(),
        order({ orderSequenceNumber: "2" }),
        order({ orderSequenceNumber: "3", isStopLoss: true }),
        order({ symbol: "BTC", orderSequenceNumber: "4" }),
      ],
      cancelSymbolOrders: (symbol) => cancelled.push(symbol),
    });
    expect(result[0].name).toBe("Cancel 2 SOL-PERP orders");
    expect(result[1].name).toBe("Cancel 1 BTC-PERP order");
    result[0].action?.();
    expect(cancelled).toEqual(["SOL"]);
  });

  test("flatten appears only with more than one position", () => {
    let flattened = 0;
    const single = rows({ positions: [phoenixPosition()] });
    expect(single.some((row) => row.key === "action:flatten")).toBe(false);
    const multi = rows({
      positions: [phoenixPosition(), phoenixPosition({ symbol: "BTC" })],
      flattenAll: () => {
        flattened += 1;
      },
    });
    const flatten = multi.find((row) => row.key === "action:flatten");
    expect(flatten?.name).toBe("Flatten all positions");
    flatten?.action?.();
    expect(flattened).toBe(1);
  });
});

describe("buildPaletteRows cap", () => {
  test("caps at 80 rows", () => {
    const assets: SpotAsset[] = [];
    for (let index = 0; index < 100; index += 1) {
      assets.push(
        asset({
          assetId: `asset-${index}`,
          symbol: `T${index}`,
          volume24hUsd: index,
        }),
      );
    }
    expect(rows({ assets, tab: "crypto" })).toHaveLength(80);
  });
});

describe("PALETTE_TABS", () => {
  test("holds the five shipped tabs in order", () => {
    expect(PALETTE_TABS.map((tab) => tab.key)).toEqual([
      "all",
      "perps",
      "crypto",
      "equities",
      "pre-ipo",
    ]);
  });
});

describe("repeat-last action row", () => {
  test("leads the action list when provided and fires its apply", () => {
    let applied = false;
    const rows = buildPaletteRows(
      [],
      [],
      {},
      {},
      "",
      "all",
      [],
      [],
      () => {},
      () => {},
      () => {},
      { label: "Repeat last · LONG $50 SOL 5x", apply: () => (applied = true) },
    );
    expect(rows[0]?.kind).toBe("action");
    expect(rows[0]?.name).toContain("Repeat last");
    rows[0]?.action?.();
    expect(applied).toBe(true);
  });

  test("absent when null", () => {
    const rows = buildPaletteRows(
      [],
      [],
      {},
      {},
      "",
      "all",
      [],
      [],
      () => {},
      () => {},
      () => {},
      null,
    );
    expect(rows.some((row) => row.key === "action:repeat-last")).toBe(false);
  });
});
