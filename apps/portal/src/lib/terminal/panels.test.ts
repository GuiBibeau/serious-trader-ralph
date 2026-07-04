import { describe, expect, test } from "bun:test";
import type {
  PhoenixDailyStat,
  PhoenixMarketConfig,
} from "$lib/phoenix-market-data";
import type { SpotAsset } from "$lib/spot";
import {
  buildMonitorRows,
  buildScreenRows,
  buildWatchRows,
  disconnectedPanel,
  emptyMarketStats,
  selectedMarketTableRows,
  summarizeEdgeStatus,
} from "./panels";

function market(overrides: Partial<PhoenixMarketConfig>): PhoenixMarketConfig {
  return {
    symbol: "SOL",
    marketId: 0,
    marketStatus: "active",
    maxLeverage: 20,
    makerFee: 0.0002,
    takerFee: 0.0005,
    isolatedOnly: false,
    baseLotsDecimals: null,
    nextTransitionUtc: null,
    ...overrides,
  } as PhoenixMarketConfig;
}

function stat(overrides: Partial<PhoenixDailyStat>): PhoenixDailyStat {
  return {
    lastPrice: null,
    change24hPct: null,
    volume24hUsd: null,
    ...overrides,
  } as PhoenixDailyStat;
}

function asset(overrides: Partial<SpotAsset>): SpotAsset {
  return {
    symbol: "SOL",
    name: "Solana",
    mint: "m",
    decimals: 9,
    hub: "crypto",
    price: 100,
    change24hPct: 1,
    volume24hUsd: 1000,
    marketCap: 10_000,
    ...overrides,
  } as SpotAsset;
}

describe("buildMonitorRows", () => {
  const markets = [market({ symbol: "SOL" }), market({ symbol: "BTC" })];
  const stats = {
    SOL: stat({ change24hPct: -2, volume24hUsd: 500 }),
    BTC: stat({ change24hPct: 3, volume24hUsd: null }),
  };

  test("volume sort puts null volumes last (−1 sentinel)", () => {
    const rows = buildMonitorRows(markets, {}, stats, "volume");
    expect(rows.map((r) => r.symbol)).toEqual(["SOL", "BTC"]);
  });

  test("change sort descends with −1e9 null sentinel", () => {
    const rows = buildMonitorRows(markets, {}, stats, "change");
    expect(rows.map((r) => r.symbol)).toEqual(["BTC", "SOL"]);
  });

  test("symbol sort is alphabetical", () => {
    const rows = buildMonitorRows(markets, {}, stats, "symbol");
    expect(rows.map((r) => r.symbol)).toEqual(["BTC", "SOL"]);
  });

  test("mid prefers live mids over daily lastPrice", () => {
    const rows = buildMonitorRows(
      [market({ symbol: "SOL" })],
      { SOL: 151 },
      { SOL: stat({ lastPrice: 150 }) },
      "volume",
    );
    expect(rows[0].mid).toBe(151);
  });
});

describe("buildWatchRows", () => {
  test("spot price wins; basis in bps against perp mid", () => {
    const rows = buildWatchRows(
      ["SOL"],
      [asset({ symbol: "sol", price: 100 })],
      { SOL: 101 },
      [],
    );
    expect(rows[0].price).toBe(100);
    expect(rows[0].hasPerp).toBe(true);
    expect(rows[0].basisBps).toBeCloseTo(100, 5);
  });

  test("no spot, no mid → perp flag from market list, null basis", () => {
    const rows = buildWatchRows(["SOL"], [], {}, [market({ symbol: "SOL" })]);
    expect(rows[0].hasPerp).toBe(true);
    expect(rows[0].price).toBeNull();
    expect(rows[0].basisBps).toBeNull();
  });
});

describe("buildScreenRows", () => {
  const assets = [
    asset({ symbol: "A", change24hPct: -9, marketCap: 1, volume24hUsd: 1 }),
    asset({ symbol: "B", change24hPct: 2, marketCap: 3, volume24hUsd: 5 }),
    asset({
      symbol: "C",
      hub: "equities",
      change24hPct: 4,
      marketCap: 2,
      volume24hUsd: 3,
    }),
  ];

  test("movers sorts by |change| descending", () => {
    expect(
      buildScreenRows(assets, "all", "movers").map((a) => a.symbol),
    ).toEqual(["A", "C", "B"]);
  });

  test("cap and volume sorts", () => {
    expect(buildScreenRows(assets, "all", "cap").map((a) => a.symbol)).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(
      buildScreenRows(assets, "all", "volume").map((a) => a.symbol),
    ).toEqual(["B", "C", "A"]);
  });

  test("hub filter", () => {
    expect(
      buildScreenRows(assets, "equities", "movers").map((a) => a.symbol),
    ).toEqual(["C"]);
  });

  test("caps at 20 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      asset({ symbol: `S${i}` }),
    );
    expect(buildScreenRows(many, "all", "volume")).toHaveLength(20);
  });
});

describe("selectedMarketTableRows", () => {
  test("null market → disconnected row", () => {
    const rows = selectedMarketTableRows(null, null, null);
    expect(rows[0].value).toBe("Not connected");
  });

  test("fee row formats maker/taker percent pair", () => {
    const rows = selectedMarketTableRows(market({}), null, 100);
    const fees = rows.find((r) => r.label === "Fees");
    expect(fees?.status).toBe("maker/taker");
    expect(fees?.value).toContain("/");
    const margin = rows.find((r) => r.label === "Margin");
    expect(margin?.value).toBe("cross + isolated");
    expect(margin?.status).toContain("20");
  });
});

describe("edge status helpers", () => {
  test("summarizeEdgeStatus: any ready wins; else first non-ready", () => {
    const ready = disconnectedPanel("x");
    ready.status = "ready";
    expect(summarizeEdgeStatus([disconnectedPanel("a"), ready])).toBe("ready");
    expect(summarizeEdgeStatus([disconnectedPanel("a")])).toBe("not connected");
  });

  test("emptyMarketStats zeroes every field to null", () => {
    const stats = emptyMarketStats("SOL");
    expect(stats.symbol).toBe("SOL");
    expect(stats.markPx).toBeNull();
    expect(stats.funding).toBeNull();
  });
});
