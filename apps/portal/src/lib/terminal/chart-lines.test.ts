import { describe, expect, test } from "bun:test";
import { colors } from "@trader-ralph/ui/tokens";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import type { Alert } from "./alerts";
import type { SwingPoint } from "./autocomplete";
import { buildChartLineSpecs, buildStructureLineSpecs } from "./chart-lines";

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

function swing(ts: number, price: number, kind: "high" | "low"): SwingPoint {
  return { ts, price, kind };
}

describe("buildStructureLineSpecs", () => {
  test("empty levels → no lines at all", () => {
    expect(
      buildStructureLineSpecs({
        prevDayHigh: null,
        prevDayLow: null,
        swings: [],
      }),
    ).toEqual([]);
  });

  test("PDH/PDL render as dashed faint axis-labeled lines, exact fields", () => {
    expect(
      buildStructureLineSpecs({
        prevDayHigh: 152.4,
        prevDayLow: 147.1,
        swings: [],
      }),
    ).toEqual([
      {
        price: 152.4,
        color: colors.faint,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "PDH",
      },
      {
        price: 147.1,
        color: colors.faint,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "PDL",
      },
    ]);
  });

  test("null PDH with present PDL renders only the PDL line", () => {
    const specs = buildStructureLineSpecs({
      prevDayHigh: null,
      prevDayLow: 147.1,
      swings: [],
    });
    expect(specs.map((spec) => spec.title)).toEqual(["PDL"]);
  });

  test("swings render dotted faint specs without axis labels", () => {
    expect(
      buildStructureLineSpecs({
        prevDayHigh: null,
        prevDayLow: null,
        swings: [swing(1_000, 150, "high"), swing(2_000, 140, "low")],
      }),
    ).toEqual([
      {
        price: 150,
        color: colors.faint,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: false,
        title: "swing",
      },
      {
        price: 140,
        color: colors.faint,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: false,
        title: "swing",
      },
    ]);
  });

  test("caps at the 3 MOST RECENT swings per kind (chronological tail)", () => {
    const specs = buildStructureLineSpecs({
      prevDayHigh: null,
      prevDayLow: null,
      swings: [
        swing(1_000, 101, "high"),
        swing(2_000, 102, "high"),
        swing(3_000, 103, "high"),
        swing(4_000, 104, "high"),
        swing(5_000, 91, "low"),
        swing(6_000, 92, "low"),
        swing(7_000, 93, "low"),
        swing(8_000, 94, "low"),
      ],
    });
    // 3 highs then 3 lows — the oldest of each kind (101, 91) dropped.
    expect(specs.map((spec) => spec.price)).toEqual([
      102, 103, 104, 92, 93, 94,
    ]);
    expect(specs.every((spec) => spec.title === "swing")).toBe(true);
  });

  test("PDH/PDL and swings compose in order: PDH, PDL, highs, lows", () => {
    const specs = buildStructureLineSpecs({
      prevDayHigh: 160,
      prevDayLow: 140,
      swings: [swing(1_000, 155, "high"), swing(2_000, 145, "low")],
    });
    expect(specs.map((spec) => spec.title)).toEqual([
      "PDH",
      "PDL",
      "swing",
      "swing",
    ]);
    expect(specs.map((spec) => spec.price)).toEqual([160, 140, 155, 145]);
  });
});
