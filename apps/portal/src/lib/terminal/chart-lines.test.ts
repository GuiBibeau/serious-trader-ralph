import { describe, expect, test } from "bun:test";
import { colors } from "@trader-ralph/ui/tokens";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import type { Alert } from "./alerts";
import type { SwingPoint } from "./autocomplete";
import {
  buildChartLineSpecs,
  buildStructureLineSpecs,
  clickTradeLabel,
  clickTradeSide,
  measureParts,
  measureReadout,
  nearestRay,
  positionLineSpecs,
  RAY_TOLERANCE_PCT,
  rayLineSpec,
} from "./chart-lines";

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

  test("position renders only the liq estimate — entry/TP/SL belong to the draggable overlay", () => {
    const specs = buildChartLineSpecs(
      [position()],
      [],
      [],
      PREFS_ALL,
      "SOL",
      "perps",
    );
    expect(specs).toEqual([
      {
        price: 80,
        color: colors.down,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "LIQ est",
      },
    ]);
  });

  test("position without a liq estimate renders nothing here", () => {
    expect(
      buildChartLineSpecs(
        [position({ liquidationPrice: null })],
        [],
        [],
        PREFS_ALL,
        "SOL",
        "perps",
      ),
    ).toEqual([]);
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
    expect(posOnly.map((s) => s.title)).toEqual(["LIQ est"]);
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

describe("positionLineSpecs", () => {
  test("position with both triggers → entry/tp/sl with exact fields", () => {
    expect(positionLineSpecs(position())).toEqual([
      {
        kind: "entry",
        price: 100,
        color: colors.muted,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "entry",
      },
      {
        kind: "tp",
        price: 130,
        color: colors.up,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "",
      },
      {
        kind: "sl",
        price: 90,
        color: colors.down,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "",
      },
    ]);
  });

  test("missing TP → no tp line at all (drag edits existing triggers only)", () => {
    expect(
      positionLineSpecs(position({ takeProfitPrice: null })).map(
        (spec) => spec.kind,
      ),
    ).toEqual(["entry", "sl"]);
  });

  test("missing SL → no sl line at all", () => {
    expect(
      positionLineSpecs(position({ stopLossPrice: null })).map(
        (spec) => spec.kind,
      ),
    ).toEqual(["entry", "tp"]);
  });

  test("no triggers → entry only", () => {
    expect(
      positionLineSpecs(
        position({ takeProfitPrice: null, stopLossPrice: null }),
      ).map((spec) => spec.kind),
    ).toEqual(["entry"]);
  });

  test("null entry price → triggers still render without an entry anchor", () => {
    expect(
      positionLineSpecs(position({ entryPrice: null })).map(
        (spec) => spec.kind,
      ),
    ).toEqual(["tp", "sl"]);
  });

  test("entry stays muted regardless of position direction", () => {
    const short = positionLineSpecs(position({ size: -2 }));
    expect(short[0].color).toBe(colors.muted);
    expect(short[0].title).toBe("entry");
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

describe("clickTradeSide", () => {
  test("hover below mark → long", () => {
    expect(clickTradeSide(75, 77.2)).toBe("long");
  });

  test("hover above mark → short", () => {
    expect(clickTradeSide(80, 77.2)).toBe("short");
  });

  test("boundary: exactly at mark counts as long (buying at mark)", () => {
    expect(clickTradeSide(77.2, 77.2)).toBe("long");
  });
});

describe("clickTradeLabel", () => {
  test("formats with the limit field's precision: two decimals ≥10", () => {
    expect(clickTradeLabel(77.2, 100)).toBe("77.20 · limit long");
  });

  test("short side above mark", () => {
    expect(clickTradeLabel(120.456, 100)).toBe("120.46 · limit short");
  });

  test("sub-cent meme price keeps significant digits", () => {
    // fmtTriggerPrice keeps 4 significant digits for sub-cent prices.
    expect(clickTradeLabel(0.00004821, 0.00005)).toBe(
      "0.00004821 · limit long",
    );
  });
});

describe("rayLineSpec", () => {
  test("solid 1px muted@60% line, no title, axis label on — exact fields", () => {
    expect(rayLineSpec(150.25)).toEqual({
      price: 150.25,
      color: `${colors.muted}99`, // #8c95a499 — 0x99 ≈ 60% alpha
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: true,
      title: "",
    });
  });
});

describe("nearestRay", () => {
  test("none within tolerance → null", () => {
    expect(nearestRay([100, 110], 105, RAY_TOLERANCE_PCT)).toBeNull();
    expect(nearestRay([], 105, RAY_TOLERANCE_PCT)).toBeNull();
  });

  test("exact hit and boundary: tolerance is a % of the clicked price", () => {
    // ±0.5% of 100 = ±0.5 — 100.5 is exactly on the boundary (inclusive).
    expect(nearestRay([100.5], 100, RAY_TOLERANCE_PCT)).toBe(100.5);
    expect(nearestRay([100.51], 100, RAY_TOLERANCE_PCT)).toBeNull();
    expect(nearestRay([100], 100, RAY_TOLERANCE_PCT)).toBe(100);
  });

  test("nearest wins when several qualify", () => {
    expect(nearestRay([100.4, 99.9, 100.3], 100, RAY_TOLERANCE_PCT)).toBe(99.9);
  });

  test("exact distance ties keep the earliest-placed ray", () => {
    expect(nearestRay([100.2, 99.8], 100, RAY_TOLERANCE_PCT)).toBe(100.2);
  });
});

describe("measureReadout", () => {
  test("upward drag: exact chip string with signed % and bar count", () => {
    expect(measureReadout(100, 101.45, 14)).toBe("Δ $1.45 · +1.45% · 14 bars");
  });

  test("downward drag: Δ stays absolute, % carries the minus sign", () => {
    expect(measureReadout(100, 98.55, 6)).toBe("Δ $1.45 · -1.45% · 6 bars");
  });

  test("single bar reads singular", () => {
    expect(measureReadout(200, 201, 1)).toBe("Δ $1.00 · +0.50% · 1 bar");
  });

  test("no movement is honest zeros, not a fake reading", () => {
    expect(measureReadout(100, 100, 0)).toBe("Δ $0 · 0.00% · 0 bars");
  });

  test("negative bar delta counts as bars (drag direction agnostic)", () => {
    expect(measureReadout(100, 101.45, -14)).toBe("Δ $1.45 · +1.45% · 14 bars");
  });
});

describe("measureParts", () => {
  test("direction follows the drag; parts compose the readout exactly", () => {
    const up = measureParts(100, 101.45, 14);
    expect(up.direction).toBe("up");
    expect(`${up.delta} · ${up.pct} · ${up.bars}`).toBe(
      measureReadout(100, 101.45, 14),
    );
    expect(measureParts(100, 98.55, 6).direction).toBe("down");
  });

  test("start-at-or-below-zero renders an honest -- percent", () => {
    expect(measureParts(0, 5, 2).pct).toBe("--");
  });
});
