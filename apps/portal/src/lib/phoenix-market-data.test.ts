import { afterEach, describe, expect, test } from "bun:test";
import {
  fetchPhoenixCandles,
  type MarketPoint,
  upsertLiveCandle,
} from "./phoenix-market-data";

// Mirrors CANDLE_HISTORY_LIMIT in phoenix-market-data.ts (not exported).
const LIMIT = 1500;

function point(ts: number, close = 100, overrides: Partial<MarketPoint> = {}) {
  return {
    ts,
    price: close,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    ...overrides,
  } satisfies MarketPoint;
}

describe("upsertLiveCandle", () => {
  test("same-ts point replaces the in-progress tail candle", () => {
    const history = [point(1_000), point(2_000), point(3_000, 101)];
    const updated = point(3_000, 105);
    const next = upsertLiveCandle(history, updated);
    expect(next).toEqual([point(1_000), point(2_000), updated]);
    expect(next).not.toBe(history); // pure — fresh array identity
    expect(history[2]).toEqual(point(3_000, 101)); // input untouched
  });

  test("later-ts point appends a new candle", () => {
    const history = [point(1_000), point(2_000)];
    const fresh = point(3_000, 102);
    const next = upsertLiveCandle(history, fresh);
    expect(next).toEqual([point(1_000), point(2_000), fresh]);
    expect(history).toHaveLength(2); // input untouched
  });

  test("append at the history limit trims the oldest candle", () => {
    const history = Array.from({ length: LIMIT }, (_, i) =>
      point((i + 1) * 1_000),
    );
    const fresh = point((LIMIT + 1) * 1_000, 103);
    const next = upsertLiveCandle(history, fresh);
    expect(next).toHaveLength(LIMIT);
    expect(next[0]).toEqual(point(2_000)); // oldest dropped
    expect(next[next.length - 1]).toEqual(fresh);
  });

  test("out-of-order point falls back to sorted-merge backfill", () => {
    const history = [point(1_000), point(3_000)];
    const backfill = point(2_000, 99);
    expect(upsertLiveCandle(history, backfill)).toEqual([
      point(1_000),
      backfill,
      point(3_000),
    ]);
    // Out-of-order update to an existing candle replaces it in place.
    const revised = point(1_000, 98);
    expect(upsertLiveCandle(history, revised)).toEqual([revised, point(3_000)]);
  });

  test("zero-close point is filtered out, matching the legacy defence", () => {
    const history = [point(1_000), point(2_000)];
    expect(upsertLiveCandle(history, point(3_000, 0))).toEqual(history);
    expect(upsertLiveCandle(history, point(2_000, 0))).toEqual([point(1_000)]);
  });

  test("first live candle lands in empty history", () => {
    expect(upsertLiveCandle([], point(1_000))).toEqual([point(1_000)]);
  });
});

describe("fetchPhoenixCandles", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("drops zero-close candles at the producer boundary", async () => {
    // Raw REST payload with a junk zero-close bar in the middle. It must
    // never reach chart history: upsertLiveCandle's fast path assumes
    // producers are zero-close-free, and a retained 0 bar collapses the
    // chart's price autoscale to include 0.
    const rawCandle = (time: number, close: number) => ({
      time,
      open: 100,
      high: 101,
      low: 99,
      close,
    });
    const payload = [
      rawCandle(1_700_000_000, 100),
      rawCandle(1_700_000_060, 0),
      rawCandle(1_700_000_120, 102),
    ];
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const points = await fetchPhoenixCandles("ZERO-CLOSE-TEST", "1m");
    expect(points.map((item) => item.close)).toEqual([100, 102]);
    expect(points.map((item) => item.ts)).toEqual([
      1_700_000_000_000, 1_700_000_120_000,
    ]);
  });
});
