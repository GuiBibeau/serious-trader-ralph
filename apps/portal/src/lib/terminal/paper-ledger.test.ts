import { describe, expect, test } from "bun:test";
import type { PhoenixSide } from "../phoenix-trade";
import {
  addPaperMargin,
  cancelPaperOrder,
  closePaperPosition,
  createEmptyLedger,
  ledgerToTraderState,
  PAPER_MARK_TTL_MS,
  PAPER_STARTING_BALANCE,
  type PaperLedger,
  type PaperMark,
  type PaperPlaceOrderInput,
  parsePaperLedger,
  placePaperOrder,
  resetPaperLedger,
  setPaperTpSl,
  tickPaperLedger,
  topUpPaperCash,
} from "./paper-ledger";

const NOW_MS = 1_000_000;

function firstSubaccount(ledger: PaperLedger): number {
  const index = ledger.positions[0]?.subaccountIndex;
  if (index === undefined) throw new Error("expected an open paper position");
  return index;
}

function paperMark(
  price: number,
  asOfMs = NOW_MS,
  maintenanceMarginRatio = 0.005,
): PaperMark {
  return { price, asOfMs, maintenanceMarginRatio };
}

function paperMarks(mids: Record<string, number>): Record<string, PaperMark> {
  return Object.fromEntries(
    Object.entries(mids).map(([symbol, price]) => [symbol, paperMark(price)]),
  );
}

function tickWithMids(
  ledger: PaperLedger,
  mids: Record<string, number>,
  nowMs = NOW_MS,
) {
  return tickPaperLedger(ledger, paperMarks(mids), nowMs);
}

describe("paper-ledger", () => {
  test("starts with the default paper balance", () => {
    const ledger = createEmptyLedger();
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE);
    expect(ledgerToTraderState(ledger).collateralUsd).toBe(
      PAPER_STARTING_BALANCE,
    );
    expect(ledgerToTraderState(ledger).chainVerified).toBe(true);
  });

  test("market long opens a position and locks margin", () => {
    const { ledger, events } = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      reduceOnly: false,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("open");
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
    expect(ledger.positions).toHaveLength(1);
    expect(ledger.positions[0]?.size).toBeCloseTo(5);
    expect(ledger.positions[0]?.entryPrice).toBe(100);
    expect(ledger.positions[0]?.marginUsd).toBe(100);
    expect(ledger.positions[0]?.takeProfitPrice).toBe(110);
  });

  test("rejects orders larger than free cash", () => {
    expect(() =>
      placePaperOrder(createEmptyLedger(50), {
        symbol: "SOL",
        side: "bid",
        orderType: "market",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
        reduceOnly: false,
      }),
    ).toThrow(/Insufficient paper balance/);
  });

  test("close returns margin plus realized pnl", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const { ledger, event } = closePaperPosition(
      opened,
      "SOL",
      firstSubaccount(opened),
      1,
      110,
    );
    expect(ledger.positions).toHaveLength(0);
    // margin 100 + pnl (10 * 5) = 150 returned → cash 10000 - 100 + 150
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE + 50);
    expect(event?.realizedPnlUsd).toBeCloseTo(50);
  });

  test("limit rests then fills when mid crosses", () => {
    const placed = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "limit",
      notionalUsd: 200,
      leverage: 2,
      price: 90,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    });
    expect(placed.ledger.orders).toHaveLength(1);
    expect(placed.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);

    const still = tickWithMids(placed.ledger, { SOL: 95 });
    expect(still.ledger.orders).toHaveLength(1);
    expect(still.ledger.positions).toHaveLength(0);

    const filled = tickWithMids(placed.ledger, { SOL: 89 });
    expect(filled.ledger.orders).toHaveLength(0);
    expect(filled.ledger.positions).toHaveLength(1);
    expect(filled.events.some((event) => event.kind === "limit_fill")).toBe(
      true,
    );
  });

  test("cancel limit refunds reserved margin", () => {
    const placed = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "ask",
      orderType: "limit",
      notionalUsd: 200,
      leverage: 2,
      price: 120,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    });
    const order = placed.ledger.orders[0];
    if (!order) throw new Error("expected resting paper order");
    const cancelled = cancelPaperOrder(
      placed.ledger,
      order.orderSequenceNumber,
    );
    expect(cancelled.orders).toHaveLength(0);
    expect(cancelled.cashUsd).toBe(PAPER_STARTING_BALANCE);
  });

  test("take profit fires on tick", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: 108,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const ticked = tickWithMids(opened, { SOL: 108 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("tp");
  });

  test("stop loss fires on tick", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: 96,
      reduceOnly: false,
    }).ledger;
    const ticked = tickWithMids(opened, { SOL: 96 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("sl");
  });

  test("setPaperTpSl updates triggers", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const idx = firstSubaccount(opened);
    const next = setPaperTpSl(opened, "SOL", idx, {
      takeProfitPrice: 115,
      stopLossPrice: 92,
    });
    expect(next.positions[0]?.takeProfitPrice).toBe(115);
    expect(next.positions[0]?.stopLossPrice).toBe(92);
  });

  test("addPaperMargin moves cash into the position", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const idx = firstSubaccount(opened);
    const next = addPaperMargin(opened, "SOL", idx, 50);
    expect(next.cashUsd).toBe(PAPER_STARTING_BALANCE - 150);
    expect(next.positions[0]?.marginUsd).toBe(150);
  });

  test("topUp and reset", () => {
    const topped = topUpPaperCash(createEmptyLedger(100), 50);
    expect(topped.cashUsd).toBe(150);
    expect(resetPaperLedger().cashUsd).toBe(PAPER_STARTING_BALANCE);
  });

  test("liquidation forfeits margin at high leverage", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 1000,
      leverage: 10,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    // 10x long liq ≈ entry * (1 - 0.1) = 90
    const ticked = tickWithMids(opened, { SOL: 89 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("liq");
    // margin forfeited — cash stays at 10000 - 100
    expect(ticked.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
  });
});

// ── Atomic bounded engine (WP2) ────────────────────────────────────────
// Exact deterministic assertions for the open/add/net/reverse, settlement
// cap, liquidation precedence, residual reservation, and monotonic refs.

function order(input: {
  symbol?: string;
  side: PhoenixSide;
  orderType?: "market" | "limit";
  notionalUsd: number;
  leverage?: number;
  price: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  reduceOnly?: boolean;
}): PaperPlaceOrderInput {
  return {
    symbol: input.symbol ?? "SOL",
    side: input.side,
    orderType: input.orderType ?? "market",
    notionalUsd: input.notionalUsd,
    leverage: input.leverage ?? 1,
    price: input.price,
    takeProfitPrice: input.takeProfitPrice ?? null,
    stopLossPrice: input.stopLossPrice ?? null,
    reduceOnly: input.reduceOnly ?? false,
  };
}

describe("paper-ledger atomic reductions & reversals", () => {
  test("pure reduction succeeds at zero free cash with no new margin", () => {
    // Lock all cash into a 1x long (size 1, margin 100, cash 0).
    const opened = placePaperOrder(
      createEmptyLedger(100),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    expect(opened.cashUsd).toBe(0);

    const reduced = placePaperOrder(
      opened,
      order({ side: "ask", notionalUsd: 50, price: 100 }),
    );
    expect(reduced.events[0]?.kind).toBe("close");
    expect(reduced.ledger.cashUsd).toBe(50);
    expect(reduced.ledger.positions).toHaveLength(1);
    expect(reduced.ledger.positions[0]?.size).toBeCloseTo(0.5, 10);
    expect(reduced.ledger.positions[0]?.marginUsd).toBeCloseTo(50, 10);
  });

  test("exact flatten needs zero new margin and clears the position", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    const flattened = placePaperOrder(
      opened,
      order({ side: "ask", notionalUsd: 100, price: 100 }),
    );
    expect(flattened.events).toHaveLength(1);
    expect(flattened.events[0]?.kind).toBe("close");
    expect(flattened.ledger.positions).toHaveLength(0);
    expect(flattened.ledger.cashUsd).toBe(1000);
  });

  test("fundable long→short reversal emits close then open and flips size", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    const reversed = placePaperOrder(
      opened,
      order({ side: "ask", notionalUsd: 200, price: 100 }),
    );
    expect(reversed.events).toHaveLength(2);
    expect(reversed.events[0]?.kind).toBe("close");
    expect(reversed.events[0]?.side).toBe("ask");
    expect(reversed.events[1]?.kind).toBe("open");
    expect(reversed.events[1]?.side).toBe("ask");
    expect(reversed.ledger.positions).toHaveLength(1);
    expect(reversed.ledger.positions[0]?.size).toBeCloseTo(-1, 10);
    expect(reversed.ledger.positions[0]?.entryPrice).toBe(100);
    expect(reversed.ledger.positions[0]?.marginUsd).toBeCloseTo(100, 10);
    expect(reversed.ledger.cashUsd).toBe(900);
  });

  test("fundable short→long reversal emits close then open and flips size", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "ask", notionalUsd: 100, price: 100 }),
    ).ledger;
    const reversed = placePaperOrder(
      opened,
      order({ side: "bid", notionalUsd: 200, price: 100 }),
    );
    expect(reversed.events).toHaveLength(2);
    expect(reversed.events[0]?.kind).toBe("close");
    expect(reversed.events[0]?.side).toBe("bid");
    expect(reversed.events[1]?.kind).toBe("open");
    expect(reversed.events[1]?.side).toBe("bid");
    expect(reversed.ledger.positions[0]?.size).toBeCloseTo(1, 10);
    expect(reversed.ledger.cashUsd).toBe(900);
  });

  test("unfundable reversal is rejected and leaves the input ledger unchanged", () => {
    const opened = placePaperOrder(
      createEmptyLedger(200),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    expect(opened.cashUsd).toBe(100);
    expect(() =>
      placePaperOrder(
        opened,
        order({ side: "ask", notionalUsd: 400, price: 100 }),
      ),
    ).toThrow(/Insufficient paper balance/);
    // Input ledger untouched: cash, position, and counter all preserved.
    expect(opened.cashUsd).toBe(100);
    expect(opened.positions).toHaveLength(1);
    expect(opened.positions[0]?.size).toBe(1);
    expect(opened.nextEventId).toBe(2);
  });
});

describe("paper-ledger limit reservation", () => {
  test("opposite limit reserves only the residual opening margin", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    // Long size 1; limit sell 1.5 qty → closes 1, opens 0.5 short residual.
    const placed = placePaperOrder(
      opened,
      order({ side: "ask", orderType: "limit", notionalUsd: 150, price: 100 }),
    );
    expect(placed.ledger.orders).toHaveLength(1);
    expect(placed.ledger.orders[0]?.marginUsd).toBeCloseTo(50, 10);
    expect(placed.ledger.cashUsd).toBeCloseTo(850, 10);
  });

  test("crossed reversal limit preserves close then labels only open as limit fill", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1_000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    const resting = placePaperOrder(
      opened,
      order({
        side: "ask",
        orderType: "limit",
        notionalUsd: 200,
        price: 100,
      }),
    ).ledger;

    const filled = tickWithMids(resting, { SOL: 100 });

    expect(filled.events.map((event) => event.kind)).toEqual([
      "close",
      "limit_fill",
    ]);
    expect(filled.ledger.positions[0]?.size).toBe(-1);
  });

  test("reduce-only and pure-reduction limits reserve zero margin", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    const reduceOnly = placePaperOrder(
      opened,
      order({
        side: "ask",
        orderType: "limit",
        notionalUsd: 50,
        price: 100,
        reduceOnly: true,
      }),
    ).ledger;
    expect(reduceOnly.orders[0]?.marginUsd).toBe(0);
    expect(reduceOnly.cashUsd).toBe(900);

    const pureReduction = placePaperOrder(
      opened,
      order({ side: "ask", orderType: "limit", notionalUsd: 50, price: 100 }),
    ).ledger;
    expect(pureReduction.orders[0]?.marginUsd).toBe(0);
  });
});

describe("paper-ledger same-side add triggers", () => {
  test("weighted add retains an inherited trigger still valid vs weighted entry", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({
        side: "bid",
        notionalUsd: 100,
        price: 100,
        takeProfitPrice: 110,
      }),
    ).ledger;
    // Weighted entry = (100 + 105) / 2 = 102.5; inherited TP 110 still above → retain.
    const added = placePaperOrder(
      opened,
      // $105 at $105 buys the same 1 base unit as $100 at $100.
      order({ side: "bid", notionalUsd: 105, price: 105 }),
    ).ledger;
    expect(added.positions[0]?.entryPrice).toBeCloseTo(102.5, 10);
    expect(added.positions[0]?.takeProfitPrice).toBe(110);
  });

  test("weighted add clears an inherited trigger no longer valid vs weighted entry", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({
        side: "bid",
        notionalUsd: 100,
        price: 100,
        takeProfitPrice: 108,
      }),
    ).ledger;
    // Weighted entry = (100 + 120) / 2 = 110; inherited TP 108 now below → clear.
    const added = placePaperOrder(
      opened,
      // $120 at $120 buys the same 1 base unit as $100 at $100.
      order({ side: "bid", notionalUsd: 120, price: 120 }),
    ).ledger;
    expect(added.positions[0]?.entryPrice).toBeCloseTo(110, 10);
    expect(added.positions[0]?.takeProfitPrice).toBeNull();
  });

  test("weighted add rejects an explicit trigger invalid vs weighted entry, unchanged", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    // Weighted entry = (100 + 140) / 2 = 120; explicit TP 115 below → reject.
    expect(() =>
      placePaperOrder(
        opened,
        order({
          side: "bid",
          notionalUsd: 140,
          price: 140,
          takeProfitPrice: 115,
        }),
      ),
    ).toThrow(/Take profit/);
    expect(opened.positions[0]?.entryPrice).toBe(100);
    expect(opened.positions[0]?.size).toBe(1);
  });
});

describe("paper-ledger liquidation precedence & settlement cap", () => {
  test("liquidation wins over SL for a long (gap emits liq only)", () => {
    const opened = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "bid",
        notionalUsd: 1000,
        leverage: 10,
        price: 100,
        stopLossPrice: 95,
      }),
    ).ledger;
    // liq ≈ 90.45; mid 89 breaches liq AND sl 95 → liq only.
    const ticked = tickWithMids(opened, { SOL: 89 });
    expect(ticked.events).toHaveLength(1);
    expect(ticked.events[0]?.kind).toBe("liq");
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
    expect(ticked.events[0]?.realizedPnlUsd).toBe(-100);
  });

  test("liquidation wins over SL for a short (gap emits liq only)", () => {
    const opened = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "ask",
        notionalUsd: 1000,
        leverage: 10,
        price: 100,
        stopLossPrice: 105,
      }),
    ).ledger;
    // short liq ≈ 109.45; mid 111 breaches liq AND sl 105 → liq only.
    const ticked = tickWithMids(opened, { SOL: 111 });
    expect(ticked.events).toHaveLength(1);
    expect(ticked.events[0]?.kind).toBe("liq");
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
    expect(ticked.events[0]?.realizedPnlUsd).toBe(-100);
  });

  test("extreme partial close loss is capped at the released margin", () => {
    // 10x long: notional 1000, margin 100, size 10.
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 1000, leverage: 10, price: 100 }),
    ).ledger;
    expect(opened.cashUsd).toBe(900);
    const closed = closePaperPosition(
      opened,
      "SOL",
      firstSubaccount(opened),
      0.5,
      50,
    );
    // releasedMargin = 50; rawPnl = (50-100)*5 = -250 → capped at -50 → cash +0.
    expect(closed.event?.realizedPnlUsd).toBe(-50);
    expect(closed.ledger.cashUsd).toBe(900);
    expect(closed.ledger.positions[0]?.size).toBeCloseTo(5, 10);
    expect(closed.ledger.positions[0]?.marginUsd).toBeCloseTo(50, 10);
  });

  test("extreme full close loss (manual + SL path) is capped at released margin", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 1000, leverage: 10, price: 100 }),
    ).ledger;
    const manual = closePaperPosition(
      opened,
      "SOL",
      firstSubaccount(opened),
      1,
      50,
      "close",
    );
    // releasedMargin = 100; rawPnl = (50-100)*10 = -500 → capped at -100.
    expect(manual.event?.realizedPnlUsd).toBe(-100);
    expect(manual.ledger.cashUsd).toBe(900);
    expect(manual.ledger.positions).toHaveLength(0);

    // The SL trigger path shares the same cap (kind is just a label).
    const slClosed = closePaperPosition(
      opened,
      "SOL",
      firstSubaccount(opened),
      1,
      50,
      "sl",
    );
    expect(slClosed.event?.realizedPnlUsd).toBe(-100);
    expect(slClosed.ledger.cashUsd).toBe(900);
  });

  test("cash never goes negative on an adverse close at a near-zero price", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 1000, leverage: 10, price: 100 }),
    ).ledger;
    const closed = closePaperPosition(
      opened,
      "SOL",
      firstSubaccount(opened),
      1,
      0.01,
    );
    expect(closed.ledger.cashUsd).toBeGreaterThanOrEqual(0);
    expect(closed.ledger.cashUsd).toBe(900);
  });
});

describe("paper-ledger deterministic refs & immutability", () => {
  test("event signatures are monotonic paper-event-N and climb across reversals", () => {
    const l0 = createEmptyLedger();
    expect(l0.nextEventId).toBe(1);
    const r1 = placePaperOrder(
      l0,
      order({ symbol: "SOL", side: "bid", notionalUsd: 100, price: 100 }),
    );
    expect(r1.events[0]?.signature).toBe("paper-event-1");
    expect(r1.ledger.nextEventId).toBe(2);

    const r2 = placePaperOrder(
      r1.ledger,
      order({ symbol: "BTC", side: "bid", notionalUsd: 100, price: 100 }),
    );
    expect(r2.events[0]?.signature).toBe("paper-event-2");
    expect(r2.ledger.nextEventId).toBe(3);

    const reversal = placePaperOrder(
      r2.ledger,
      order({ symbol: "SOL", side: "ask", notionalUsd: 200, price: 100 }),
    );
    expect(reversal.events[0]?.signature).toBe("paper-event-3");
    expect(reversal.events[0]?.kind).toBe("close");
    expect(reversal.events[1]?.signature).toBe("paper-event-4");
    expect(reversal.events[1]?.kind).toBe("open");
    expect(reversal.ledger.nextEventId).toBe(5);
  });

  test("rejected orders leave the input ledger byte-identical", () => {
    const opened = placePaperOrder(
      createEmptyLedger(1000),
      order({ side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    const before = {
      cash: opened.cashUsd,
      positions: opened.positions.length,
      size: opened.positions[0]?.size,
      nextEventId: opened.nextEventId,
    };
    // Insufficient funds, invalid explicit trigger, and unfundable reversal
    // all throw without mutating the input.
    expect(() =>
      placePaperOrder(
        opened,
        order({ side: "bid", notionalUsd: 100000, price: 100 }),
      ),
    ).toThrow();
    expect(() =>
      placePaperOrder(
        opened,
        order({
          side: "bid",
          notionalUsd: 100,
          price: 140,
          takeProfitPrice: 115,
        }),
      ),
    ).toThrow();
    expect(() =>
      placePaperOrder(
        opened,
        order({ side: "ask", notionalUsd: 2_000, price: 100 }),
      ),
    ).toThrow();
    expect(opened.cashUsd).toBe(before.cash);
    expect(opened.positions).toHaveLength(before.positions);
    expect(opened.positions[0]?.size).toBe(before.size);
    expect(opened.nextEventId).toBe(before.nextEventId);
  });

  test("invalid leverage and non-positive notional/price are rejected", () => {
    const l = createEmptyLedger();
    expect(() =>
      placePaperOrder(
        l,
        order({ side: "bid", notionalUsd: 100, leverage: 0.5, price: 100 }),
      ),
    ).toThrow(/leverage/);
    expect(() =>
      placePaperOrder(
        l,
        order({
          side: "bid",
          notionalUsd: 100,
          leverage: Number.NaN,
          price: 100,
        }),
      ),
    ).toThrow(/leverage/);
    expect(() =>
      placePaperOrder(l, order({ side: "bid", notionalUsd: -5, price: 100 })),
    ).toThrow(/size or price/);
    expect(() =>
      placePaperOrder(l, order({ side: "bid", notionalUsd: 100, price: 0 })),
    ).toThrow(/size or price/);
  });
});

describe("paper-ledger persisted parser", () => {
  function persistedLedger(): PaperLedger {
    const opened = placePaperOrder(
      createEmptyLedger(),
      order({ symbol: "SOL", side: "bid", notionalUsd: 100, price: 100 }),
    ).ledger;
    return placePaperOrder(
      opened,
      order({
        symbol: "BTC",
        side: "ask",
        orderType: "limit",
        notionalUsd: 200,
        leverage: 2,
        price: 120,
      }),
    ).ledger;
  }

  test("resets null, scalars, and wrong versions", () => {
    expect(parsePaperLedger(null)).toEqual(createEmptyLedger());
    expect(parsePaperLedger(7)).toEqual(createEmptyLedger());
    expect(parsePaperLedger({ ...persistedLedger(), version: 2 })).toEqual(
      createEmptyLedger(),
    );
  });

  test("resets negative and NaN cash", () => {
    expect(parsePaperLedger({ ...persistedLedger(), cashUsd: -1 })).toEqual(
      createEmptyLedger(),
    );
    expect(
      parsePaperLedger({ ...persistedLedger(), cashUsd: Number.NaN }),
    ).toEqual(createEmptyLedger());
  });

  test("resets malformed nested position/order fields", () => {
    const valid = persistedLedger();
    expect(
      parsePaperLedger({
        ...valid,
        positions: [{ ...valid.positions[0], entryPrice: null }],
      }),
    ).toEqual(createEmptyLedger());
    expect(
      parsePaperLedger({
        ...valid,
        orders: [{ ...valid.orders[0], reduceOnly: "nope" }],
      }),
    ).toEqual(createEmptyLedger());
  });

  test("resets duplicate positions and order ids", () => {
    const valid = persistedLedger();
    expect(
      parsePaperLedger({
        ...valid,
        positions: [
          valid.positions[0],
          { ...valid.positions[0], subaccountIndex: 2 },
        ],
        nextSubaccount: 3,
      }),
    ).toEqual(createEmptyLedger());
    expect(
      parsePaperLedger({
        ...valid,
        orders: [valid.orders[0], { ...valid.orders[0] }],
      }),
    ).toEqual(createEmptyLedger());
  });

  test("resets counters colliding with retained ids", () => {
    const valid = persistedLedger();
    expect(parsePaperLedger({ ...valid, nextOrderId: 1 })).toEqual(
      createEmptyLedger(),
    );
    expect(parsePaperLedger({ ...valid, nextSubaccount: 1 })).toEqual(
      createEmptyLedger(),
    );
    expect(parsePaperLedger({ ...valid, nextEventId: 0 })).toEqual(
      createEmptyLedger(),
    );
  });

  test("round trips a valid strict ledger", () => {
    const valid = persistedLedger();
    const roundTrip = JSON.parse(JSON.stringify(valid)) as unknown;
    expect(parsePaperLedger(roundTrip)).toEqual(valid);
  });
});

describe("paper-ledger executable mark freshness", () => {
  test("exact TTL is accepted, TTL+1 and future marks are ignored", () => {
    const opened = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "bid",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        takeProfitPrice: 108,
      }),
    ).ledger;

    const exact = tickPaperLedger(
      opened,
      { SOL: paperMark(108, NOW_MS - PAPER_MARK_TTL_MS) },
      NOW_MS,
    );
    expect(exact.events[0]?.kind).toBe("tp");

    const stale = tickPaperLedger(
      opened,
      { SOL: paperMark(108, NOW_MS - PAPER_MARK_TTL_MS - 1) },
      NOW_MS,
    );
    expect(stale.events).toHaveLength(0);
    expect(stale.ledger).toBe(opened);

    const future = tickPaperLedger(
      opened,
      { SOL: paperMark(108, NOW_MS + 1) },
      NOW_MS,
    );
    expect(future.events).toHaveLength(0);
    expect(future.ledger).toBe(opened);
  });

  test("a fresh mark for one symbol does not refresh another", () => {
    const opened = placePaperOrder(
      createEmptyLedger(),
      order({
        symbol: "BTC",
        side: "bid",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        takeProfitPrice: 108,
      }),
    ).ledger;
    const ticked = tickPaperLedger(
      opened,
      {
        SOL: paperMark(108),
        BTC: paperMark(108, NOW_MS - PAPER_MARK_TTL_MS - 1),
      },
      NOW_MS,
    );
    expect(ticked.events).toHaveLength(0);
    expect(ticked.ledger).toBe(opened);
  });

  test("stale limits do not fill", () => {
    const placed = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "bid",
        orderType: "limit",
        notionalUsd: 200,
        leverage: 2,
        price: 90,
      }),
    ).ledger;
    const ticked = tickPaperLedger(
      placed,
      { SOL: paperMark(89, NOW_MS - PAPER_MARK_TTL_MS - 1) },
      NOW_MS,
    );
    expect(ticked.events).toHaveLength(0);
    expect(ticked.ledger).toBe(placed);
    expect(ticked.ledger.orders).toHaveLength(1);
  });

  test("stale TP, SL, and liquidation marks leave positions unchanged", () => {
    const tp = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "bid",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        takeProfitPrice: 108,
      }),
    ).ledger;
    const sl = placePaperOrder(
      createEmptyLedger(),
      order({
        side: "bid",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        stopLossPrice: 96,
      }),
    ).ledger;
    const liq = placePaperOrder(
      createEmptyLedger(),
      order({ side: "bid", notionalUsd: 1000, leverage: 10, price: 100 }),
    ).ledger;

    for (const [ledger, price] of [
      [tp, 108],
      [sl, 96],
      [liq, 89],
    ] as const) {
      const ticked = tickPaperLedger(
        ledger,
        { SOL: paperMark(price, NOW_MS - PAPER_MARK_TTL_MS - 1) },
        NOW_MS,
      );
      expect(ticked.events).toHaveLength(0);
      expect(ticked.ledger).toBe(ledger);
      expect(ticked.ledger.positions).toHaveLength(1);
    }
  });
});
