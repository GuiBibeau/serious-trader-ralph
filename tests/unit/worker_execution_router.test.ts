import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executeIntentViaRouter,
  executeSwapViaRouter,
  registerExecutionAdapter,
} from "../../apps/worker/src/execution/router";
import { normalizePolicy } from "../../apps/worker/src/policy";
import { writeStrategyLabSubjectControl } from "../../apps/worker/src/strategy_lab_readiness_repository";
import { parseRuntimeStrategyLabSubjectControl } from "../../src/runtime/contracts/autonomous_runtime.js";

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              statement.run(...(params as never[]));
              return { meta: { changes: 1 } };
            },
            async first() {
              const statement = db.query(sql);
              return (statement.get(...(params as never[])) as unknown) ?? null;
            },
            async all() {
              const statement = db.query(sql);
              return {
                results: (statement.all(...(params as never[])) ??
                  []) as unknown[],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

async function createLiveRouterEnv() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
    "0027_runtime_canary.sql",
    "0028_strategy_lab_promotions.sql",
    "0029_strategy_lab_readiness.sql",
    "0030_strategy_lab_post_live.sql",
  ]) {
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations",
      migrationName,
    );
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }

  return {
    sqlite,
    env: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
    } as never,
  };
}

describe("worker execution router", () => {
  test("defaults to jupiter adapter and returns dry_run in dry mode", async () => {
    const result = await executeSwapViaRouter({
      env: {} as never,
      execution: undefined,
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
      },
      userPublicKey: "11111111111111111111111111111111",
      privyWalletId: undefined,
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.signature).toBeNull();
  });

  test("jito bundle adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "jito_bundle" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/jito-block-engine-url-missing/);
  });

  test("helius sender adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "helius_sender" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/helius-sender-url-missing/);
  });

  test("magicblock adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "magicblock_ephemeral_rollup" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/magicblock-ephemeral-rollup-url-missing/);
  });

  test("routes bounded Raydium spot swaps in paper mode", async () => {
    const result = await executeSwapViaRouter({
      env: {} as never,
      venueKey: "raydium",
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: { adapter: "raydium" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
        raydiumQuoteEnvelope: {
          id: "quote-1",
          success: true,
          data: {
            inputMint: "A",
            outputMint: "B",
            inputAmount: "1",
            outputAmount: "2",
          },
        },
      },
      userPublicKey: "11111111111111111111111111111111",
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("raydium");
  });

  test("routes bounded Orca spot swaps in paper mode", async () => {
    const result = await executeSwapViaRouter({
      env: {} as never,
      venueKey: "orca",
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: { adapter: "orca" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
        orcaPoolSnapshot: {
          address: "orca-pool-1",
        },
      },
      userPublicKey: "11111111111111111111111111111111",
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("orca");
  });

  test("routes flash-liquidity atomic plans in paper mode", async () => {
    const result = await executeIntentViaRouter({
      env: {} as never,
      venueKey: "flash_liquidity",
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: { adapter: "flash_liquidity" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      intent: {
        family: "flash_atomic",
        wallet: "11111111111111111111111111111111",
        venueKey: "flash_liquidity",
        marketType: "spot",
        instrumentId: "SOL/USDC",
        referenceId: "arb:sol-usdc-jupiter-raydium",
        settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        borrowLegs: [
          {
            provider: "marginfi",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            amountAtomic: "1000000",
          },
        ],
      },
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("flash_liquidity");
  });

  test("allows flash-liquidity live venue smoke only through the bounded readiness bypass", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      const result = await executeIntentViaRouter({
        env,
        venueKey: "flash_liquidity",
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        requireVenueRouting: true,
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: { adapter: "flash_liquidity" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        intent: {
          family: "flash_atomic",
          wallet: "11111111111111111111111111111111",
          venueKey: "flash_liquidity",
          marketType: "spot",
          instrumentId: "USDC/USDC",
          referenceId: "flash-smoke",
          settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          borrowLegs: [
            {
              provider: "marginfi",
              mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              amountAtomic: "1000000",
            },
          ],
        },
        log: () => {},
      });

      expect(result.status).toBe("dry_run");
      expect(result.executionMeta?.route).toBe("flash_liquidity");
    } finally {
      sqlite.close();
    }
  });

  test("custom execution adapters can be registered for new intent families", async () => {
    registerExecutionAdapter(
      "phoenix_orderbook",
      async (input) => ({
        status: "simulated",
        signature: "sig-phoenix-clob",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "phoenix",
        supportedModes: ["shadow", "paper"],
        supportedIntentFamilies: ["clob_order"],
      },
    );

    await expect(
      executeIntentViaRouter({
        env: {} as never,
        venueKey: "phoenix",
        runtimeMode: "paper",
        execution: { adapter: "phoenix_orderbook" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: {
          family: "clob_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "phoenix",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "1",
        },
        log: () => {},
      }),
    ).rejects.toThrow(/execution-intent-family-not-implemented/);
  });

  test("routes Jupiter conditional spot orders through the Trigger executor in non-live modes", async () => {
    const result = await executeIntentViaRouter({
      env: {} as never,
      venueKey: "jupiter",
      runtimeMode: "paper",
      execution: { adapter: "jupiter" },
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      intent: {
        family: "conditional_spot_order",
        wallet: "11111111111111111111111111111111",
        venueKey: "jupiter",
        marketType: "spot",
        instrumentId: "SOL/USDC",
        side: "buy",
        quantityAtomic: "1000000",
        params: {
          orderType: "limit",
          limitPriceAtomic: "150000000",
        },
      },
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.route).toBe("jupiter");
    expect(result.executionMeta?.lifecycle?.orderState).toBe("open");
  });

  test("routes DFlow prediction intents through the DFlow executor in paper mode", async () => {
    const result = await executeIntentViaRouter({
      env: {} as never,
      venueKey: "dflow",
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: { adapter: "dflow" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      dflow: {
        describePredictionIntent: async () => ({
          market: {
            marketId: "PRES-2028",
            title: "Will candidate X win in 2028?",
            eventTitle: "Presidential election",
            status: "active",
            endTime: "2028-11-06T08:00:00.000Z",
            settleTime: null,
            accounts: [],
          },
          marketAccount: {
            accountId: "acct_1",
            yesMint: "YesMint1111111111111111111111111111111",
            noMint: "NoMint11111111111111111111111111111111",
            ledgerMint: "Ledger1111111111111111111111111111111",
            settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            yesBid: 0.49,
            yesAsk: 0.52,
            noBid: 0.47,
            noAsk: 0.51,
            volume: 2450,
            openInterest: 5000,
            redemptionStatus: "open",
            status: "active",
          },
          outcomeMint: "YesMint1111111111111111111111111111111",
          outcomeSide: "yes" as const,
          side: "buy_yes" as const,
          orderType: "limit" as const,
          timeInForce: "gtc" as const,
          quantityMode: "notional" as const,
          quantityAtomic: "1000000",
          settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          priceQuote: 0.52,
          estimatedNotionalUsd: 1,
          liveReady: false,
          notes: ["prediction-market-live-requires-proof"],
        }),
        buildSyntheticQuote: () => ({
          inputMint: "USDC",
          outputMint: "YES",
          inAmount: "1000000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [
            { poolId: "PRES-2028", swapInfo: { label: "DFlow Prediction" } },
          ],
        }),
      } as never,
      intent: {
        family: "prediction_order",
        wallet: "11111111111111111111111111111111",
        venueKey: "dflow",
        marketType: "prediction",
        instrumentId: "PRES-2028",
        outcomeId: "YesMint1111111111111111111111111111111",
        side: "buy_yes",
        quantityAtomic: "1000000",
      },
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("dflow");
  });

  test("routes OpenBook clob orders through the OpenBook executor in paper mode", async () => {
    const result = await executeIntentViaRouter({
      env: { RPC_ENDPOINT: "https://rpc.test" } as never,
      venueKey: "openbook",
      runtimeMode: "paper",
      execution: { adapter: "openbook_v2" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      openbook: {
        buildPlaceOrderPlan: async () => ({
          unsignedTransactionBase64: "unsigned",
          lastValidBlockHeight: 42,
          market: {
            instrumentId: "SOL/USDC",
            marketAddress: "market-1",
            baseMint: "mint-base",
            quoteMint: "mint-quote",
            baseDecimals: 9,
            quoteDecimals: 6,
            bestBidPriceUi: 149.5,
            bestAskPriceUi: 150,
            bestBidSizeUi: 2,
            bestAskSizeUi: 3,
            spreadBps: 33,
            tickSizeUi: "0.01",
            minOrderSizeUi: "0.001",
            openOrdersAdminRequired: false,
            consumeEventsAdminRequired: false,
            closeMarketAdminRequired: false,
          },
          prerequisites: {
            openOrdersIndexer: "indexer-1",
            openOrdersAccount: "oo-1",
            userBaseAccount: "base-ata",
            userQuoteAccount: "quote-ata",
            userFundingAccount: "quote-ata",
            createdOpenOrdersIndexer: true,
            createdOpenOrdersAccount: true,
          },
          request: {
            side: "buy",
            quantityAtomic: "1000000000",
            quantityBaseUi: 1,
            orderType: "limit",
            timeInForce: "gtc",
            postOnly: false,
            limitPriceAtomic: "151000000",
            limitPriceUi: 151,
            clientOrderId: "42",
            estimatedQuoteUi: 151,
            estimatedQuoteAtomic: "151000000",
          },
          quotePreview: {
            inputMint: "mint-quote",
            outputMint: "mint-base",
            inAmount: "151000000",
            outAmount: "1000000000",
          },
        }),
      } as never,
      intent: {
        family: "clob_order",
        wallet: "11111111111111111111111111111111",
        venueKey: "openbook",
        marketType: "spot",
        instrumentId: "SOL/USDC",
        side: "buy",
        quantityAtomic: "1000000000",
        params: {
          orderType: "limit",
          limitPriceAtomic: "151000000",
        },
      },
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("openbook_v2");
  });

  test("fails closed when OpenBook clob orders are requested in live mode", async () => {
    await expect(
      executeIntentViaRouter({
        env: {} as never,
        venueKey: "openbook",
        runtimeMode: "live",
        requireVenueRouting: true,
        execution: { adapter: "openbook_v2" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        intent: {
          family: "clob_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "openbook",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "1000000000",
        },
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-mode-not-supported:openbook:live/);
  });

  test("allows OpenBook live venue smoke only through the bounded readiness bypass", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      const result = await executeIntentViaRouter({
        env: {
          ...env,
          RPC_ENDPOINT: "https://rpc.test",
        } as never,
        venueKey: "openbook",
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        requireVenueRouting: true,
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: { adapter: "openbook_v2" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        openbook: {
          buildPlaceOrderPlan: async () => ({
            ...{
              unsignedTransactionBase64: "unsigned",
              lastValidBlockHeight: 42,
            },
            market: {
              instrumentId: "SOL/USDC",
              marketAddress: "market-1",
              baseMint: "mint-base",
              quoteMint: "mint-quote",
              baseDecimals: 9,
              quoteDecimals: 6,
              bestBidPriceUi: 149.5,
              bestAskPriceUi: 150,
              bestBidSizeUi: 2,
              bestAskSizeUi: 3,
              spreadBps: 33,
              tickSizeUi: "0.01",
              minOrderSizeUi: "0.001",
              openOrdersAdminRequired: false,
              consumeEventsAdminRequired: false,
              closeMarketAdminRequired: false,
            },
            prerequisites: {
              openOrdersIndexer: "indexer-1",
              openOrdersAccount: "oo-1",
              userBaseAccount: "base-ata",
              userQuoteAccount: "quote-ata",
              userFundingAccount: "quote-ata",
              createdOpenOrdersIndexer: true,
              createdOpenOrdersAccount: true,
            },
            request: {
              side: "buy",
              quantityAtomic: "1000000000",
              quantityBaseUi: 1,
              orderType: "limit",
              timeInForce: "ioc",
              postOnly: false,
              limitPriceAtomic: "151000000",
              limitPriceUi: 151,
              clientOrderId: "42",
              estimatedQuoteUi: 151,
              estimatedQuoteAtomic: "151000000",
            },
            quotePreview: {
              inputMint: "mint-quote",
              outputMint: "mint-base",
              inAmount: "151000000",
              outAmount: "1000000000",
            },
          }),
        } as never,
        intent: {
          family: "clob_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "openbook",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "1000000000",
        },
        log: () => {},
      });

      expect(result.status).toBe("dry_run");
      expect(result.executionMeta?.route).toBe("openbook_v2");
    } finally {
      sqlite.close();
    }
  });

  test("routes Drift perp intents through the Drift executor in paper mode", async () => {
    const result = await executeIntentViaRouter({
      env: {} as never,
      venueKey: "drift",
      runtimeMode: "paper",
      execution: { adapter: "drift" },
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      drift: {
        swiftConfigured: () => false,
        describePerpIntent: async () => ({
          instrument: {
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
            sourceTs: "2026-03-13T23:59:00.000Z",
          },
          side: "long",
          direction: "long",
          reduceOnly: false,
          orderType: "limit",
          timeInForce: "gtc",
          quantityAtomic: "1000000",
          collateralAtomic: "250000",
          limitPriceAtomic: "155000000",
          triggerPriceAtomic: null,
          swiftSupported: false,
        }),
        buildSyntheticQuote: () => ({
          inputMint: "SOL-PERP",
          outputMint: "SOL-PERP",
          inAmount: "250000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
        }),
      } as never,
      intent: {
        family: "perp_order",
        wallet: "11111111111111111111111111111111",
        venueKey: "drift",
        marketType: "perp",
        instrumentId: "SOL-PERP",
        side: "long",
        quantityAtomic: "1000000",
        collateralAtomic: "250000",
        params: {
          orderType: "limit",
          limitPriceAtomic: "155000000",
        },
      },
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.route).toBe("drift");
    expect(result.executionMeta?.lifecycle?.positionState).toBe("opening");
  });

  test("fails closed when Drift perp orders are requested in live mode", async () => {
    await expect(
      executeIntentViaRouter({
        env: {} as never,
        venueKey: "drift",
        runtimeMode: "live",
        requireVenueRouting: true,
        execution: { adapter: "drift" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        drift: {
          swiftConfigured: () => false,
          describePerpIntent: async () => ({
            instrument: {
              marketName: "SOL-PERP",
              marketIndex: 2,
              oracle: "oracle-sol",
              oracleSource: "pyth",
              status: "active",
              contractType: "perp",
              initialMarginRatio: 1000,
              maintenanceMarginRatio: 500,
            },
            funding: null,
            side: "long",
            direction: "long",
            reduceOnly: false,
            orderType: "market",
            timeInForce: "ioc",
            quantityAtomic: "1000000",
            collateralAtomic: "250000",
            limitPriceAtomic: null,
            triggerPriceAtomic: null,
            swiftSupported: false,
          }),
          buildSyntheticQuote: () => ({
            inputMint: "SOL-PERP",
            outputMint: "SOL-PERP",
            inAmount: "250000",
            outAmount: "1000000",
            priceImpactPct: 0,
            routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
          }),
        } as never,
        intent: {
          family: "perp_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "drift",
          marketType: "perp",
          instrumentId: "SOL-PERP",
          side: "long",
          quantityAtomic: "1000000",
          collateralAtomic: "250000",
        },
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-mode-not-supported:drift:live/);
  });

  test("allows Drift live venue smoke only through the bounded readiness bypass", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      const result = await executeIntentViaRouter({
        env,
        venueKey: "drift",
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        requireVenueRouting: true,
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: { adapter: "drift" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        drift: {
          swiftConfigured: () => false,
          describePerpIntent: async () => ({
            instrument: {
              marketName: "SOL-PERP",
              marketIndex: 2,
              oracle: "oracle-sol",
              oracleSource: "pyth",
              status: "active",
              contractType: "perp",
              initialMarginRatio: 1000,
              maintenanceMarginRatio: 500,
            },
            funding: null,
            side: "long",
            direction: "long",
            reduceOnly: false,
            orderType: "market",
            timeInForce: "ioc",
            quantityAtomic: "1000000",
            collateralAtomic: "250000",
            limitPriceAtomic: null,
            triggerPriceAtomic: null,
            swiftSupported: false,
          }),
          buildSyntheticQuote: () => ({
            inputMint: "SOL-PERP",
            outputMint: "SOL-PERP",
            inAmount: "250000",
            outAmount: "1000000",
            priceImpactPct: 0,
            routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
          }),
        } as never,
        intent: {
          family: "perp_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "drift",
          marketType: "perp",
          instrumentId: "SOL-PERP",
          side: "long",
          quantityAtomic: "1000000",
          collateralAtomic: "250000",
        },
        log: () => {},
      });

      expect(result.status).toBe("dry_run");
      expect(result.executionMeta?.route).toBe("drift");
    } finally {
      sqlite.close();
    }
  });

  test("routes Mango spot margin orders through the Mango executor in paper mode", async () => {
    const result = await executeIntentViaRouter({
      env: {} as never,
      venueKey: "mango",
      runtimeMode: "paper",
      execution: { adapter: "mango" },
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      mango: {
        describeIntent: () => ({
          market: {
            instrumentId: "SOL/USDC",
            marketType: "spot",
            marketName: "SOL/USDC",
            orderbookSource: "openbook_v2",
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
            capturedAt: "2026-03-14T05:00:00Z",
            marketTypes: ["spot", "perp"],
            equityQuote: "12450.25",
            initHealthQuote: "3250.50",
            maintHealthQuote: "2110.25",
            usedMarginQuote: "4200.00",
            freeCollateralQuote: "8250.25",
            liquidationRiskLevel: "warning",
            beingLiquidated: false,
            isOperational: true,
            positions: [],
            oracles: [
              {
                instrumentId: "SOL/USDC",
                provider: "pyth",
                status: "healthy",
                notes: ["fresh"],
              },
            ],
            tags: ["mango", "paper"],
          },
          family: "clob_order",
          side: "buy",
          orderType: "limit",
          timeInForce: "gtc",
          reduceOnly: false,
          quantityAtomic: "1000000",
          collateralAtomic: null,
          limitPriceAtomic: "155000000",
          triggerPriceAtomic: null,
        }),
        buildSyntheticQuote: () => ({
          inputMint: "mango-account-1",
          outputMint: "SOL/USDC",
          inAmount: "1000000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [
            { poolId: "SOL/USDC", swapInfo: { label: "Mango v4 Spot Margin" } },
          ],
        }),
      } as never,
      intent: {
        family: "clob_order",
        wallet: "11111111111111111111111111111111",
        venueKey: "mango",
        marketType: "spot",
        instrumentId: "SOL/USDC",
        side: "buy",
        quantityAtomic: "1000000",
        params: {
          orderType: "limit",
        },
      },
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("mango");
  });

  test("fails closed when the runtime venue does not support the requested intent family", async () => {
    registerExecutionAdapter(
      "phoenix_orderbook",
      async (input) => ({
        status: "simulated",
        signature: "sig-phoenix-clob",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "phoenix",
        supportedModes: ["shadow", "paper"],
        supportedIntentFamilies: ["clob_order"],
      },
    );

    await expect(
      executeIntentViaRouter({
        env: {} as never,
        venueKey: "phoenix",
        runtimeMode: "paper",
        execution: { adapter: "phoenix_orderbook" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: {
          family: "perp_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "phoenix",
          marketType: "perp",
          instrumentId: "SOL-PERP",
          side: "long",
          quantityAtomic: "1",
        },
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-intent-family-not-supported/);
  });

  test("fails closed when a venue adapter does not match the runtime venue", async () => {
    registerExecutionAdapter("venue_x", async (input) => ({
      status: "simulated",
      signature: "sig-venue-x",
      usedQuote: input.quoteResponse,
      refreshed: false,
      lastValidBlockHeight: 42,
    }));

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
        execution: { adapter: "venue_x" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/execution-adapter-venue-mismatch/);
  });

  test("fails closed when Raydium spot swaps are requested in live mode", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "raydium",
        runtimeMode: "live",
        requireVenueRouting: true,
        execution: { adapter: "raydium" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
          raydiumQuoteEnvelope: {
            id: "quote-1",
            success: true,
            data: {
              inputMint: "A",
              outputMint: "B",
              inputAmount: "1",
              outputAmount: "2",
            },
          },
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-mode-not-supported:raydium:live/);
  });

  test("allows Raydium live venue smoke only through the bounded readiness bypass", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      const result = await executeSwapViaRouter({
        env,
        venueKey: "raydium",
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        requireVenueRouting: true,
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: { adapter: "raydium" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
          raydiumQuoteEnvelope: {
            id: "quote-1",
            success: true,
            data: {
              inputMint: "A",
              outputMint: "B",
              inputAmount: "1",
              outputAmount: "2",
            },
          },
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      });

      expect(result.status).toBe("dry_run");
      expect(result.executionMeta?.route).toBe("raydium");
    } finally {
      sqlite.close();
    }
  });

  test("fails closed when Orca spot swaps are requested in live mode", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "orca",
        runtimeMode: "live",
        requireVenueRouting: true,
        execution: { adapter: "orca" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
          orcaPoolSnapshot: {
            address: "orca-pool-1",
          },
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-mode-not-supported:orca:live/);
  });

  test("allows Orca live venue smoke only through the bounded readiness bypass", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      const result = await executeSwapViaRouter({
        env,
        venueKey: "orca",
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        requireVenueRouting: true,
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: { adapter: "orca" },
        policy: normalizePolicy({ dryRun: true }),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
          orcaPoolSnapshot: {
            address: "orca-pool-1",
          },
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      });

      expect(result.status).toBe("dry_run");
      expect(result.executionMeta?.route).toBe("orca");
    } finally {
      sqlite.close();
    }
  });

  test("fails closed when adapter is not allowlisted for the runtime venue", async () => {
    registerExecutionAdapter(
      "jupiter_shadow_probe",
      async (input) => ({
        status: "simulated",
        signature: "sig-jupiter-shadow",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "jupiter",
        supportedModes: ["shadow", "paper"],
      },
    );

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
        execution: { adapter: "jupiter_shadow_probe" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-adapter-not-supported/);
  });

  test("fails closed when runtime routing metadata is required but missing", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        requireVenueRouting: true,
        execution: { adapter: "jupiter" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-required/);
  });

  test("fails closed when a live venue is not allowlisted", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      await writeStrategyLabSubjectControl(
        env.WAITLIST_DB,
        parseRuntimeStrategyLabSubjectControl({
          schemaVersion: "v1",
          subjectKind: "venue",
          subjectKey: "jupiter",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedAt: "2026-03-12T00:00:00.000Z",
        }),
      );

      await expect(
        executeSwapViaRouter({
          env,
          venueKey: "jupiter",
          runtimeMode: "live",
          execution: { adapter: "jupiter" },
          policy: normalizePolicy({ dryRun: true }),
          rpc: {} as never,
          jupiter: {} as never,
          quoteResponse: {
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1",
            outAmount: "2",
          },
          userPublicKey: "11111111111111111111111111111111",
          log: () => {},
        }),
      ).rejects.toThrow(/runtime-venue-not-allowlisted/);
    } finally {
      sqlite.close();
    }
  });

  test("fails closed when an asset kill switch is enabled for live routing", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      await writeStrategyLabSubjectControl(
        env.WAITLIST_DB,
        parseRuntimeStrategyLabSubjectControl({
          schemaVersion: "v1",
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: true,
          killSwitchEnabled: true,
          updatedAt: "2026-03-12T00:00:00.000Z",
        }),
      );

      await expect(
        executeSwapViaRouter({
          env,
          venueKey: "jupiter",
          runtimeMode: "live",
          execution: { adapter: "jupiter" },
          policy: normalizePolicy({ dryRun: true }),
          rpc: {} as never,
          jupiter: {} as never,
          quoteResponse: {
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1",
            outAmount: "2",
          },
          userPublicKey: "11111111111111111111111111111111",
          log: () => {},
        }),
      ).rejects.toThrow(/runtime-asset-disabled-by-operator/);
    } finally {
      sqlite.close();
    }
  });

  test("enforces asset controls for live Jupiter conditional spot orders", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      await writeStrategyLabSubjectControl(
        env.WAITLIST_DB,
        parseRuntimeStrategyLabSubjectControl({
          schemaVersion: "v1",
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedAt: "2026-03-12T00:00:00.000Z",
        }),
      );

      await expect(
        executeIntentViaRouter({
          env,
          venueKey: "jupiter",
          runtimeMode: "live",
          execution: { adapter: "jupiter" },
          policy: normalizePolicy({ dryRun: true }),
          rpc: {} as never,
          jupiter: {} as never,
          intent: {
            family: "conditional_spot_order",
            wallet: "11111111111111111111111111111111",
            venueKey: "jupiter",
            marketType: "spot",
            instrumentId: "SOL/USDC",
            side: "buy",
            quantityAtomic: "1000000",
            params: {
              orderType: "limit",
              limitPriceAtomic: "150000000",
            },
          },
          log: () => {},
        }),
      ).rejects.toThrow(/runtime-asset-not-allowlisted/);
    } finally {
      sqlite.close();
    }
  });
});
