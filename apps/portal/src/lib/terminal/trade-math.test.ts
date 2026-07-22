import { describe, expect, test } from "bun:test";
import type { DepthLevel, PhoenixMarketConfig } from "$lib/phoenix-market-data";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import {
  buildTradePreview,
  clampLeverage,
  enrichPosition,
  fmtTriggerPrice,
  liqDistancePct,
  liquidationPriceEstimate,
  orderCancelKey,
  riskNotional,
  SL_CHIP_PCTS,
  TP_CHIP_PCTS,
  tpSlExecutionPrice,
  triggerPriceForPct,
} from "./trade-math";

function level(price: number, size: number): DepthLevel {
  return { price, size, cum: 0 };
}

function position(overrides: Partial<PhoenixPosition> = {}): PhoenixPosition {
  return {
    symbol: "SOL",
    size: 10,
    entryPrice: 100,
    liquidationPrice: null,
    unrealizedPnl: null,
    positionValue: 1_000,
    takeProfitPrice: null,
    stopLossPrice: null,
    traderPdaIndex: 0,
    subaccountIndex: 1,
    marginUsd: 100,
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

describe("buildTradePreview", () => {
  const asks = [level(100, 1), level(101, 1), level(102, 1)];
  const bids = [level(99, 1), level(98, 1), level(97, 1)];

  test("returns null on empty, non-numeric, and non-positive size", () => {
    expect(
      buildTradePreview("buy", "", 10, "market", "", asks, bids, 100, null),
    ).toBeNull();
    expect(
      buildTradePreview("buy", "abc", 10, "market", "", asks, bids, 100, null),
    ).toBeNull();
    expect(
      buildTradePreview("buy", "-5", 10, "market", "", asks, bids, 100, null),
    ).toBeNull();
    expect(
      buildTradePreview("buy", "0", 10, "market", "", asks, bids, 100, null),
    ).toBeNull();
  });

  test("market buy walks ask levels: avg entry + slippage bps", () => {
    // $150 takes all of level 1 ($100) and $50 of level 2 at 101.
    const preview = buildTradePreview(
      "buy",
      "150",
      10,
      "market",
      "",
      asks,
      bids,
      100,
      null,
    );
    expect(preview).not.toBeNull();
    const qty = 1 + 50 / 101;
    const avg = 150 / qty;
    expect(preview?.entry).toBeCloseTo(avg, 10);
    expect(preview?.slippageBps).toBeCloseTo(((avg - 100) / 100) * 10_000, 8);
    expect(preview?.fillable).toBe(true);
    expect(preview?.notionalUsd).toBe(150);
  });

  test("market sell walks bid levels", () => {
    // $99 exactly consumes the top bid — no slippage.
    const preview = buildTradePreview(
      "sell",
      "99",
      10,
      "market",
      "",
      asks,
      bids,
      100,
      null,
    );
    expect(preview?.entry).toBe(99);
    expect(preview?.slippageBps).toBe(0);
    expect(preview?.fillable).toBe(true);
  });

  test("book too thin: partial fill flags fillable=false, avg over filled qty", () => {
    // Total ask notional is 100+101+102 = $303 < $1000.
    const preview = buildTradePreview(
      "buy",
      "1000",
      10,
      "market",
      "",
      asks,
      bids,
      100,
      null,
    );
    expect(preview?.fillable).toBe(false);
    expect(preview?.entry).toBeCloseTo(101, 10);
    expect(preview?.slippageBps).toBeCloseTo(100, 8);
  });

  test("empty book falls back to refPrice with no slippage", () => {
    const preview = buildTradePreview(
      "buy",
      "150",
      10,
      "market",
      "",
      [],
      [],
      42,
      null,
    );
    expect(preview?.entry).toBe(42);
    expect(preview?.slippageBps).toBeNull();
    expect(preview?.fillable).toBe(true);
  });

  test("limit price overrides the book entry and skips slippage", () => {
    const preview = buildTradePreview(
      "buy",
      "150",
      10,
      "limit",
      "95",
      asks,
      bids,
      100,
      null,
    );
    expect(preview?.entry).toBe(95);
    expect(preview?.slippageBps).toBeNull();
    expect(preview?.fillable).toBe(true);
  });

  test("invalid limit string keeps the best level as entry", () => {
    const preview = buildTradePreview(
      "buy",
      "150",
      10,
      "limit",
      "nope",
      asks,
      bids,
      100,
      null,
    );
    expect(preview?.entry).toBe(100);
  });

  test("liq estimate: long below entry, short above entry, scaled by leverage", () => {
    const long = buildTradePreview(
      "buy",
      "100",
      10,
      "limit",
      "100",
      asks,
      bids,
      100,
      null,
    );
    expect(long?.liqPrice).toBeCloseTo(100 * (1 - 1 / 10), 10);
    const short = buildTradePreview(
      "sell",
      "100",
      4,
      "limit",
      "100",
      asks,
      bids,
      100,
      null,
    );
    expect(short?.liqPrice).toBeCloseTo(100 * (1 + 1 / 4), 10);
  });

  test("funding preview: pct of notional per 8h; null passes through", () => {
    const preview = buildTradePreview(
      "buy",
      "150",
      10,
      "limit",
      "100",
      asks,
      bids,
      100,
      0.01,
    );
    expect(preview?.fundingPer8hUsd).toBeCloseTo((0.01 / 100) * 150, 12);
    const noFunding = buildTradePreview(
      "buy",
      "150",
      10,
      "limit",
      "100",
      asks,
      bids,
      100,
      null,
    );
    expect(noFunding?.fundingPer8hUsd).toBeNull();
  });
});

describe("enrichPosition", () => {
  test("long: mark uPnL and reconstructed liq below entry", () => {
    const enriched = enrichPosition(position(), 105, market());
    expect(enriched.unrealizedPnl).toBe((105 - 100) * 10);
    // mmr = 0.5/20 = 0.025; liq = (100·10 − 100) / (10 − 0.025·10)
    expect(enriched.liquidationPrice).toBeCloseTo(900 / 9.75, 10);
  });

  test("short: mark uPnL sign flips and liq lands above entry", () => {
    const enriched = enrichPosition(position({ size: -10 }), 95, market());
    expect(enriched.unrealizedPnl).toBe((95 - 100) * -10);
    // liq = (100·(−10) − 100) / (−10 − 0.025·10)
    expect(enriched.liquidationPrice).toBeCloseTo(-1_100 / -10.25, 10);
    expect(enriched.liquidationPrice ?? 0).toBeGreaterThan(100);
  });

  test("mmr falls back to 0.005 without a market config or max leverage", () => {
    const noConfig = enrichPosition(position(), 105, undefined);
    expect(noConfig.liquidationPrice).toBeCloseTo(900 / 9.95, 10);
    const nullLev = enrichPosition(
      position(),
      105,
      market({ maxLeverage: null }),
    );
    expect(nullLev.liquidationPrice).toBeCloseTo(900 / 9.95, 10);
  });

  test("null mark keeps the API uPnL and still reconstructs liq", () => {
    const enriched = enrichPosition(
      position({ unrealizedPnl: 7 }),
      null,
      market(),
    );
    expect(enriched.unrealizedPnl).toBe(7);
    expect(enriched.liquidationPrice).toBeCloseTo(900 / 9.75, 10);
  });

  test("non-positive liq estimate becomes null (over-collateralized long)", () => {
    const enriched = enrichPosition(
      position({ size: 1, marginUsd: 200 }),
      105,
      market(),
    );
    expect(enriched.liquidationPrice).toBeNull();
  });

  test("missing entry/margin or flat size keeps the input liq untouched", () => {
    const noEntry = enrichPosition(
      position({ entryPrice: null, liquidationPrice: 88 }),
      105,
      market(),
    );
    expect(noEntry.liquidationPrice).toBe(88);
    const noMargin = enrichPosition(
      position({ marginUsd: null, liquidationPrice: 88 }),
      105,
      market(),
    );
    expect(noMargin.liquidationPrice).toBe(88);
    const flat = enrichPosition(
      position({ size: 0, liquidationPrice: 88 }),
      105,
      market(),
    );
    expect(flat.liquidationPrice).toBe(88);
  });
});

describe("riskNotional", () => {
  test("sizes notional from stop distance", () => {
    expect(riskNotional(100, 100, 95)).toBeCloseTo((100 * 100) / 5, 10);
  });

  test("5 bps min-stop guard: too-tight stop returns null, just-wide passes", () => {
    // entry·0.0005 = 0.05 — a 0.04 stop distance is inside the guard.
    expect(riskNotional(100, 100, 100.04)).toBeNull();
    expect(riskNotional(100, 100, 99.94)).toBeCloseTo((100 * 100) / 0.06, 6);
  });

  test("non-positive inputs return null", () => {
    expect(riskNotional(0, 100, 95)).toBeNull();
    expect(riskNotional(-1, 100, 95)).toBeNull();
    expect(riskNotional(100, 0, 95)).toBeNull();
    expect(riskNotional(100, 100, 0)).toBeNull();
  });
});

describe("liqDistancePct", () => {
  test("distance as percent of mark, direction-agnostic", () => {
    expect(liqDistancePct(position({ liquidationPrice: 90 }), 100)).toBe(10);
    expect(liqDistancePct(position({ liquidationPrice: 110 }), 100)).toBe(10);
  });

  test("null when mark or liq is unknown, or mark is zero", () => {
    expect(liqDistancePct(position({ liquidationPrice: 90 }), null)).toBeNull();
    expect(
      liqDistancePct(position({ liquidationPrice: null }), 100),
    ).toBeNull();
    expect(liqDistancePct(position({ liquidationPrice: 90 }), 0)).toBeNull();
  });
});

describe("triggerPriceForPct", () => {
  test("TP moves with the trade side", () => {
    expect(triggerPriceForPct(100, "buy", 5, "tp")).toBeCloseTo(105, 10);
    expect(triggerPriceForPct(100, "sell", 5, "tp")).toBeCloseTo(95, 10);
  });

  test("SL moves against the trade side", () => {
    expect(triggerPriceForPct(100, "buy", 5, "sl")).toBeCloseTo(95, 10);
    expect(triggerPriceForPct(100, "sell", 5, "sl")).toBeCloseTo(105, 10);
  });
});

describe("tpSlExecutionPrice", () => {
  test("ask close (long) bands the limit 10% below the trigger", () => {
    expect(tpSlExecutionPrice(80.5, "ask", 1000)).toBe(72.45);
    expect(tpSlExecutionPrice(73.8, "ask", 1000)).toBe(66.42);
  });

  test("bid close (short) bands the limit 10% above the trigger", () => {
    expect(tpSlExecutionPrice(100, "bid", 1000)).toBeCloseTo(110, 10);
    expect(tpSlExecutionPrice(62, "bid", 1000)).toBe(68.2);
  });

  test("0 bps collapses execution onto the trigger", () => {
    expect(tpSlExecutionPrice(80.5, "ask", 0)).toBe(80.5);
    expect(tpSlExecutionPrice(80.5, "bid", 0)).toBe(80.5);
  });
});

describe("fmtTriggerPrice", () => {
  test("precision scales with magnitude and stays Number()-parseable", () => {
    expect(fmtTriggerPrice(1234.56)).toBe("1234.6");
    expect(fmtTriggerPrice(1000)).toBe("1000.0");
    expect(fmtTriggerPrice(56.789)).toBe("56.79");
    expect(fmtTriggerPrice(10)).toBe("10.00");
    expect(fmtTriggerPrice(5.6789)).toBe("5.679");
    expect(fmtTriggerPrice(1)).toBe("1.000");
    expect(fmtTriggerPrice(0.123456)).toBe("0.12346");
  });
});

describe("clampLeverage", () => {
  test("rounds and clamps into [1, 20]", () => {
    expect(clampLeverage(0)).toBe(1);
    expect(clampLeverage(25)).toBe(20);
    expect(clampLeverage(7.4)).toBe(7);
    expect(clampLeverage(7.5)).toBe(8);
  });
});

describe("TP/SL chip presets", () => {
  test("hold the shipped percentages", () => {
    expect(TP_CHIP_PCTS).toEqual([2, 5, 10]);
    expect(SL_CHIP_PCTS).toEqual([1, 2, 5]);
  });
});

describe("orderCancelKey", () => {
  const order: PhoenixOpenOrder = {
    symbol: "SOL",
    side: "bid",
    price: 100,
    remaining: 1,
    orderSequenceNumber: "123456789",
    isStopLoss: false,
    isStopLossDirection: false,
  };

  test("keys a resting order by its sequence number", () => {
    expect(orderCancelKey(order)).toBe("cancel:SOL:bid:123456789");
  });

  test("collapses stop-loss rows onto the shared sl slot", () => {
    expect(orderCancelKey({ ...order, side: "ask", isStopLoss: true })).toBe(
      "cancel:SOL:ask:sl",
    );
  });
});

describe("fmtTriggerPrice sub-cent precision", () => {
  test("keeps 4 significant digits below a cent and stays parseable", () => {
    expect(fmtTriggerPrice(0.00004821)).toBe("0.00004821");
    expect(Number(fmtTriggerPrice(0.00004821))).toBeCloseTo(0.00004821, 10);
    expect(fmtTriggerPrice(0.0001)).toBe("0.0001");
  });

  test("a cent and above keep the original tiers", () => {
    expect(fmtTriggerPrice(0.5)).toBe("0.50000");
    expect(fmtTriggerPrice(150.234)).toBe("150.23");
  });
});

describe("liquidationPriceEstimate", () => {
  test("long lands below entry, short lands above entry (shared formula)", () => {
    // mmr 0.025; long: (100·10 − 100) / (10 − 0.025·10) = 900 / 9.75
    expect(liquidationPriceEstimate(100, 10, 100, 0.025)).toBeCloseTo(
      900 / 9.75,
      10,
    );
    // short: (100·(−10) − 100) / (−10 − 0.025·10) = −1100 / −10.25
    expect(liquidationPriceEstimate(100, -10, 100, 0.025)).toBeCloseTo(
      -1_100 / -10.25,
      10,
    );
    expect(liquidationPriceEstimate(100, -10, 100, 0.025) ?? 0).toBeGreaterThan(
      100,
    );
  });

  test("default 0.005 mmr matches the paper ledger's crude curve", () => {
    // 10x long: 900 / (10 − 0.005·10) = 900 / 9.95
    expect(liquidationPriceEstimate(100, 10, 100, 0.005)).toBeCloseTo(
      900 / 9.95,
      10,
    );
  });

  test("over-collateralized past zero returns null", () => {
    // (100·1 − 200) / (1 − 0.025) = −100 / 0.975 < 0 → null
    expect(liquidationPriceEstimate(100, 1, 200, 0.025)).toBeNull();
  });

  test("degenerate and non-finite inputs return null", () => {
    expect(liquidationPriceEstimate(100, 0, 100, 0.025)).toBeNull();
    expect(liquidationPriceEstimate(0, 10, 100, 0.025)).toBeNull();
    expect(liquidationPriceEstimate(Number.NaN, 10, 100, 0.025)).toBeNull();
    expect(
      liquidationPriceEstimate(100, 10, Number.POSITIVE_INFINITY, 0.025),
    ).toBeNull();
  });
});
