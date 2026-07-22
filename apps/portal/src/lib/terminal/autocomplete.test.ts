import { describe, expect, test } from "bun:test";
import type { JournalEntry } from "$lib/journal";
import type { MarketPoint } from "$lib/phoenix-market-data";
import {
  detectSwings,
  GHOST_DEFAULTS,
  ghostSizing,
  ghostStop,
  ghostTakeProfit,
  structureLevels,
} from "./autocomplete";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function candle(ts: number, high: number, low: number): MarketPoint {
  const close = (high + low) / 2;
  return { ts, price: close, open: close, high, low, close };
}

/** Flat highs (100), lows shaped so window=2 swing lows sit at exactly
 * 90 (ts 2) and 95 (ts 7). Highs all equal → ties → no swing highs. */
const SWING_LOW_CANDLES: MarketPoint[] = [
  candle(0, 100, 97),
  candle(1, 100, 94),
  candle(2, 100, 90),
  candle(3, 100, 94),
  candle(4, 100, 97),
  candle(5, 100, 98),
  candle(6, 100, 96),
  candle(7, 100, 95),
  candle(8, 100, 96.5),
  candle(9, 100, 97),
];

/** Flat lows (100), highs shaped so window=2 swing highs sit at exactly
 * 110 (ts 2) and 105 (ts 7). */
const SWING_HIGH_CANDLES: MarketPoint[] = [
  candle(0, 103, 100),
  candle(1, 106, 100),
  candle(2, 110, 100),
  candle(3, 106, 100),
  candle(4, 103, 100),
  candle(5, 102, 100),
  candle(6, 104, 100),
  candle(7, 105, 100),
  candle(8, 103.5, 100),
  candle(9, 103, 100),
];

describe("detectSwings", () => {
  test("detects a known 5-bar (window=2) swing low", () => {
    const candles = [
      candle(0, 10, 5),
      candle(1, 10, 4),
      candle(2, 10, 3),
      candle(3, 10, 4),
      candle(4, 10, 5),
    ];
    expect(detectSwings(candles, 2)).toEqual([
      { ts: 2, price: 3, kind: "low" },
    ]);
  });

  test("detects a known 5-bar (window=2) swing high", () => {
    const candles = [
      candle(0, 10, 1),
      candle(1, 11, 1),
      candle(2, 12, 1),
      candle(3, 11, 1),
      candle(4, 10, 1),
    ];
    expect(detectSwings(candles, 2)).toEqual([
      { ts: 2, price: 12, kind: "high" },
    ]);
  });

  test("edge bars are never pivots even when extreme", () => {
    // Strictly lowest low sits at index 1 — only one bar on its left, so
    // it cannot qualify with window=2; nothing else qualifies either.
    const candles = [
      candle(0, 10, 5),
      candle(1, 10, 1),
      candle(2, 10, 3),
      candle(3, 10, 4),
      candle(4, 10, 5),
      candle(5, 10, 6),
      candle(6, 10, 7),
    ];
    expect(detectSwings(candles, 2)).toEqual([]);
  });

  test("equal lows (ties) are not pivots — strictness", () => {
    const candles = [
      candle(0, 10, 5),
      candle(1, 10, 4),
      candle(2, 10, 3),
      candle(3, 10, 3),
      candle(4, 10, 4),
      candle(5, 10, 5),
    ];
    expect(detectSwings(candles, 2)).toEqual([]);
  });

  test("multiple pivots come back in chronological order", () => {
    expect(detectSwings(SWING_LOW_CANDLES, 2)).toEqual([
      { ts: 2, price: 90, kind: "low" },
      { ts: 7, price: 95, kind: "low" },
    ]);
    expect(detectSwings(SWING_HIGH_CANDLES, 2)).toEqual([
      { ts: 2, price: 110, kind: "high" },
      { ts: 7, price: 105, kind: "high" },
    ]);
  });

  test("empty and too-short arrays yield []", () => {
    expect(detectSwings([], 2)).toEqual([]);
    expect(detectSwings([candle(0, 10, 5)], 2)).toEqual([]);
    expect(
      detectSwings(
        [
          candle(0, 10, 5),
          candle(1, 10, 4),
          candle(2, 10, 3),
          candle(3, 10, 4),
        ],
        2,
      ),
    ).toEqual([]);
  });

  test("window below 1 yields []", () => {
    expect(detectSwings(SWING_LOW_CANDLES, 0)).toEqual([]);
  });
});

describe("ghostStop", () => {
  const opts = {
    window: 2,
    bufferPct: 0.3,
    prevDayHigh: null,
    prevDayLow: null,
  };

  test("long picks the NEAREST swing low below entry, not the lowest", () => {
    const result = ghostStop(SWING_LOW_CANDLES, "buy", 100, opts);
    expect(result).toEqual({
      value: 95 * (1 - 0.3 / 100),
      provenance: "0.3% below swing low 95.00",
      source: "swing",
    });
  });

  test("long skips swing lows at or above entry", () => {
    // Entry 94: swing low 95 is above entry, so 90 is the qualifying one.
    const result = ghostStop(SWING_LOW_CANDLES, "buy", 94, opts);
    expect(result).toEqual({
      value: 90 * (1 - 0.3 / 100),
      provenance: "0.3% below swing low 90.00",
      source: "swing",
    });
  });

  test("long falls back to prev-day low when all swings sit above entry", () => {
    const result = ghostStop(SWING_LOW_CANDLES, "buy", 89, {
      ...opts,
      prevDayLow: 85,
    });
    expect(result).toEqual({
      value: 85 * (1 - 0.3 / 100),
      provenance: "prev-day low 85.00 − 0.3%",
      source: "prev-day",
    });
  });

  test("long returns null when the fallback is also absent", () => {
    expect(ghostStop(SWING_LOW_CANDLES, "buy", 89, opts)).toBeNull();
  });

  test("long returns null when prev-day low is not below entry", () => {
    expect(
      ghostStop(SWING_LOW_CANDLES, "buy", 89, { ...opts, prevDayLow: 92 }),
    ).toBeNull();
  });

  test("short picks the NEAREST swing high above entry, buffered above", () => {
    const result = ghostStop(SWING_HIGH_CANDLES, "sell", 100, opts);
    expect(result).toEqual({
      value: 105 * (1 + 0.3 / 100),
      provenance: "0.3% above swing high 105.00",
      source: "swing",
    });
  });

  test("short falls back to prev-day high when swings are all below entry", () => {
    const result = ghostStop(SWING_HIGH_CANDLES, "sell", 111, {
      ...opts,
      prevDayHigh: 115,
    });
    expect(result).toEqual({
      value: 115 * (1 + 0.3 / 100),
      provenance: "prev-day high 115.00 + 0.3%",
      source: "prev-day",
    });
  });

  test("short returns null without qualifying swing or prev-day high", () => {
    expect(ghostStop(SWING_HIGH_CANDLES, "sell", 111, opts)).toBeNull();
  });
});

describe("ghostTakeProfit", () => {
  const opts = { window: 2, rMultiple: 2 };

  test("long picks the nearest swing high above entry, unbuffered", () => {
    const result = ghostTakeProfit(SWING_HIGH_CANDLES, "buy", 100, null, opts);
    expect(result).toEqual({
      value: 105,
      provenance: "nearest swing high 105.00",
      source: "swing",
    });
  });

  test("short picks the nearest swing low below entry", () => {
    const result = ghostTakeProfit(SWING_LOW_CANDLES, "sell", 100, null, opts);
    expect(result).toEqual({
      value: 95,
      provenance: "nearest swing low 95.00",
      source: "swing",
    });
  });

  test("r-multiple fallback uses the stop distance exactly (long)", () => {
    const result = ghostTakeProfit([], "buy", 100, 95, opts);
    expect(result).toEqual({
      value: 110,
      provenance: "2R from stop 95.00",
      source: "r-multiple",
    });
  });

  test("r-multiple fallback mirrors for shorts", () => {
    const result = ghostTakeProfit([], "sell", 100, 105, opts);
    expect(result).toEqual({
      value: 90,
      provenance: "2R from stop 105.00",
      source: "r-multiple",
    });
  });

  test("null without a swing and without a stop", () => {
    expect(ghostTakeProfit([], "buy", 100, null, opts)).toBeNull();
  });

  test("null when the stop distance is zero", () => {
    expect(ghostTakeProfit([], "buy", 100, 100, opts)).toBeNull();
  });
});

describe("ghostSizing", () => {
  function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
    return {
      ts: 1,
      mode: "live",
      venue: "perp",
      symbol: "SOL",
      action: "long",
      notionalUsd: 100,
      price: 100,
      leverage: 5,
      signature: "sig",
      ...overrides,
    };
  }

  test("odd count: exact median notional and modal leverage", () => {
    const entries = [
      entry({ notionalUsd: 100, leverage: 5 }),
      entry({ notionalUsd: 300, leverage: 10 }),
      entry({ notionalUsd: 200, leverage: 5 }),
    ];
    expect(ghostSizing(entries, "SOL", 3)).toEqual({
      notionalUsd: 200,
      leverage: 5,
      provenance: "median of your last 3 SOL trades",
      sampleSize: 3,
    });
  });

  test("even count: median is the mean of the two middles", () => {
    const entries = [
      entry({ notionalUsd: 400, leverage: 3 }),
      entry({ notionalUsd: 100, leverage: 3 }),
      entry({ notionalUsd: 300, leverage: 3 }),
      entry({ notionalUsd: 200, leverage: 3 }),
    ];
    expect(ghostSizing(entries, "SOL", 4)).toEqual({
      notionalUsd: 250,
      leverage: 3,
      provenance: "median of your last 4 SOL trades",
      sampleSize: 4,
    });
  });

  test("modal leverage tie breaks to the LOWER leverage", () => {
    const entries = [
      entry({ leverage: 10 }),
      entry({ leverage: 10 }),
      entry({ leverage: 5 }),
      entry({ leverage: 5 }),
    ];
    const result = ghostSizing(entries, "SOL", 4);
    expect(result?.leverage).toBe(5);
  });

  test("filters by symbol", () => {
    const entries = [
      entry({ symbol: "SOL", notionalUsd: 50 }),
      entry({ symbol: "ETH", notionalUsd: 900 }),
      entry({ symbol: "SOL", notionalUsd: 150 }),
      entry({ symbol: "SOL", notionalUsd: 100 }),
    ];
    expect(ghostSizing(entries, "SOL", 3)).toEqual({
      notionalUsd: 100,
      leverage: 5,
      provenance: "median of your last 3 SOL trades",
      sampleSize: 3,
    });
  });

  test("filters out spot-venue entries", () => {
    const entries = [
      entry({ venue: "spot", notionalUsd: 9_999 }),
      entry({ notionalUsd: 100 }),
      entry({ notionalUsd: 200 }),
      entry({ notionalUsd: 300 }),
    ];
    expect(ghostSizing(entries, "SOL", 3)).toEqual({
      notionalUsd: 200,
      leverage: 5,
      provenance: "median of your last 3 SOL trades",
      sampleSize: 3,
    });
  });

  test("entries missing notional or leverage do not count toward the sample", () => {
    const entries = [
      entry({ notionalUsd: null }),
      entry({ leverage: null }),
      entry(),
      entry(),
      entry(),
    ];
    expect(ghostSizing(entries, "SOL", 5)).toBeNull();
  });

  test("null under minSample — 2 trades are noise, not history", () => {
    const entries = [entry(), entry()];
    expect(ghostSizing(entries, "SOL", 5)).toBeNull();
  });
});

describe("structureLevels", () => {
  // Previous UTC day = [DAY_MS, 2 * DAY_MS); "now" is 1h into the next day.
  const nowMs = 2 * DAY_MS + HOUR_MS;

  test("candles spanning two UTC days yield the previous day's exact PDH/PDL", () => {
    const candles = [
      // Day before the previous day — extreme values prove exclusion.
      candle(DAY_MS - HOUR_MS, 200, 1),
      candle(DAY_MS, 105, 95),
      candle(DAY_MS + 6 * HOUR_MS, 110, 96),
      candle(DAY_MS + 12 * HOUR_MS, 108, 92),
      // Current UTC day — extreme values prove exclusion.
      candle(2 * DAY_MS, 300, 0.5),
    ];
    const result = structureLevels(candles, 2, nowMs);
    expect(result.prevDayHigh).toBe(110);
    expect(result.prevDayLow).toBe(92);
  });

  test("history ending inside the previous day yields nulls but still reports swings", () => {
    // All candles inside the previous UTC day: its close is not covered,
    // so no PDH/PDL — but swing math still runs on what is visible.
    const candles = [
      candle(DAY_MS, 10, 5),
      candle(DAY_MS + HOUR_MS, 10, 4),
      candle(DAY_MS + 2 * HOUR_MS, 10, 3),
      candle(DAY_MS + 3 * HOUR_MS, 10, 4),
      candle(DAY_MS + 4 * HOUR_MS, 10, 5),
    ];
    expect(structureLevels(candles, 2, nowMs)).toEqual({
      prevDayHigh: null,
      prevDayLow: null,
      swings: [{ ts: DAY_MS + 2 * HOUR_MS, price: 3, kind: "low" }],
    });
  });

  test("history starting after the previous day's open yields nulls", () => {
    const candles = [
      candle(DAY_MS + 6 * HOUR_MS, 110, 96),
      candle(DAY_MS + 12 * HOUR_MS, 108, 92),
      candle(2 * DAY_MS, 300, 0.5),
    ];
    expect(structureLevels(candles, 2, nowMs)).toEqual({
      prevDayHigh: null,
      prevDayLow: null,
      swings: [],
    });
  });

  test("empty candles yield nulls and no swings", () => {
    expect(structureLevels([], 2, nowMs)).toEqual({
      prevDayHigh: null,
      prevDayLow: null,
      swings: [],
    });
  });
});

describe("GHOST_DEFAULTS", () => {
  test("exact default tuning", () => {
    expect(GHOST_DEFAULTS).toEqual({
      swingWindow: 5,
      stopBufferPct: 0.3,
      tpRMultiple: 2,
      sizingMinSample: 5,
    });
  });
});
