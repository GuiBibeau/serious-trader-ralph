import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PANEL_ORDER,
  mergeLayout,
  parsePrefs,
  parseRays,
  RAYS_PER_SYMBOL_CAP,
} from "./prefs";

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

  test("accepts paperMode boolean", () => {
    expect(parsePrefs(JSON.stringify({ paperMode: true })).paperMode).toBe(
      true,
    );
    expect(parsePrefs(JSON.stringify({ paperMode: false })).paperMode).toBe(
      false,
    );
    expect(
      parsePrefs(JSON.stringify({ paperMode: "yes" })).paperMode,
    ).toBeUndefined();
  });

  test("accepts displayCurrency whitelist", () => {
    expect(
      parsePrefs(JSON.stringify({ displayCurrency: "EUR" })).displayCurrency,
    ).toBe("EUR");
    expect(
      parsePrefs(JSON.stringify({ displayCurrency: "DOGE" })).displayCurrency,
    ).toBeUndefined();
  });

  test("accepts displayTimezone IANA ids", () => {
    expect(
      parsePrefs(JSON.stringify({ displayTimezone: "America/New_York" }))
        .displayTimezone,
    ).toBe("America/New_York");
    expect(
      parsePrefs(JSON.stringify({ displayTimezone: "Not/AZone" }))
        .displayTimezone,
    ).toBeUndefined();
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
  test("dockTab whitelists the four tabs", () => {
    expect(parsePrefs(JSON.stringify({ dockTab: "journal" })).dockTab).toBe(
      "journal",
    );
    expect(parsePrefs(JSON.stringify({ dockTab: "desk" })).dockTab).toBe(
      "desk",
    );
    expect(parsePrefs(JSON.stringify({ dockTab: "watch" })).dockTab).toBe(
      "watch",
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

describe("structure levels pref", () => {
  test("showLevels round-trips both booleans", () => {
    expect(parsePrefs(JSON.stringify({ showLevels: false })).showLevels).toBe(
      false,
    );
    expect(parsePrefs(JSON.stringify({ showLevels: true })).showLevels).toBe(
      true,
    );
  });

  test("showLevels rejects non-booleans — absent keeps the ON default", () => {
    expect(
      parsePrefs(JSON.stringify({ showLevels: "on" })).showLevels,
    ).toBeUndefined();
    expect(parsePrefs(JSON.stringify({})).showLevels).toBeUndefined();
  });
});

describe("rays pref", () => {
  test("valid payload round-trips per symbol", () => {
    const prefs = parsePrefs(
      JSON.stringify({ rays: { SOL: [150.5, 148.2], BTC: [65000] } }),
    );
    expect(prefs.rays).toEqual({ SOL: [150.5, 148.2], BTC: [65000] });
  });

  test("absent key stays undefined — page default {} applies", () => {
    expect(parsePrefs(JSON.stringify({})).rays).toBeUndefined();
  });

  test("garbage payloads collapse to {}", () => {
    expect(parseRays("junk")).toEqual({});
    expect(parseRays(42)).toEqual({});
    expect(parseRays(null)).toEqual({});
    expect(parseRays([150, 160])).toEqual({});
    expect(parsePrefs(JSON.stringify({ rays: "junk" })).rays).toEqual({});
  });

  test("filters non-finite/non-positive/non-number prices, drops emptied symbols", () => {
    expect(
      parseRays({
        SOL: [150, "160", Number.NaN, -5, 0, 149.9],
        BTC: [null, false],
        ETH: "not-an-array",
      }),
    ).toEqual({ SOL: [150, 149.9] });
  });

  test("caps at 12 per symbol keeping the newest tail (FIFO)", () => {
    const prices = Array.from({ length: 15 }, (_, i) => i + 1);
    const parsed = parseRays({ SOL: prices });
    expect(parsed.SOL).toHaveLength(RAYS_PER_SYMBOL_CAP);
    expect(parsed.SOL[0]).toBe(4); // oldest three evicted
    expect(parsed.SOL.at(-1)).toBe(15);
  });
});
