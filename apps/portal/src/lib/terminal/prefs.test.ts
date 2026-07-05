import { describe, expect, test } from "bun:test";
import { DEFAULT_PANEL_ORDER, mergeLayout, parsePrefs } from "./prefs";

describe("parsePrefs", () => {
  test("null/malformed/non-object → empty", () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs("not-json{")).toEqual({});
    expect(parsePrefs('"a string"')).toEqual({});
  });

  test("accepts every whitelisted field", () => {
    const prefs = parsePrefs(
      JSON.stringify({
        symbol: "BTC",
        timeframe: "1h",
        priceMode: "mark",
        chartScale: "percent",
        chartAxisMode: "log",
        visibleCandleCount: 120,
        tradeMode: "spot",
        spotAssetId: "sol",
        watchlist: ["sol", "btc"],
        screenSort: "cap",
        screenHub: "crypto",
        sizingMode: "risk",
        tradeAmount: "500",
        tradeRiskUsd: "25",
        tradeLeverage: 10,
      }),
    );
    expect(prefs.symbol).toBe("BTC");
    expect(prefs.timeframe).toBe("1h");
    expect(prefs.priceMode).toBe("mark");
    expect(prefs.chartScale).toBe("percent");
    expect(prefs.chartAxisMode).toBe("log");
    expect(prefs.visibleCandleCount).toBe(120);
    expect(prefs.tradeMode).toBe("spot");
    expect(prefs.watchlist).toEqual(["SOL", "BTC"]);
    expect(prefs.screenSort).toBe("cap");
    expect(prefs.screenHub).toBe("crypto");
    expect(prefs.sizingMode).toBe("risk");
    expect(prefs.tradeAmount).toBe("500");
    expect(prefs.tradeRiskUsd).toBe("25");
    expect(prefs.tradeLeverage).toBe(10);
  });

  test("rejects out-of-enum values field by field", () => {
    const prefs = parsePrefs(
      JSON.stringify({
        timeframe: "7d",
        priceMode: "oracle",
        chartScale: "sqrt",
        screenSort: "alphabetical",
        screenHub: "bonds",
        sizingMode: "yolo",
        tradeMode: "perps",
        tradeLeverage: 3,
        visibleCandleCount: Number.NaN,
      }),
    );
    expect(prefs).toEqual({});
  });

  test("watchlist uppercases, drops non-strings, caps at 24", () => {
    const prefs = parsePrefs(
      JSON.stringify({
        watchlist: ["sol", 7, ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
      }),
    );
    expect(prefs.watchlist?.[0]).toBe("SOL");
    expect(prefs.watchlist).toHaveLength(24);
    expect(prefs.watchlist?.includes("7" as string)).toBe(false);
  });

  test("tradeLeverage only from the snap set", () => {
    for (const [input, expected] of [
      [1, 1],
      [20, 20],
      [3, undefined],
      [100, undefined],
    ] as const) {
      expect(
        parsePrefs(JSON.stringify({ tradeLeverage: input })).tradeLeverage,
      ).toBe(expected as number);
    }
  });
});

describe("mergeLayout", () => {
  test("non-array → defaults copy", () => {
    const merged = mergeLayout("junk", DEFAULT_PANEL_ORDER);
    expect(merged).toEqual(DEFAULT_PANEL_ORDER);
    expect(merged).not.toBe(DEFAULT_PANEL_ORDER); // fresh copy, not the shared const
  });

  test("preserves saved order and appends missing defaults", () => {
    const merged = mergeLayout(
      ["journal", "watch"],
      ["watch", "perp", "journal"],
    );
    expect(merged).toEqual(["journal", "watch", "perp"]);
  });

  test("drops unknown ids from stale saves", () => {
    const merged = mergeLayout(["ghost", "watch"], ["watch", "perp"]);
    expect(merged).toEqual(["watch", "perp"]);
  });

  test("drops non-string entries", () => {
    const merged = mergeLayout([42, "perp"], ["watch", "perp"]);
    expect(merged).toEqual(["perp", "watch"]);
  });
});

describe("dock + drawer prefs", () => {
  test("dockTab whitelists the three tabs", () => {
    expect(parsePrefs(JSON.stringify({ dockTab: "journal" })).dockTab).toBe(
      "journal",
    );
    expect(parsePrefs(JSON.stringify({ dockTab: "desk" })).dockTab).toBe(
      "desk",
    );
    expect(
      parsePrefs(JSON.stringify({ dockTab: "settings" })).dockTab,
    ).toBeUndefined();
  });

  test("macroOpen accepts booleans only", () => {
    expect(parsePrefs(JSON.stringify({ macroOpen: true })).macroOpen).toBe(
      true,
    );
    expect(
      parsePrefs(JSON.stringify({ macroOpen: "yes" })).macroOpen,
    ).toBeUndefined();
  });
});
