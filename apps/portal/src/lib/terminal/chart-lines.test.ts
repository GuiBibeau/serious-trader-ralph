import { describe, expect, test } from "bun:test";
import { colors } from "@trader-ralph/ui/tokens";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import type { Alert } from "./alerts";
import { buildChartLineSpecs } from "./chart-lines";

const PREFS_ALL = { pos: true, tpsl: true, orders: true, alerts: true };

function position(overrides: Partial<PhoenixPosition> = {}): PhoenixPosition {
  return {
    symbol: "SOL",
    size: 2,
    entryPrice: 100,
    liquidationPrice: 80,
    unrealizedPnl: 12.345,
    positionValue: 200,
    takeProfitPrice: 130,
    stopLossPrice: 90,
    ...overrides,
  } as PhoenixPosition;
}

function order(overrides: Partial<PhoenixOpenOrder> = {}): PhoenixOpenOrder {
  return {
    symbol: "SOL",
    side: "bid",
    price: 95,
    remaining: 1.5,
    orderSequenceNumber: "1",
    isStopLoss: false,
    ...overrides,
  } as PhoenixOpenOrder;
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a",
    symbol: "SOL",
    op: "above",
    price: 150,
    tier: "PRIORITY",
    triggered: false,
    ...overrides,
  };
}

describe("buildChartLineSpecs", () => {
  test("spot mode → no lines at all", () => {
    expect(
      buildChartLineSpecs(
        [position()],
        [order()],
        [alert()],
        PREFS_ALL,
        "SOL",
        "spot",
      ),
    ).toEqual([]);
  });

  test("full long position renders entry/LIQ/TP/SL with exact fields", () => {
    const specs = buildChartLineSpecs(
      [position()],
      [],
      [],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs).toHaveLength(4);
    const [entry, liq, tp, sl] = specs;
    expect(entry.price).toBe(100);
    expect(entry.color).toBe(colors.up);
    expect(entry.lineWidth).toBe(2);
    expect(entry.lineStyle).toBe(0);
    expect(entry.title).toContain("LONG");
    expect(entry.title).toContain("+$12.35"); // signed uPnL in the label
    expect(liq.title).toBe("LIQ est");
    expect(liq.lineStyle).toBe(2);
    expect(tp.title).toBe("TP · +$60.00"); // |130-100| × 2
    expect(tp.color).toBe(colors.up);
    expect(sl.title).toBe("SL · -$20.00"); // |90-100| × 2
    expect(sl.color).toBe(colors.down);
  });

  test("short position gets down-colored solid entry with SHORT label", () => {
    const specs = buildChartLineSpecs(
      [
        position({
          size: -2,
          takeProfitPrice: null,
          stopLossPrice: null,
          liquidationPrice: null,
        }),
      ],
      [],
      [],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs).toHaveLength(1);
    expect(specs[0].color).toBe(colors.down);
    expect(specs[0].title).toContain("SHORT");
  });

  test("pref groups gate independently", () => {
    const posOnly = buildChartLineSpecs(
      [position()],
      [order()],
      [alert()],
      { pos: true, tpsl: false, orders: false, alerts: false },
      "SOL",
      "perps",
    );
    expect(posOnly.map((s) => s.title)).toEqual([
      expect.stringContaining("LONG"),
      "LIQ est",
    ]);
    const ordersOnly = buildChartLineSpecs(
      [position()],
      [order()],
      [alert()],
      { pos: false, tpsl: false, orders: true, alerts: false },
      "SOL",
      "perps",
    );
    expect(ordersOnly).toHaveLength(1);
    expect(ordersOnly[0].color).toBe(colors.amber);
    expect(ordersOnly[0].lineStyle).toBe(1);
    expect(ordersOnly[0].title).toBe("BID 1.5000");
  });

  test("symbol filtering applies to positions, orders, and alerts", () => {
    const specs = buildChartLineSpecs(
      [position({ symbol: "BTC" })],
      [order({ symbol: "BTC" })],
      [alert({ symbol: "BTC" })],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs).toEqual([]);
  });

  test("triggered alerts are excluded; arrow follows op", () => {
    const specs = buildChartLineSpecs(
      [],
      [],
      [alert(), alert({ id: "b", op: "below", triggered: true })],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs).toHaveLength(1);
    expect(specs[0].title).toBe("ALERT ↑");
    expect(specs[0].color).toBe(colors.accent);
  });

  test("ask order with null remaining renders bare ASK label", () => {
    const specs = buildChartLineSpecs(
      [],
      [order({ side: "ask", remaining: null })],
      [],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs[0].title).toBe("ASK");
  });
});
