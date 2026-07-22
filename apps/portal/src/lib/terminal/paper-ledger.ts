// Paper trading ledger — local simulated Phoenix account on live mids.
// Frontend-only: no signing, no chain. Desk UI consumes the same
// PhoenixTraderState shape via ledgerToTraderState().
//
// This module is PURE: every mutator returns a fresh next ledger + events
// or throws WITHOUT touching the input ledger. No Date.now()/Math.random()
// — local refs are a deterministic monotonic counter (nextEventId) so a
// rejection leaves the caller's state byte-identical and replays are stable.

import { persisted } from "../persisted";
import type {
  PhoenixOpenOrder,
  PhoenixPosition,
  PhoenixSide,
  PhoenixTraderState,
} from "../phoenix-trade";
import { liquidationPriceEstimate } from "./trade-math";

export const PAPER_AUTHORITY = "paper";
export const PAPER_STARTING_BALANCE = 10_000;
export const PAPER_STORAGE_KEY = "trader-ralph-terminal/paper-ledger/v1";

export const PAPER_MARK_TTL_MS = 15_000;

// Float noise tolerance for "is this quantity effectively zero / flat".
const QTY_EPS = 1e-9;
// Tolerance for the free-cash funding check so a sub-cent rounding gap on
// an exact-fit order can't bounce a fundable fill.
const CASH_EPS = 1e-9;

export type PaperMark = {
  price: number;
  asOfMs: number;
  maintenanceMarginRatio: number;
};

export type PaperRestingOrder = PhoenixOpenOrder & {
  marginUsd: number;
  leverage: number;
  notionalUsd: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean;
};

export type PaperLedger = {
  version: 1;
  cashUsd: number;
  positions: PhoenixPosition[];
  orders: PaperRestingOrder[];
  nextOrderId: number;
  nextSubaccount: number;
  /** Monotonic source for deterministic paper-event-N event signatures. */
  nextEventId: number;
};

export type PaperPlaceOrderInput = {
  symbol: string;
  side: PhoenixSide;
  orderType: "market" | "limit";
  notionalUsd: number;
  leverage: number;
  /** Fill price for market; limit price for resting orders. */
  price: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean;
};

export type PaperEvent = {
  kind: "open" | "close" | "tp" | "sl" | "liq" | "limit_fill";
  symbol: string;
  side: PhoenixSide;
  notionalUsd: number;
  price: number;
  leverage: number | null;
  realizedPnlUsd: number;
  signature: string;
};

/** Event before its deterministic signature is stamped on. */
type PaperEventSeed = Omit<PaperEvent, "signature">;

export function createEmptyLedger(
  cashUsd = PAPER_STARTING_BALANCE,
): PaperLedger {
  return {
    version: 1,
    cashUsd,
    positions: [],
    orders: [],
    nextOrderId: 1,
    nextSubaccount: 1,
    nextEventId: 1,
  };
}

export function resetPaperLedger(): PaperLedger {
  return createEmptyLedger();
}

export function topUpPaperCash(
  ledger: PaperLedger,
  amount: number,
): PaperLedger {
  if (!Number.isFinite(amount) || amount <= 0) return ledger;
  return { ...ledger, cashUsd: ledger.cashUsd + amount };
}

export function ledgerToTraderState(ledger: PaperLedger): PhoenixTraderState {
  const marginInPositions = ledger.positions.reduce(
    (sum, position) => sum + (position.marginUsd ?? 0),
    0,
  );
  const marginInOrders = ledger.orders.reduce(
    (sum, order) => sum + order.marginUsd,
    0,
  );
  const total = ledger.cashUsd + marginInPositions + marginInOrders;
  return {
    registered: true,
    chainVerified: true,
    apiSlot: null,
    collateralUsd: ledger.cashUsd,
    totalCollateralUsd: total,
    effectiveCollateralUsd: total,
    unrealizedPnlUsd: null,
    riskTier: "paper",
    positions: ledger.positions.map((position) => ({ ...position })),
    orders: ledger.orders.map((order) => ({
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      remaining: order.remaining,
      orderSequenceNumber: order.orderSequenceNumber,
      isStopLoss: order.isStopLoss,
      isStopLossDirection: order.isStopLossDirection,
      traderPdaIndex: order.traderPdaIndex,
      subaccountIndex: order.subaccountIndex,
    })),
  };
}

// Stamp a run of event seeds with deterministic, monotonically increasing
// `paper-event-N` signatures sourced from the ledger's counter. Returns the
// stamped events and the next counter value; the caller writes that value
// onto the returned ledger so subsequent calls keep climbing.
function stampEvents(
  ledger: PaperLedger,
  seeds: PaperEventSeed[],
): { events: PaperEvent[]; nextEventId: number } {
  let nextEventId = ledger.nextEventId;
  const events: PaperEvent[] = seeds.map((seed) => {
    const signature = `paper-event-${nextEventId}`;
    nextEventId += 1;
    return { ...seed, signature };
  });
  return { events, nextEventId };
}

function signedSize(side: PhoenixSide, baseQty: number): number {
  return side === "bid" ? baseQty : -baseQty;
}

function validateTriggers(
  side: PhoenixSide,
  refPrice: number,
  takeProfitPrice: number | null,
  stopLossPrice: number | null,
): void {
  if (takeProfitPrice !== null) {
    const valid =
      side === "bid" ? takeProfitPrice > refPrice : takeProfitPrice < refPrice;
    if (!valid) {
      throw new Error(
        `Take profit must be ${side === "bid" ? "above" : "below"} entry`,
      );
    }
  }
  if (stopLossPrice !== null) {
    const valid =
      side === "bid" ? stopLossPrice < refPrice : stopLossPrice > refPrice;
    if (!valid) {
      throw new Error(
        `Stop loss must be ${side === "bid" ? "below" : "above"} entry`,
      );
    }
  }
}

function findPosition(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex?: number,
): PhoenixPosition | undefined {
  if (subaccountIndex !== undefined) {
    return ledger.positions.find(
      (position) =>
        position.symbol === symbol &&
        position.subaccountIndex === subaccountIndex,
    );
  }
  return ledger.positions.find((position) => position.symbol === symbol);
}

function replacePosition(
  ledger: PaperLedger,
  next: PhoenixPosition | null,
  symbol: string,
  subaccountIndex: number,
): PaperLedger {
  const positions = ledger.positions.filter(
    (position) =>
      !(
        position.symbol === symbol &&
        position.subaccountIndex === subaccountIndex
      ),
  );
  if (next && next.size !== 0) positions.push(next);
  return { ...ledger, positions };
}

function realizedPnl(
  entry: number,
  exit: number,
  closedSignedSize: number,
): number {
  return (exit - entry) * closedSignedSize;
}

// Validate every exposed domain input up front so a malformed order throws
// before any ledger work — keeping the caller's ledger untouched on reject.
function validateOrderInput(input: PaperPlaceOrderInput): void {
  if (!Number.isFinite(input.leverage) || input.leverage < 1) {
    throw new Error("Invalid paper leverage");
  }
  if (
    !Number.isFinite(input.notionalUsd) ||
    input.notionalUsd <= 0 ||
    !Number.isFinite(input.price) ||
    input.price <= 0
  ) {
    throw new Error("Invalid paper order size or price");
  }
}

// Settlement cap: a close can never lose more than the margin it releases.
// Negative realized PnL is floored at -releasedMargin (forfeit exactly the
// backing margin); profits stay uncapped. The returned cash delta is
// therefore always >= 0 — closes never draw cash below where it stood.
function settlePnl(rawPnl: number, releasedMargin: number): number {
  if (rawPnl >= 0) return rawPnl;
  return Math.max(rawPnl, -releasedMargin);
}

// For a same-side add: an explicit (non-null) trigger is validated against
// the weighted entry by the caller; a null trigger means "inherit" — retain
// the position's existing trigger only if it is still valid against the new
// weighted entry, otherwise clear it independently (not a rejection).
function resolveInheritedTrigger(
  kind: "tp" | "sl",
  side: PhoenixSide,
  refPrice: number,
  explicit: number | null,
  inherited: number | null,
): number | null {
  if (explicit !== null) return explicit;
  if (inherited === null) return null;
  const stillValid =
    kind === "tp"
      ? side === "bid"
        ? inherited > refPrice
        : inherited < refPrice
      : side === "bid"
        ? inherited < refPrice
        : inherited > refPrice;
  return stillValid ? inherited : null;
}

// Close a fraction [0,1] of a position at price. Pure reduction path shared
// by manual closes, TP/SL triggers, and the close leg of a reversal: it
// releases proportional margin, caps the realized loss at the released
// margin (cash never dips on a close), and returns an UNSTAMPED event seed.
// `fraction` must already be a finite value in [0,1] — callers validate.
function closePositionSeed(
  ledger: PaperLedger,
  position: PhoenixPosition,
  fraction: number,
  price: number,
  kind: PaperEvent["kind"],
): { ledger: PaperLedger; seed: PaperEventSeed } {
  const frac = Math.min(1, Math.max(0, fraction));
  const closedSignedSize = position.size * frac;
  const releasedMargin = (position.marginUsd ?? 0) * frac;
  const rawPnl = realizedPnl(
    position.entryPrice ?? price,
    price,
    closedSignedSize,
  );
  const pnl = settlePnl(rawPnl, releasedMargin);
  const side: PhoenixSide = position.size > 0 ? "ask" : "bid";
  const notionalUsd = Math.abs(closedSignedSize) * price;

  const remainingSize = position.size - closedSignedSize;
  let nextLedger: PaperLedger = {
    ...ledger,
    cashUsd: ledger.cashUsd + releasedMargin + pnl,
  };

  if (Math.abs(remainingSize) <= QTY_EPS) {
    nextLedger = replacePosition(
      nextLedger,
      null,
      position.symbol,
      position.subaccountIndex,
    );
  } else {
    nextLedger = replacePosition(
      nextLedger,
      {
        ...position,
        size: remainingSize,
        marginUsd: (position.marginUsd ?? 0) - releasedMargin,
        positionValue: Math.abs(remainingSize) * price,
        unrealizedPnl: null,
      },
      position.symbol,
      position.subaccountIndex,
    );
  }

  return {
    ledger: nextLedger,
    seed: {
      kind,
      symbol: position.symbol,
      side,
      notionalUsd,
      price,
      leverage: null,
      realizedPnlUsd: pnl,
    },
  };
}

/** Close fraction of a position at price; returns margin+pnl to cash.
 * A non-finite or non-positive fraction/price is a no-op (input returned
 * unchanged, no event) — the fraction must be finite. */
export function closePaperPosition(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  fraction: number,
  price: number,
  kind: PaperEvent["kind"] = "close",
): { ledger: PaperLedger; event: PaperEvent | null } {
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position || position.size === 0 || !position.entryPrice) {
    return { ledger, event: null };
  }
  if (
    !Number.isFinite(fraction) ||
    fraction <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return { ledger, event: null };
  }

  const { ledger: nextLedger, seed } = closePositionSeed(
    ledger,
    position,
    fraction,
    price,
    kind,
  );
  const { events, nextEventId } = stampEvents(ledger, [seed]);
  return {
    ledger: { ...nextLedger, nextEventId },
    event: events[0] ?? null,
  };
}

// Atomic market-order engine. Returns the complete next ledger + UNSTAMPED
// event seeds, or throws without mutating the input ledger. Branches on the
// existing position: open fresh, same-side add, pure reduction, or reversal.
// Opposite fills split into closingQty = min(incoming, existing) and the
// residual openingQty; pure reductions / exact flattens need zero new margin,
// and a reversal charges margin only for the residual opening exposure
// (emitting a deterministic close seed THEN an open seed). If the residual
// can't be funded after the close releases its margin + realized PnL, the
// WHOLE order is rejected and the input ledger is left untouched.
function applyMarketOrder(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
): { ledger: PaperLedger; seeds: PaperEventSeed[] } {
  const fillPrice = input.price;
  const incomingQty = input.notionalUsd / fillPrice;
  const existing = findPosition(ledger, input.symbol);

  if (!existing || existing.size === 0) {
    if (input.reduceOnly) throw new Error("No position to reduce");
    return openFreshPosition(ledger, input, fillPrice);
  }

  const sameSide =
    Math.sign(existing.size) === Math.sign(signedSize(input.side, incomingQty));
  if (sameSide) {
    if (input.reduceOnly) {
      throw new Error("Reduce-only order must close the open side");
    }
    return addToPosition(ledger, input, existing, fillPrice);
  }

  // Opposite side: split into the reduction (close) and any residual reversal.
  const closingQty = Math.min(incomingQty, Math.abs(existing.size));
  const openingQty = incomingQty - closingQty;
  if (input.reduceOnly && openingQty > QTY_EPS) {
    throw new Error("Reduce-only order must not open new exposure");
  }
  return reduceOrReversePosition(
    ledger,
    input,
    existing,
    closingQty,
    openingQty,
    fillPrice,
  );
}

function openFreshPosition(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  fillPrice: number,
): { ledger: PaperLedger; seeds: PaperEventSeed[] } {
  const leverage = input.leverage;
  const marginUsd = input.notionalUsd / leverage;
  if (ledger.cashUsd + CASH_EPS < marginUsd) {
    throw new Error(
      `Insufficient paper balance — need $${marginUsd.toFixed(2)}, have $${ledger.cashUsd.toFixed(2)}`,
    );
  }
  validateTriggers(
    input.side,
    fillPrice,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  const addSigned = signedSize(input.side, input.notionalUsd / fillPrice);
  const subaccountIndex = ledger.nextSubaccount;
  const nextLedger: PaperLedger = {
    ...replacePosition(
      { ...ledger, cashUsd: ledger.cashUsd - marginUsd },
      {
        symbol: input.symbol,
        size: addSigned,
        entryPrice: fillPrice,
        liquidationPrice: null,
        unrealizedPnl: null,
        positionValue: input.notionalUsd,
        takeProfitPrice: input.takeProfitPrice,
        stopLossPrice: input.stopLossPrice,
        traderPdaIndex: 0,
        subaccountIndex,
        marginUsd,
      },
      input.symbol,
      subaccountIndex,
    ),
    nextSubaccount: subaccountIndex + 1,
  };
  return {
    ledger: nextLedger,
    seeds: [
      {
        kind: "open",
        symbol: input.symbol,
        side: input.side,
        notionalUsd: input.notionalUsd,
        price: fillPrice,
        leverage,
        realizedPnlUsd: 0,
      },
    ],
  };
}

function addToPosition(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  existing: PhoenixPosition,
  fillPrice: number,
): { ledger: PaperLedger; seeds: PaperEventSeed[] } {
  const leverage = input.leverage;
  const marginUsd = input.notionalUsd / leverage;
  const addSigned = signedSize(input.side, input.notionalUsd / fillPrice);

  // Weighted entry is computed FIRST so triggers validate against it: an
  // explicit non-null TP/SL that is invalid against the new blended entry
  // rejects the whole add.
  const oldAbs = Math.abs(existing.size);
  const addAbs = Math.abs(addSigned);
  const oldEntry = existing.entryPrice ?? fillPrice;
  const weightedEntry =
    (oldEntry * oldAbs + fillPrice * addAbs) / (oldAbs + addAbs);
  validateTriggers(
    input.side,
    weightedEntry,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  // Null triggers inherit; retain an inherited trigger only if it is still
  // valid against the weighted entry, otherwise clear it independently.
  const takeProfitPrice = resolveInheritedTrigger(
    "tp",
    input.side,
    weightedEntry,
    input.takeProfitPrice,
    existing.takeProfitPrice,
  );
  const stopLossPrice = resolveInheritedTrigger(
    "sl",
    input.side,
    weightedEntry,
    input.stopLossPrice,
    existing.stopLossPrice,
  );

  if (ledger.cashUsd + CASH_EPS < marginUsd) {
    throw new Error(
      `Insufficient paper balance — need $${marginUsd.toFixed(2)}, have $${ledger.cashUsd.toFixed(2)}`,
    );
  }

  const nextLedger = replacePosition(
    { ...ledger, cashUsd: ledger.cashUsd - marginUsd },
    {
      ...existing,
      size: existing.size + addSigned,
      entryPrice: weightedEntry,
      marginUsd: (existing.marginUsd ?? 0) + marginUsd,
      takeProfitPrice,
      stopLossPrice,
      positionValue: Math.abs(existing.size + addSigned) * fillPrice,
      unrealizedPnl: null,
      liquidationPrice: null,
    },
    existing.symbol,
    existing.subaccountIndex,
  );
  return {
    ledger: nextLedger,
    seeds: [
      {
        kind: "open",
        symbol: input.symbol,
        side: input.side,
        notionalUsd: input.notionalUsd,
        price: fillPrice,
        leverage,
        realizedPnlUsd: 0,
      },
    ],
  };
}

function reduceOrReversePosition(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  existing: PhoenixPosition,
  closingQty: number,
  openingQty: number,
  fillPrice: number,
): { ledger: PaperLedger; seeds: PaperEventSeed[] } {
  // Close leg: pure reduction / exact flatten need zero new margin.
  const closeFrac = closingQty / Math.abs(existing.size);
  const closed = closePositionSeed(
    ledger,
    existing,
    closeFrac,
    fillPrice,
    "close",
  );
  let nextLedger = closed.ledger;
  const seeds: PaperEventSeed[] = [closed.seed];

  if (openingQty <= QTY_EPS) {
    // Pure reduction (or exact flatten): nothing to open.
    return { ledger: nextLedger, seeds };
  }

  // Reversal: open the residual on the incoming side. Margin is charged only
  // for that residual exposure, funded from cash freed by the close leg
  // (released margin + realized PnL). If it can't be funded, reject the
  // WHOLE order — the input ledger is untouched (we never returned nextLedger).
  const leverage = input.leverage;
  const openNotional = openingQty * fillPrice;
  const openMargin = openNotional / leverage;
  if (nextLedger.cashUsd + CASH_EPS < openMargin) {
    throw new Error(
      `Insufficient paper balance to reverse — need $${openMargin.toFixed(2)}, have $${nextLedger.cashUsd.toFixed(2)}`,
    );
  }
  validateTriggers(
    input.side,
    fillPrice,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  const openSigned = signedSize(input.side, openingQty);
  const subaccountIndex = nextLedger.nextSubaccount;
  nextLedger = {
    ...replacePosition(
      { ...nextLedger, cashUsd: nextLedger.cashUsd - openMargin },
      {
        symbol: input.symbol,
        size: openSigned,
        entryPrice: fillPrice,
        liquidationPrice: null,
        unrealizedPnl: null,
        positionValue: openNotional,
        takeProfitPrice: input.takeProfitPrice,
        stopLossPrice: input.stopLossPrice,
        traderPdaIndex: 0,
        subaccountIndex,
        marginUsd: openMargin,
      },
      input.symbol,
      subaccountIndex,
    ),
    nextSubaccount: subaccountIndex + 1,
  };
  // Deterministic order: the close event precedes the open event.
  seeds.push({
    kind: "open",
    symbol: input.symbol,
    side: input.side,
    notionalUsd: openNotional,
    price: fillPrice,
    leverage,
    realizedPnlUsd: 0,
  });
  return { ledger: nextLedger, seeds };
}

// Margin a resting limit order must hold against the CURRENT ledger. Opposite-
// side limits reserve only the residual opening exposure (incoming − existing);
// reduce-only and pure reductions reserve zero. Same-side adds and fresh opens
// reserve the full incoming notional's margin. Recomputed atomically at fill.
function reservedMarginFor(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  incomingQty: number,
): number {
  const leverage = input.leverage;
  if (input.reduceOnly) return 0;
  const existing = findPosition(ledger, input.symbol);
  if (!existing || existing.size === 0) {
    return input.notionalUsd / leverage;
  }
  const sameSide =
    Math.sign(existing.size) === Math.sign(signedSize(input.side, incomingQty));
  if (sameSide) {
    return input.notionalUsd / leverage;
  }
  const closingQty = Math.min(incomingQty, Math.abs(existing.size));
  const openingQty = incomingQty - closingQty;
  return (openingQty * input.price) / leverage;
}

function placeLimitOrder(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
): { ledger: PaperLedger; events: PaperEvent[] } {
  validateTriggers(
    input.side,
    input.price,
    input.takeProfitPrice,
    input.stopLossPrice,
  );
  const incomingQty = input.notionalUsd / input.price;
  const reservedMargin = reservedMarginFor(ledger, input, incomingQty);
  if (reservedMargin > 0 && ledger.cashUsd + CASH_EPS < reservedMargin) {
    throw new Error(
      `Insufficient paper balance — need $${reservedMargin.toFixed(2)}, have $${ledger.cashUsd.toFixed(2)}`,
    );
  }
  const orderId = `paper-${ledger.nextOrderId}`;
  const order: PaperRestingOrder = {
    symbol: input.symbol,
    side: input.side,
    price: input.price,
    remaining: incomingQty,
    orderSequenceNumber: orderId,
    isStopLoss: false,
    isStopLossDirection: false,
    traderPdaIndex: 0,
    subaccountIndex: 0,
    marginUsd: reservedMargin,
    leverage: input.leverage,
    notionalUsd: input.notionalUsd,
    takeProfitPrice: input.takeProfitPrice,
    stopLossPrice: input.stopLossPrice,
    reduceOnly: input.reduceOnly,
  };
  return {
    ledger: {
      ...ledger,
      cashUsd: ledger.cashUsd - reservedMargin,
      orders: [...ledger.orders, order],
      nextOrderId: ledger.nextOrderId + 1,
    },
    events: [],
  };
}

export function placePaperOrder(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
): { ledger: PaperLedger; events: PaperEvent[] } {
  validateOrderInput(input);
  if (input.orderType === "limit") {
    return placeLimitOrder(ledger, input);
  }
  // Market: atomic open/add/reduce/reverse. Stamps seeds against the input
  // counter so the returned ledger climbs from where the caller stood.
  const { ledger: nextLedger, seeds } = applyMarketOrder(ledger, input);
  const { events, nextEventId } = stampEvents(ledger, seeds);
  return { ledger: { ...nextLedger, nextEventId }, events };
}

export function cancelPaperOrder(
  ledger: PaperLedger,
  orderSequenceNumber: string,
): PaperLedger {
  const order = ledger.orders.find(
    (row) => row.orderSequenceNumber === orderSequenceNumber,
  );
  if (!order) return ledger;
  return {
    ...ledger,
    cashUsd: ledger.cashUsd + order.marginUsd,
    orders: ledger.orders.filter(
      (row) => row.orderSequenceNumber !== orderSequenceNumber,
    ),
  };
}

export function cancelPaperOrdersOnSide(
  ledger: PaperLedger,
  symbol: string,
  side: PhoenixSide,
): PaperLedger {
  let next = ledger;
  for (const order of ledger.orders) {
    if (order.symbol === symbol && order.side === side) {
      next = cancelPaperOrder(next, order.orderSequenceNumber);
    }
  }
  return next;
}

export function setPaperTpSl(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  patch: { takeProfitPrice?: number | null; stopLossPrice?: number | null },
): PaperLedger {
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position || !position.entryPrice) return ledger;
  const side: PhoenixSide = position.size > 0 ? "bid" : "ask";
  const tp =
    patch.takeProfitPrice !== undefined
      ? patch.takeProfitPrice
      : position.takeProfitPrice;
  const sl =
    patch.stopLossPrice !== undefined
      ? patch.stopLossPrice
      : position.stopLossPrice;
  if (tp != null && tp > 0)
    validateTriggers(side, position.entryPrice, tp, null);
  if (sl != null && sl > 0)
    validateTriggers(side, position.entryPrice, null, sl);
  return replacePosition(
    ledger,
    {
      ...position,
      takeProfitPrice: tp && tp > 0 ? tp : null,
      stopLossPrice: sl && sl > 0 ? sl : null,
    },
    symbol,
    subaccountIndex,
  );
}

export function addPaperMargin(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  amount: number,
): PaperLedger {
  if (!Number.isFinite(amount) || amount <= 0) return ledger;
  if (ledger.cashUsd + 1e-9 < amount) {
    throw new Error("Insufficient paper free collateral");
  }
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position) throw new Error("Position not found");
  return {
    ...replacePosition(
      ledger,
      {
        ...position,
        marginUsd: (position.marginUsd ?? 0) + amount,
      },
      symbol,
      subaccountIndex,
    ),
    cashUsd: ledger.cashUsd - amount,
  };
}

function currentPaperMark(
  mark: PaperMark | undefined,
  nowMs: number,
  ttlMs: number,
): PaperMark | null {
  if (!mark) return null;
  const age = nowMs - mark.asOfMs;
  if (
    !Number.isFinite(ttlMs) ||
    ttlMs < 0 ||
    !Number.isFinite(mark.price) ||
    mark.price <= 0 ||
    !Number.isFinite(mark.asOfMs) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > ttlMs ||
    !Number.isFinite(mark.maintenanceMarginRatio) ||
    mark.maintenanceMarginRatio < 0
  ) {
    return null;
  }
  return mark;
}

/**
 * Advance the ledger against fresh executable marks: fill crossed limits,
 * liquidate, then fire TP/SL. Liquidation is checked BEFORE TP/SL so a gap
 * through both emits liq only (margin forfeited exactly once). Missing, stale,
 * future-dated, or malformed marks produce no price-driven transition.
 */
export function tickPaperLedger(
  ledger: PaperLedger,
  marks: Record<string, PaperMark>,
  nowMs: number,
  ttlMs = PAPER_MARK_TTL_MS,
): { ledger: PaperLedger; events: PaperEvent[] } {
  let next = ledger;
  const events: PaperEvent[] = [];

  // Resting limits: release the reservation, then recompute the order
  // atomically against the CURRENT ledger (state may have moved since place).
  // If it no longer funds, cancel — order removed, reservation returned, no
  // partial state mutation.
  for (const order of [...next.orders]) {
    const mark = currentPaperMark(marks[order.symbol], nowMs, ttlMs);
    if (!mark || !order.price || !order.remaining) continue;
    const mid = mark.price;
    const crossed =
      order.side === "bid" ? mid <= order.price : mid >= order.price;
    if (!crossed) continue;

    const released: PaperLedger = {
      ...next,
      cashUsd: next.cashUsd + order.marginUsd,
      orders: next.orders.filter(
        (row) => row.orderSequenceNumber !== order.orderSequenceNumber,
      ),
    };
    const notionalUsd = order.remaining * order.price;
    try {
      const filled = placePaperOrder(released, {
        symbol: order.symbol,
        side: order.side,
        orderType: "market",
        notionalUsd,
        leverage: order.leverage,
        price: order.price,
        takeProfitPrice: order.takeProfitPrice,
        stopLossPrice: order.stopLossPrice,
        reduceOnly: order.reduceOnly,
      });
      next = filled.ledger;
      for (const event of filled.events) {
        // A crossed limit changes only an opening/add event into a
        // limit_fill. Reduction/reversal close legs stay "close" so the
        // journal cannot mislabel realized PnL as a fresh short/long.
        events.push(
          event.kind === "open" ? { ...event, kind: "limit_fill" } : event,
        );
      }
    } catch {
      // No longer fundable / can't open: cancel, reservation already returned.
      next = released;
    }
  }

  // Liquidation (first) → TP → SL. Collect UNSTAMPED seeds and stamp them at
  // the end so ids climb monotonically off whatever the limit fills consumed.
  const positionSeeds: PaperEventSeed[] = [];
  for (const position of [...next.positions]) {
    const mark = currentPaperMark(marks[position.symbol], nowMs, ttlMs);
    if (!mark || !position.entryPrice || position.size === 0) continue;
    const mid = mark.price;
    const long = position.size > 0;
    const margin = position.marginUsd ?? 0;

    const liqEstimate = liquidationPriceEstimate(
      position.entryPrice,
      position.size,
      margin,
      mark.maintenanceMarginRatio,
    );
    if (liqEstimate !== null) {
      const hit = long ? mid <= liqEstimate : mid >= liqEstimate;
      if (hit) {
        // Liquidation: forfeit the remaining margin exactly once, zero the
        // position. Cash is unchanged (margin was locked at open, now forfeit).
        next = replacePosition(
          next,
          null,
          position.symbol,
          position.subaccountIndex,
        );
        const notional = Math.abs(position.size) * mid;
        const lev =
          margin > 0
            ? (Math.abs(position.size) * position.entryPrice) / margin
            : null;
        positionSeeds.push({
          kind: "liq",
          symbol: position.symbol,
          side: long ? "ask" : "bid",
          notionalUsd: notional,
          price: mid,
          leverage: lev,
          realizedPnlUsd: -margin,
        });
        continue;
      }
    }

    const tp = position.takeProfitPrice;
    if (tp !== null && tp > 0) {
      const hit = long ? mid >= tp : mid <= tp;
      if (hit) {
        const closed = closePositionSeed(next, position, 1, tp, "tp");
        next = closed.ledger;
        positionSeeds.push(closed.seed);
        continue;
      }
    }

    const sl = position.stopLossPrice;
    if (sl !== null && sl > 0) {
      const hit = long ? mid <= sl : mid >= sl;
      if (hit) {
        const closed = closePositionSeed(next, position, 1, sl, "sl");
        next = closed.ledger;
        positionSeeds.push(closed.seed);
      }
    }
  }

  if (positionSeeds.length > 0) {
    let eventId = next.nextEventId;
    for (const seed of positionSeeds) {
      events.push({ ...seed, signature: `paper-event-${eventId}` });
      eventId += 1;
    }
    next = { ...next, nextEventId: eventId };
  }

  return { ledger: next, events };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPaperSymbol(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
  );
}

function isPaperSide(value: unknown): value is PhoenixSide {
  return value === "bid" || value === "ask";
}

function nullablePositiveNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isPositiveNumber(value) ? value : undefined;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isFiniteNumber(value) ? value : undefined;
}

function triggersAreOriented(
  side: PhoenixSide,
  refPrice: number,
  takeProfitPrice: number | null,
  stopLossPrice: number | null,
): boolean {
  if (takeProfitPrice !== null) {
    const valid =
      side === "bid" ? takeProfitPrice > refPrice : takeProfitPrice < refPrice;
    if (!valid) return false;
  }
  if (stopLossPrice !== null) {
    const valid =
      side === "bid" ? stopLossPrice < refPrice : stopLossPrice > refPrice;
    if (!valid) return false;
  }
  return true;
}

function paperOrderIdNumber(value: string): number | null {
  const match = /^paper-([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

function parsePaperPosition(value: unknown): PhoenixPosition | null {
  if (!isRecord(value)) return null;
  const symbol = value.symbol;
  const size = value.size;
  const entryPrice = value.entryPrice;
  const liquidationPrice = nullablePositiveNumber(value.liquidationPrice);
  const unrealizedPnl = nullableFiniteNumber(value.unrealizedPnl);
  const positionValue = value.positionValue;
  const takeProfitPrice = nullablePositiveNumber(value.takeProfitPrice);
  const stopLossPrice = nullablePositiveNumber(value.stopLossPrice);
  const traderPdaIndex = value.traderPdaIndex;
  const subaccountIndex = value.subaccountIndex;
  const marginUsd = value.marginUsd;
  if (
    !isPaperSymbol(symbol) ||
    !isFiniteNumber(size) ||
    size === 0 ||
    !isPositiveNumber(entryPrice) ||
    liquidationPrice === undefined ||
    unrealizedPnl === undefined ||
    !isPositiveNumber(positionValue) ||
    takeProfitPrice === undefined ||
    stopLossPrice === undefined ||
    !isNonNegativeSafeInteger(traderPdaIndex) ||
    !isPositiveSafeInteger(subaccountIndex) ||
    !isNonNegativeNumber(marginUsd)
  ) {
    return null;
  }
  const side: PhoenixSide = size > 0 ? "bid" : "ask";
  if (!triggersAreOriented(side, entryPrice, takeProfitPrice, stopLossPrice)) {
    return null;
  }
  return {
    symbol,
    size,
    entryPrice,
    liquidationPrice,
    unrealizedPnl,
    positionValue,
    takeProfitPrice,
    stopLossPrice,
    traderPdaIndex,
    subaccountIndex,
    marginUsd,
  };
}

function parsePaperOrder(value: unknown): PaperRestingOrder | null {
  if (!isRecord(value)) return null;
  const symbol = value.symbol;
  const side = value.side;
  const price = value.price;
  const remaining = value.remaining;
  const orderSequenceNumber = value.orderSequenceNumber;
  const traderPdaIndex = value.traderPdaIndex;
  const subaccountIndex = value.subaccountIndex;
  const marginUsd = value.marginUsd;
  const leverage = value.leverage;
  const notionalUsd = value.notionalUsd;
  const takeProfitPrice = nullablePositiveNumber(value.takeProfitPrice);
  const stopLossPrice = nullablePositiveNumber(value.stopLossPrice);
  const reduceOnly = value.reduceOnly;
  if (
    !isPaperSymbol(symbol) ||
    !isPaperSide(side) ||
    !isPositiveNumber(price) ||
    !isPositiveNumber(remaining) ||
    typeof orderSequenceNumber !== "string" ||
    paperOrderIdNumber(orderSequenceNumber) === null ||
    typeof value.isStopLoss !== "boolean" ||
    typeof value.isStopLossDirection !== "boolean" ||
    !isNonNegativeSafeInteger(traderPdaIndex) ||
    !isNonNegativeSafeInteger(subaccountIndex) ||
    !isNonNegativeNumber(marginUsd) ||
    !isFiniteNumber(leverage) ||
    leverage < 1 ||
    !isPositiveNumber(notionalUsd) ||
    takeProfitPrice === undefined ||
    stopLossPrice === undefined ||
    typeof reduceOnly !== "boolean"
  ) {
    return null;
  }
  if (!triggersAreOriented(side, price, takeProfitPrice, stopLossPrice)) {
    return null;
  }
  return {
    symbol,
    side,
    price,
    remaining,
    orderSequenceNumber,
    isStopLoss: value.isStopLoss,
    isStopLossDirection: value.isStopLossDirection,
    traderPdaIndex,
    subaccountIndex,
    marginUsd,
    leverage,
    notionalUsd,
    takeProfitPrice,
    stopLossPrice,
    reduceOnly,
  };
}

export function parsePaperLedger(value: unknown): PaperLedger {
  if (!isRecord(value)) return createEmptyLedger();
  if (
    value.version !== 1 ||
    !isNonNegativeNumber(value.cashUsd) ||
    !Array.isArray(value.positions) ||
    !Array.isArray(value.orders) ||
    !isPositiveSafeInteger(value.nextOrderId) ||
    !isPositiveSafeInteger(value.nextSubaccount) ||
    !isPositiveSafeInteger(value.nextEventId)
  ) {
    return createEmptyLedger();
  }

  const positions: PhoenixPosition[] = [];
  const positionSymbols = new Set<string>();
  const positionSubaccounts = new Set<string>();
  let maxSubaccount = 0;
  for (const item of value.positions) {
    const position = parsePaperPosition(item);
    if (!position) return createEmptyLedger();
    const subaccountKey = `${position.symbol}:${position.subaccountIndex}`;
    if (
      positionSymbols.has(position.symbol) ||
      positionSubaccounts.has(subaccountKey)
    ) {
      return createEmptyLedger();
    }
    positionSymbols.add(position.symbol);
    positionSubaccounts.add(subaccountKey);
    maxSubaccount = Math.max(maxSubaccount, position.subaccountIndex);
    positions.push(position);
  }

  const orders: PaperRestingOrder[] = [];
  const orderIds = new Set<string>();
  let maxOrderId = 0;
  for (const item of value.orders) {
    const order = parsePaperOrder(item);
    if (!order) return createEmptyLedger();
    const orderId = paperOrderIdNumber(order.orderSequenceNumber);
    if (orderId === null || orderIds.has(order.orderSequenceNumber)) {
      return createEmptyLedger();
    }
    orderIds.add(order.orderSequenceNumber);
    maxOrderId = Math.max(maxOrderId, orderId);
    maxSubaccount = Math.max(maxSubaccount, order.subaccountIndex ?? 0);
    orders.push(order);
  }

  if (
    value.nextOrderId <= maxOrderId ||
    value.nextSubaccount <= maxSubaccount
  ) {
    return createEmptyLedger();
  }

  return {
    version: 1,
    cashUsd: value.cashUsd,
    positions,
    orders,
    nextOrderId: value.nextOrderId,
    nextSubaccount: value.nextSubaccount,
    nextEventId: value.nextEventId,
  };
}

export const paperLedger = persisted<PaperLedger>(
  PAPER_STORAGE_KEY,
  createEmptyLedger(),
  parsePaperLedger,
);
