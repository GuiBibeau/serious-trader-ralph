import { describe, expect, test } from "bun:test";
import {
  mergeTraderView,
  type PhoenixTraderState,
  parseTraderStatePayload,
} from "./phoenix-trade";

// Lot decimals mirror the live /exchange config for the fixture symbols
// (ANSEM baseLotsDecimals=0 → 1 lot = 1 unit; AAPL=3 → 1 lot = 0.001).
const LOT_DECIMALS: Record<string, number> = { ANSEM: 0, AAPL: 3 };
const lotDecimalsFor = (symbol: string): number => LOT_DECIMALS[symbol] ?? 0;

// Trimmed from the live /v1/trader/state payload of an authority holding a
// cross AAPL position on the parent (sub 0) and an isolated ANSEM long on a
// child (sub 16) — the exact shape observed 2026-07-18. Isolated positions
// arrive inside snapshot.subaccounts like cross ones; only the index and
// per-child collateral differ.
const FIXTURE: Record<string, unknown> = {
  authority: "BJsbrDPdpxvzP35TYJ7gmrcumqxVSqwDeEb4Gg3aV4Ax",
  traderPdaIndex: 0,
  slot: 433760158,
  slotIndex: 1157,
  snapshot: {
    version: 1,
    subaccounts: [
      {
        subaccountIndex: 0,
        sequence: 0,
        collateral: "5244530886",
        positions: [
          {
            symbol: "AAPL",
            positionSequenceNumber: "52",
            basePositionLots: "8",
            entryPriceTicks: "33286",
            entryPriceUsd: "332.86",
            virtualQuotePositionLots: "-2662880",
            takeProfitTriggers: [],
            stopLossTriggers: [],
          },
        ],
      },
      // Registered-but-flat isolated child: no positions key at all.
      { subaccountIndex: 7, sequence: 0, collateral: "0" },
      {
        subaccountIndex: 16,
        sequence: 0,
        collateral: "76679932",
        positions: [
          {
            symbol: "ANSEM",
            positionSequenceNumber: "31",
            basePositionLots: "5",
            entryPriceTicks: "18005",
            entryPriceUsd: "0.18005",
            virtualQuotePositionLots: "-900250",
            takeProfitTriggers: [],
            stopLossTriggers: [{ triggerPriceUsd: 0.171 }],
          },
        ],
      },
    ],
  },
};

describe("parseTraderStatePayload", () => {
  test("no snapshot → null (unregistered wallet)", () => {
    expect(parseTraderStatePayload({}, lotDecimalsFor)).toBeNull();
    expect(
      parseTraderStatePayload({ error: "Trader not found" }, lotDecimalsFor),
    ).toBeNull();
  });

  test("isolated-subaccount position surfaces with its true indices", () => {
    const parsed = parseTraderStatePayload(FIXTURE, lotDecimalsFor);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.traderPdaIndex).toBe(0);
    // Every registered subaccount is reported, positions or not — the view
    // merge must query flat children too (resting isolated orders).
    expect(parsed.subaccountIndexes).toEqual([0, 7, 16]);
    expect(parsed.state.registered).toBe(true);
    expect(parsed.state.apiSlot).toBe(433760158);
    // Free cross collateral = parent only; total = every subaccount.
    expect(parsed.state.collateralUsd).toBe(5244.530886);
    expect(parsed.state.totalCollateralUsd).toBe(5244.530886 + 0 + 76.679932);
    expect(parsed.state.positions).toEqual([
      {
        symbol: "AAPL",
        size: 0.008,
        entryPrice: 332.86,
        liquidationPrice: null,
        unrealizedPnl: null,
        positionValue: 2.66288,
        takeProfitPrice: null,
        stopLossPrice: null,
        traderPdaIndex: 0,
        subaccountIndex: 0,
        marginUsd: 5244.530886,
      },
      {
        symbol: "ANSEM",
        size: 5,
        entryPrice: 0.18005,
        liquidationPrice: null,
        unrealizedPnl: null,
        positionValue: 0.90025,
        takeProfitPrice: null,
        stopLossPrice: 0.171,
        traderPdaIndex: 0,
        subaccountIndex: 16,
        marginUsd: 76.679932,
      },
    ]);
    expect(parsed.state.orders).toEqual([]);
  });

  test("zero-lot entries are dropped, not rendered as phantom rows", () => {
    const parsed = parseTraderStatePayload(
      {
        traderPdaIndex: 0,
        snapshot: {
          subaccounts: [
            {
              subaccountIndex: 0,
              collateral: "1000000",
              positions: [
                { symbol: "AAPL", basePositionLots: "0" },
                { symbol: "AAPL", basePositionLots: "not-a-number" },
              ],
            },
          ],
        },
      },
      lotDecimalsFor,
    );
    expect(parsed?.state.positions).toEqual([]);
  });
});

describe("mergeTraderView", () => {
  function parsedState(): PhoenixTraderState {
    const parsed = parseTraderStatePayload(FIXTURE, lotDecimalsFor);
    if (!parsed) throw new Error("fixture must parse");
    return parsed.state;
  }

  test("orders are tagged with the owning subaccount", () => {
    const state = parsedState();
    mergeTraderView(
      state,
      {
        limitOrders: {
          ANSEM: [
            {
              side: "bid",
              price: { ui: "0.15", value: 150000, decimals: 6 },
              tradeSizeRemaining: { ui: "10", value: 10, decimals: 0 },
              orderSequenceNumber: "12345",
              isStopLoss: false,
            },
          ],
        },
      },
      0,
      16,
    );
    expect(state.orders).toEqual([
      {
        symbol: "ANSEM",
        side: "bid",
        price: 0.15,
        remaining: 10,
        orderSequenceNumber: "12345",
        isStopLoss: false,
        isStopLossDirection: false,
        traderPdaIndex: 0,
        subaccountIndex: 16,
      },
    ]);
  });

  test("position enrichment stays within its subaccount on symbol collision", () => {
    const state = parsedState();
    // Same symbol as the parent's cross AAPL, but reported by the child-16
    // view — must NOT enrich the parent's row.
    mergeTraderView(
      state,
      {
        positions: [
          {
            symbol: "AAPL",
            unrealizedPnl: { ui: "9.99", value: 9990000, decimals: 6 },
          },
        ],
      },
      0,
      16,
    );
    const parent = state.positions.find(
      (position) =>
        position.symbol === "AAPL" && position.subaccountIndex === 0,
    );
    expect(parent?.unrealizedPnl).toBeNull();
    // The matching subaccount does enrich.
    mergeTraderView(
      state,
      {
        positions: [
          {
            symbol: "AAPL",
            unrealizedPnl: { ui: "9.99", value: 9990000, decimals: 6 },
          },
        ],
      },
      0,
      0,
    );
    expect(parent?.unrealizedPnl).toBe(9.99);
  });

  test("risk tier comes from the parent view only", () => {
    const state = parsedState();
    mergeTraderView(state, { riskTier: "danger" }, 0, 16);
    expect(state.riskTier).toBeNull();
    mergeTraderView(state, { riskTier: "safe" }, 0, 0);
    expect(state.riskTier).toBe("safe");
  });
});
