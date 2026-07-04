import { describe, expect, test } from "bun:test";
import type { UTCTimestamp } from "lightweight-charts";
import type {
  MarketPoint,
  PhoenixMarketConfig,
  PhoenixTimeframe,
} from "$lib/phoenix-market-data";
import {
  computeMarketChange,
  DEFAULT_VISIBLE_CANDLES,
  formatCandleCountdown,
  formatChartRange,
  MAX_VISIBLE_CANDLES,
  sessionNote,
  timeframeMs,
  toCandle,
  toVolume,
} from "./chart-format";

function point(overrides: Partial<MarketPoint> = {}): MarketPoint {
  return {
    ts: 1_700_000_000_000,
    price: 100,
    open: 99,
    high: 101,
    low: 98,
    close: 100,
    ...overrides,
  };
}

function market(
  overrides: Partial<PhoenixMarketConfig> = {},
): PhoenixMarketConfig {
  return {
    symbol: "SOL",
    marketStatus: "active",
    isolatedOnly: true,
    makerFee: null,
    takerFee: null,
    maxLeverage: 20,
    commodity: false,
    nextTransitionUtc: null,
    ...overrides,
  };
}

const stats = {
  symbol: "SOL",
  dayNtlVlm: null,
  prevDayPx: 100,
  markPx: null,
  midPx: null,
  funding: null,
  openInterest: null,
  oraclePx: null,
};

describe("toCandle", () => {
  const mixed = point({
    markOpen: 99.5,
    markHigh: null,
    markLow: 98.5,
    markClose: undefined,
  });

  test("last mode always uses trade OHLC", () => {
    const candle = toCandle(mixed, "last");
    expect(candle).toEqual({
      time: Math.floor(mixed.ts / 1000) as UTCTimestamp,
      open: 99,
      high: 101,
      low: 98,
      close: 100,
    });
  });

  test("mark mode falls back per field (markX ?? x)", () => {
    const candle = toCandle(mixed, "mark");
    expect(candle.open).toBe(99.5);
    expect(candle.high).toBe(101);
    expect(candle.low).toBe(98.5);
    expect(candle.close).toBe(100);
  });
});

describe("toVolume", () => {
  test("colors up candles green and down candles red", () => {
    expect(toVolume(point({ open: 99, close: 100 })).color).toBe(
      "rgba(44, 233, 127, 0.45)",
    );
    expect(toVolume(point({ open: 100, close: 99 })).color).toBe(
      "rgba(255, 90, 106, 0.45)",
    );
  });

  test("value prefers quote volume, then base volume, then 0", () => {
    expect(toVolume(point({ volumeQuote: 5, volume: 3 })).value).toBe(5);
    expect(toVolume(point({ volumeQuote: null, volume: 3 })).value).toBe(3);
    expect(toVolume(point()).value).toBe(0);
  });
});

describe("timeframeMs", () => {
  test("parses minute and hour suffixes", () => {
    expect(timeframeMs("1m")).toBe(60_000);
    expect(timeframeMs("15m")).toBe(15 * 60_000);
    expect(timeframeMs("1h")).toBe(3_600_000);
    expect(timeframeMs("4h")).toBe(4 * 3_600_000);
  });

  test("defaults to one minute on unknown suffix", () => {
    expect(timeframeMs("1d" as PhoenixTimeframe)).toBe(60_000);
  });
});

describe("formatCandleCountdown", () => {
  test("-- without a candle", () => {
    expect(formatCandleCountdown(null, "5m", Date.now())).toBe("--");
  });

  test("mm:ss with zero padding", () => {
    const candle = point({ ts: 0 });
    expect(formatCandleCountdown(candle, "5m", 60_000)).toBe("04:00");
    expect(formatCandleCountdown(candle, "5m", 1_000)).toBe("04:59");
    expect(formatCandleCountdown(candle, "1h", 3_540_500)).toBe("00:59");
  });

  test("clamps at 00:00 once the bar has closed", () => {
    const candle = point({ ts: 0 });
    expect(formatCandleCountdown(candle, "5m", 10 * 60_000)).toBe("00:00");
  });
});

describe("computeMarketChange", () => {
  test("prefers the prevDayPx path", () => {
    expect(computeMarketChange(110, stats, [])).toBeCloseTo(10, 10);
  });

  test("falls back to the 80-candle anchor without stats", () => {
    const points: MarketPoint[] = [];
    for (let index = 0; index < 100; index += 1) {
      points.push(point({ ts: index, price: index === 21 ? 50 : 60 }));
    }
    points.push(point({ ts: 100, price: 75 }));
    // 101 points: points.at(-80) is the index-21 sample (price 50); latest is 75.
    expect(computeMarketChange(null, null, points)).toBeCloseTo(50, 10);
  });

  test("short history anchors at the first point", () => {
    const points = [point({ ts: 0, price: 50 }), point({ ts: 1, price: 55 })];
    expect(computeMarketChange(null, null, points)).toBeCloseTo(10, 10);
  });

  test("null when no usable anchor", () => {
    expect(computeMarketChange(null, null, [])).toBeNull();
    expect(computeMarketChange(null, null, [point({ price: 0 })])).toBeNull();
  });
});

describe("formatChartRange", () => {
  test("-- when either endpoint is missing", () => {
    expect(formatChartRange([])).toBe("--");
  });

  test("locks the `first - last` Intl format byte-for-byte", () => {
    const first = point({ ts: Date.UTC(2026, 0, 5, 14, 30) });
    const last = point({ ts: Date.UTC(2026, 0, 6, 9, 15) });
    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
    expect(formatChartRange([first, last])).toBe(
      `${formatter.format(first.ts)} - ${formatter.format(last.ts)}`,
    );
  });
});

describe("sessionNote", () => {
  const now = Date.UTC(2026, 6, 3, 12, 0, 0);

  test("spot mode is always 24/7 Jupiter", () => {
    expect(sessionNote("spot", null, now)).toBe("24/7 · Jupiter");
  });

  test("24/7 without a market, calendar, or parseable transition", () => {
    expect(sessionNote("perps", null, now)).toBe("24/7");
    expect(sessionNote("perps", market(), now)).toBe("24/7");
    expect(
      sessionNote("perps", market({ nextTransitionUtc: "not-a-date" }), now),
    ).toBe("24/7");
  });

  test("active market counts down to close; inactive to open", () => {
    const next = new Date(now + 90 * 60_000).toISOString();
    expect(sessionNote("perps", market({ nextTransitionUtc: next }), now)).toBe(
      "closes 1h 30m",
    );
    expect(
      sessionNote(
        "perps",
        market({ nextTransitionUtc: next, marketStatus: "closed" }),
        now,
      ),
    ).toBe("opens 1h 30m");
  });

  test("sub-hour spans drop the hours segment", () => {
    const next = new Date(now + 45 * 60_000).toISOString();
    expect(sessionNote("perps", market({ nextTransitionUtc: next }), now)).toBe(
      "closes 45m",
    );
  });

  test("transition due at and past the boundary", () => {
    const at = new Date(now).toISOString();
    expect(sessionNote("perps", market({ nextTransitionUtc: at }), now)).toBe(
      "session transition due",
    );
    const past = new Date(now - 60_000).toISOString();
    expect(sessionNote("perps", market({ nextTransitionUtc: past }), now)).toBe(
      "session transition due",
    );
  });
});

describe("visible candle presets", () => {
  test("hold the shipped defaults", () => {
    expect(DEFAULT_VISIBLE_CANDLES).toBe(150);
    expect(MAX_VISIBLE_CANDLES).toBe(180);
  });
});
