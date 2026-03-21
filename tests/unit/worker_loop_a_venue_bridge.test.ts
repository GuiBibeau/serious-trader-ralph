import { describe, expect, test } from "bun:test";
import { SOL_MINT, USDC_MINT } from "../../apps/worker/src/defaults";
import {
  buildDFlowPredictionObservationMarks,
  buildDriftPerpObservationMark,
  buildMangoPerpObservationMark,
  collectLoopAVenueBridgeMarks,
  listLoopAVenueParityStatuses,
} from "../../apps/worker/src/loop_a/venue_bridge";
import type { Env } from "../../apps/worker/src/types";
import { listRuntimeVenueCapabilities } from "../../src/runtime/venues/catalog";

describe("worker loop A venue bridge", () => {
  test("builds Drift perp observation marks with settlement and position lineage", () => {
    const mark = buildDriftPerpObservationMark({
      contract: {
        marketName: "SOL-PERP",
        marketIndex: 2,
        oracle: "oracle-sol",
        oracleSource: "pyth",
        status: "active",
        contractType: "perp",
        initialMarginRatio: 1000,
        maintenanceMarginRatio: 500,
      },
      funding: {
        marketName: "SOL-PERP",
        fundingRate1h: 0.00012,
        fundingRate1hBps: 1.2,
        oraclePrice: 153.25,
        markPrice: 153.3,
        sourceTs: "2026-03-20T11:59:00.000Z",
      },
      slot: 912345,
      observedAt: "2026-03-20T12:00:00.000Z",
      positionAccount: "drift-user-account",
    });

    expect(mark).not.toBeNull();
    expect(mark?.baseMint).toBe(SOL_MINT);
    expect(mark?.quoteMint).toBe(USDC_MINT);
    expect(mark?.lineage).toMatchObject({
      protocol: "drift",
      venue: "drift",
      marketType: "perp",
      market: "SOL-PERP",
      positionAccount: "drift-user-account",
      settlementMint: USDC_MINT,
    });
    expect(mark?.evidence?.markets).toEqual(["SOL-PERP"]);
    expect(mark?.evidence?.positionAccounts).toEqual(["drift-user-account"]);
    expect(mark?.evidence?.settlementMints).toEqual([USDC_MINT]);
  });

  test("builds DFlow prediction marks for both outcome sides", () => {
    const marks = buildDFlowPredictionObservationMarks({
      slot: 812300,
      observedAt: "2026-03-20T12:01:00.000Z",
      market: {
        marketId: "PRES-2028",
        title: "Will candidate X win in 2028?",
        eventTitle: "Election",
        status: "active",
        result: null,
        endTime: null,
        settleTime: null,
        accounts: [
          {
            accountId: "acct_1",
            yesMint: "YesMint1111111111111111111111111111111",
            noMint: "NoMint11111111111111111111111111111111",
            ledgerMint: "Ledger1111111111111111111111111111111",
            settlementMint: USDC_MINT,
            scalarOutcomePct: null,
            yesBid: 0.49,
            yesAsk: 0.52,
            noBid: 0.47,
            noAsk: 0.5,
            volume: 2450,
            openInterest: 5000,
            redemptionStatus: "open",
            status: "active",
          },
        ],
      },
    });

    expect(marks).toHaveLength(2);
    expect(marks.map((mark) => mark.baseMint).sort()).toEqual([
      "NoMint11111111111111111111111111111111",
      "YesMint1111111111111111111111111111111",
    ]);
    expect(marks[0]?.lineage?.marketType).toBe("prediction");
    expect(marks[0]?.lineage?.market).toBe("PRES-2028");
    expect(marks[0]?.lineage?.positionAccount).toBe("acct_1");
    expect(marks[0]?.lineage?.settlementMint).toBe(USDC_MINT);
    expect(marks[0]?.evidence?.settlementMints).toEqual([USDC_MINT]);
  });

  test("builds Mango snapshot marks with account lineage", () => {
    const mark = buildMangoPerpObservationMark({
      slot: 812301,
      observedAt: "2026-03-20T12:02:00.000Z",
      preview: {
        market: {
          instrumentId: "SOL-PERP",
          marketType: "perp",
          marketName: "SOL-PERP",
          orderbookSource: "mango_perp",
          oracleProvider: "pyth",
          status: "active",
          referencePriceQuote: 155.2,
          initialMarginRatio: 0.1,
          maintenanceMarginRatio: 0.05,
        },
        account: {
          schemaVersion: "v1",
          snapshotId: "margin_mango_sol_1",
          venueKey: "mango",
          accountRef: "mango-account-1",
          capturedAt: "2026-03-20T12:01:30.000Z",
          marketTypes: ["spot", "perp"],
          equityQuote: "12450.25",
          initHealthQuote: "3250.50",
          maintHealthQuote: "2110.25",
          initHealthRatioPct: "26.10",
          maintHealthRatioPct: "16.95",
          usedMarginQuote: "4200.00",
          freeCollateralQuote: "8250.25",
          liquidationBufferPct: "12.35",
          liquidationRiskLevel: "warning",
          beingLiquidated: false,
          isOperational: true,
          positions: [],
          oracles: [],
          tags: ["mango", "paper"],
        },
        family: "perp_order",
        side: "long",
        orderType: "limit",
        timeInForce: "gtc",
        reduceOnly: false,
        quantityAtomic: "1000000",
        collateralAtomic: "250000",
        limitPriceAtomic: "155000000",
        triggerPriceAtomic: null,
      },
    });

    expect(mark).not.toBeNull();
    expect(mark?.baseMint).toBe(SOL_MINT);
    expect(mark?.quoteMint).toBe(USDC_MINT);
    expect(mark?.lineage?.positionAccount).toBe("mango-account-1");
    expect(mark?.evidence?.positionAccounts).toEqual(["mango-account-1"]);
  });

  test("collects Drift and DFlow bridge marks when the bridge is enabled", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "https://drift.test/contracts") {
        return new Response(
          JSON.stringify({
            contracts: [
              {
                marketName: "SOL-PERP",
                marketIndex: 2,
                oracle: "oracle-sol",
                oracleSource: "pyth",
                status: "active",
                contractType: "perp",
                initialMarginRatio: 1000,
                maintenanceMarginRatio: 500,
              },
            ],
          }),
        );
      }
      if (url === "https://drift.test/fundingRates?marketName=SOL-PERP") {
        return new Response(
          JSON.stringify({
            fundingRates: [
              {
                marketName: "SOL-PERP",
                fundingRate: 0.00012,
                oraclePrice: 153.25,
                markPrice: 153.3,
                ts: "2026-03-20T11:59:00.000Z",
              },
            ],
          }),
        );
      }
      if (url === "https://dflow.test/markets?status=active&limit=2") {
        return new Response(
          JSON.stringify({
            markets: [
              {
                ticker: "PRES-2028",
                title: "Will candidate X win in 2028?",
                status: "active",
                accounts: [
                  {
                    accountId: "acct_1",
                    yesMint: "YesMint1111111111111111111111111111111",
                    noMint: "NoMint11111111111111111111111111111111",
                    ledgerMint: "Ledger1111111111111111111111111111111",
                    settlementMint: USDC_MINT,
                    yesBid: 0.49,
                    yesAsk: 0.52,
                    noBid: 0.47,
                    noAsk: 0.5,
                    openInterest: 5000,
                    volume: 2450,
                    status: "active",
                  },
                ],
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    try {
      const result = await collectLoopAVenueBridgeMarks(
        {
          WAITLIST_DB: {} as never,
          LOOP_A_VENUE_BRIDGE_ENABLED: "1",
          LOOP_A_VENUE_BRIDGE_DRIFT_ENABLED: "1",
          LOOP_A_VENUE_BRIDGE_DFLOW_ENABLED: "1",
          LOOP_A_VENUE_BRIDGE_DFLOW_LIMIT: "2",
          DRIFT_DATA_API_BASE: "https://drift.test",
          DFLOW_METADATA_API_BASE: "https://dflow.test",
        } as Env,
        {
          commitment: "confirmed",
          slot: 999001,
          observedAt: "2026-03-20T12:03:00.000Z",
        },
      );

      expect(result.observedVenues).toEqual(["dflow", "drift"]);
      expect(result.marks).toHaveLength(3);
      expect(result.marks.some((mark) => mark.venue === "drift")).toBe(true);
      expect(
        result.marks.filter((mark) => mark.venue === "dflow"),
      ).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("covers every catalogued perp and prediction venue with either a bridge path or a blocked reason", () => {
    const statuses = listLoopAVenueParityStatuses();
    const statusKeys = statuses.map((status) => status.venueKey).sort();
    const catalogKeys = listRuntimeVenueCapabilities()
      .filter((capability) =>
        capability.marketTypes.some(
          (marketType) => marketType === "perp" || marketType === "prediction",
        ),
      )
      .map((capability) => capability.venueKey)
      .sort();

    expect(statusKeys).toEqual(catalogKeys);
    expect(
      statuses
        .filter((status) => status.mode === "blocked")
        .map((status) => status.venueKey)
        .sort(),
    ).toEqual(["drift_bet", "jupiter_perps", "monaco", "raydium_perps"]);
  });
});
