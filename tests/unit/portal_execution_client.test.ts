import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createExecutionClient,
  ExecutionClientError,
  type ExecutionTransport,
} from "../../apps/portal/app/execution-client";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              const result = statement.run(...(params as never[])) as {
                changes?: number;
              };
              return {
                meta: {
                  changes:
                    typeof result.changes === "number" ? result.changes : 0,
                },
              };
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

function createExecClientEnv(): { env: Env; sqlite: Database } {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite
    .query("INSERT INTO waitlist (email, source) VALUES (?1, ?2)")
    .run("user@example.com", "unit-test");

  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0025_execution_fabric.sql",
  );
  sqlite.exec(readFileSync(migrationPath, "utf8"));

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
    },
  });
  return { env, sqlite };
}

function createWorkerTransport(env: Env): ExecutionTransport {
  return async (input) => {
    const response = await worker.fetch(
      new Request(`http://localhost${input.path}`, {
        method: input.method,
        headers: input.headers,
        ...(input.body ? { body: input.body } : {}),
        signal: input.signal,
      }),
      env,
      createExecutionContextStub(),
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      status: response.status,
      payload,
    };
  };
}

describe("portal execution client", () => {
  test("submit/status/receipt contract works against local worker", async () => {
    const { env, sqlite } = createExecClientEnv();
    try {
      const relayPayload = buildRelaySignedPayload();
      const client = createExecutionClient({
        transport: createWorkerTransport(env),
      });

      const submit = await client.submit(
        {
          schemaVersion: "v1",
          mode: "relay_signed",
          lane: "fast",
          relaySigned: {
            signedTransaction: relayPayload.relaySigned.signedTransaction,
            encoding: "base64",
          },
        },
        {
          idempotencyKey: "sdk-relay-idem-1",
          headers: {
            "payment-signature": "unit-signed-payment",
          },
        },
      );

      expect(submit.requestId.startsWith("execreq_")).toBe(true);
      expect(submit.state).toBe("validated");

      const status = await client.status(submit.requestId);
      expect(status.requestId).toBe(submit.requestId);
      expect(status.state).toBe("validated");
      expect(status.terminal).toBe(false);

      const receipt = await client.receipt(submit.requestId);
      expect(receipt.requestId).toBe(submit.requestId);
      expect(receipt.ready).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  test("decodes canonical execution errors", async () => {
    const { env, sqlite } = createExecClientEnv();
    try {
      const client = createExecutionClient({
        transport: createWorkerTransport(env),
      });

      try {
        await client.status("not_valid");
        throw new Error("expected status() to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutionClientError);
        const typed = error as ExecutionClientError;
        expect(typed.code).toBe("invalid-request");
        expect(typed.status).toBe(400);
        expect(typed.retryable).toBe(false);
      }
    } finally {
      sqlite.close();
    }
  });

  test("parses terminal spot preview responses", async () => {
    const client = createExecutionClient({
      transport: async (input) => {
        expect(input.path).toBe("/api/terminal/spot-preview");
        expect(JSON.parse(String(input.body ?? ""))).toEqual({
          venueKey: "raydium",
          inputMint: "mint-in",
          outputMint: "mint-out",
          amountAtomic: "1000000",
          slippageBps: 50,
        });
        return {
          status: 200,
          payload: {
            ok: true,
            preview: {
              venueKey: "raydium",
              provider: "raydium",
              inputMint: "mint-in",
              outputMint: "mint-out",
              inAmountAtomic: "1000000",
              outAmountAtomic: "250000",
              routeSummary: "Raydium",
              priceImpactPct: 0.0025,
            },
          },
        };
      },
    });

    const preview = await client.previewSpotOrder({
      venueKey: "raydium",
      inputMint: "mint-in",
      outputMint: "mint-out",
      amountAtomic: "1000000",
      slippageBps: 50,
    });

    expect(preview.venueKey).toBe("raydium");
    expect(preview.provider).toBe("raydium");
    expect(preview.routeSummary).toBe("Raydium");
    expect(preview.priceImpactPct).toBe(0.0025);
  });

  test("parses perp markets, preview, submit, and position responses", async () => {
    const client = createExecutionClient({
      transport: async (input) => {
        if (
          input.path === "/api/terminal/perp-markets?venueKey=drift&limit=4"
        ) {
          return {
            status: 200,
            payload: {
              ok: true,
              markets: [
                {
                  venueKey: "drift",
                  instrumentId: "SOL-PERP",
                  instrumentLabel: "SOL-PERP",
                  marketIndex: 2,
                  oracle: "oracle-sol",
                  oracleSource: "pyth",
                  status: "active",
                  contractType: "perp",
                  initialMarginRatio: 0.1,
                  maintenanceMarginRatio: 0.05,
                  fundingRate1hBps: 1.2,
                  oraclePrice: 153.25,
                  markPrice: 153.3,
                  sourceTs: "2026-03-14T18:00:00.000Z",
                  swiftConfigured: false,
                  routeSummary: "Drift Perps",
                },
              ],
            },
          };
        }
        if (input.path === "/api/terminal/perp-preview") {
          expect(JSON.parse(String(input.body ?? ""))).toEqual({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            side: "long",
            quantityAtomic: "2",
            collateralAtomic: "100000000",
            orderType: "limit",
            limitPriceAtomic: "155000000",
            currentPosition: {
              instrumentId: "SOL-PERP",
              signedQuantityAtomic: "1",
              collateralAtomic: "50000000",
              averageEntryPrice: 149.5,
            },
          });
          return {
            status: 200,
            payload: {
              ok: true,
              preview: {
                venueKey: "drift",
                provider: "drift",
                instrumentId: "SOL-PERP",
                instrumentLabel: "SOL-PERP",
                side: "long",
                orderType: "limit",
                timeInForce: "gtc",
                reduceOnly: false,
                quantityAtomic: "2",
                quantityUi: "2.0",
                collateralAtomic: "100000000",
                collateralUi: "100.0",
                limitPriceAtomic: "155000000",
                triggerPriceAtomic: null,
                markPrice: 153.3,
                oraclePrice: 153.25,
                oracle: "oracle-sol",
                oracleSource: "pyth",
                fundingRate1hBps: 1.2,
                initialMarginRatio: 0.1,
                maintenanceMarginRatio: 0.05,
                swiftSupported: false,
                currentSignedQuantityAtomic: "0",
                currentSignedQuantityUi: "0.0",
                currentCollateralAtomic: "0",
                currentCollateralUi: "0.0",
                currentAverageEntryPrice: null,
                projectedSignedQuantityAtomic: "2",
                projectedSignedQuantityUi: "2.0",
                projectedCollateralAtomic: "100000000",
                projectedCollateralUi: "100.0",
                projectedNotionalQuote: 306.6,
                requiredInitialMarginQuote: 30.66,
                requiredMaintenanceQuote: 15.33,
                projectedLeverage: 3.066,
                projectedLiquidationBufferPct: 84.67,
                projectedRiskLevel: "low",
                routeSummary: "Drift Perps",
                notes: ["LIMIT GTC", "exposure-expanding", "paper-mode only"],
              },
            },
          };
        }
        if (input.path === "/api/terminal/perp-orders") {
          expect(JSON.parse(String(input.body ?? ""))).toEqual({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            side: "long",
            quantityAtomic: "2",
            collateralAtomic: "100000000",
            orderType: "market",
            source: "PERPS_PANEL",
            reason: "Open tactical long",
          });
          expect(input.headers["idempotency-key"]).toBe("perp-client-idem");
          return {
            status: 200,
            payload: {
              ok: true,
              result: {
                requestId: "execreq_perp_123",
                status: "finalized",
                terminal: true,
                updatedAt: "2026-03-14T18:05:00.000Z",
                receiptId: "execrcpt_perp_123",
                provider: "drift",
                instrumentId: "SOL-PERP",
                instrumentLabel: "SOL-PERP",
                side: "long",
                quantityAtomic: "2",
                collateralAtomic: "100000000",
                markPrice: 153.3,
                oraclePrice: 153.25,
                fundingRate1hBps: 1.2,
              },
            },
          };
        }
        if (input.path === "/api/terminal/perp-positions") {
          return {
            status: 200,
            payload: {
              ok: true,
              positions: [
                {
                  key: "drift:SOL-PERP",
                  venueKey: "drift",
                  instrumentId: "SOL-PERP",
                  instrumentLabel: "SOL-PERP",
                  side: "long",
                  positionState: "open",
                  signedQuantityAtomic: "2",
                  signedQuantityUi: "2.0",
                  absoluteQuantityUi: "2.0",
                  averageEntryPrice: 153.3,
                  markPrice: 153.3,
                  oraclePrice: 153.25,
                  fundingRate1hBps: 1.2,
                  collateralAtomic: "100000000",
                  collateralUi: "100.0",
                  notionalQuote: 306.6,
                  unrealizedPnlQuote: 0,
                  leverage: 3.066,
                  equityQuote: 100,
                  usedMarginQuote: 30.66,
                  maintenanceRequirementQuote: 15.33,
                  freeCollateralQuote: 69.34,
                  initialMarginRatio: 0.1,
                  maintenanceMarginRatio: 0.05,
                  liquidationBufferPct: 84.67,
                  riskLevel: "low",
                  oracle: "oracle-sol",
                  oracleSource: "pyth",
                  lastRequestId: "execreq_perp_123",
                  lastUpdatedAt: "2026-03-14T18:05:00.000Z",
                  notes: ["drift:market:gtc"],
                },
              ],
            },
          };
        }
        return {
          status: 404,
          payload: { ok: false, error: { code: "not-found", message: "nf" } },
        };
      },
    });

    const markets = await client.listPerpMarkets({
      venueKey: "drift",
      limit: 4,
    });
    expect(markets[0]?.instrumentId).toBe("SOL-PERP");
    expect(markets[0]?.initialMarginRatio).toBe(0.1);

    const preview = await client.previewPerpOrder({
      venueKey: "drift",
      instrumentId: "SOL-PERP",
      side: "long",
      quantityAtomic: "2",
      collateralAtomic: "100000000",
      orderType: "limit",
      limitPriceAtomic: "155000000",
      currentPosition: {
        instrumentId: "SOL-PERP",
        signedQuantityAtomic: "1",
        collateralAtomic: "50000000",
        averageEntryPrice: 149.5,
      },
    });
    expect(preview.projectedNotionalQuote).toBe(306.6);
    expect(preview.projectedRiskLevel).toBe("low");

    const submit = await client.submitPerpOrder(
      {
        venueKey: "drift",
        instrumentId: "SOL-PERP",
        side: "long",
        quantityAtomic: "2",
        collateralAtomic: "100000000",
        orderType: "market",
        source: "PERPS_PANEL",
        reason: "Open tactical long",
      },
      { idempotencyKey: "perp-client-idem" },
    );
    expect(submit.requestId).toBe("execreq_perp_123");
    expect(submit.status).toBe("finalized");
    expect(submit.provider).toBe("drift");

    const positions = await client.listPerpPositions();
    expect(positions[0]?.key).toBe("drift:SOL-PERP");
    expect(positions[0]?.positionState).toBe("open");
    expect(positions[0]?.riskLevel).toBe("low");
  });

  test("parses prediction market, preview, and position responses", async () => {
    const client = createExecutionClient({
      transport: async (input) => {
        if (
          input.path ===
          "/api/terminal/prediction-markets?venueKey=dflow&limit=4"
        ) {
          return {
            status: 200,
            payload: {
              ok: true,
              markets: [
                {
                  venueKey: "dflow",
                  marketId: "PRES-2028",
                  title: "Will candidate X win in 2028?",
                  eventTitle: "Presidential election",
                  status: "active",
                  result: null,
                  endTime: null,
                  settleTime: null,
                  accountId: "acct_1",
                  settlementMint: "mint-usdc",
                  yesMint: "mint-yes",
                  noMint: "mint-no",
                  scalarOutcomePct: null,
                  yesBid: 0.48,
                  yesAsk: 0.52,
                  noBid: 0.47,
                  noAsk: 0.53,
                  volume: 1200,
                  openInterest: 5000,
                  redemptionStatus: "open",
                  accountStatus: "active",
                  resolved: false,
                },
              ],
            },
          };
        }
        if (input.path === "/api/terminal/prediction-preview") {
          return {
            status: 200,
            payload: {
              ok: true,
              preview: {
                venueKey: "dflow",
                provider: "dflow",
                market: {
                  venueKey: "dflow",
                  marketId: "PRES-2028",
                  title: "Will candidate X win in 2028?",
                  eventTitle: "Presidential election",
                  status: "active",
                  result: null,
                  endTime: null,
                  settleTime: null,
                  accountId: "acct_1",
                  settlementMint: "mint-usdc",
                  yesMint: "mint-yes",
                  noMint: "mint-no",
                  scalarOutcomePct: null,
                  yesBid: 0.48,
                  yesAsk: 0.52,
                  noBid: 0.47,
                  noAsk: 0.53,
                  volume: 1200,
                  openInterest: 5000,
                  redemptionStatus: "open",
                  accountStatus: "active",
                  resolved: false,
                },
                instrumentId: "PRES-2028",
                instrumentLabel: "Will candidate X win in 2028?",
                outcomeId: "mint-yes",
                outcomeSide: "yes",
                side: "buy_yes",
                orderType: "market",
                timeInForce: "gtc",
                quantityMode: "base",
                quantityAtomic: "1000000",
                settlementMint: "mint-usdc",
                priceQuote: 0.52,
                estimatedNotionalUsd: 0.52,
                liveReady: false,
                routeSummary: "DFlow YES",
                notes: ["prediction-market-live-requires-proof"],
              },
            },
          };
        }
        if (input.path === "/api/terminal/prediction-positions") {
          return {
            status: 200,
            payload: {
              ok: true,
              positions: [
                {
                  key: "dflow:PRES-2028:mint-yes",
                  venueKey: "dflow",
                  instrumentId: "PRES-2028",
                  instrumentLabel: "Will candidate X win in 2028?",
                  outcomeMint: "mint-yes",
                  outcomeSide: "yes",
                  netQuantityAtomic: "1000000",
                  grossBoughtQuantityAtomic: "1000000",
                  netQuantityUi: "1.0",
                  grossBoughtQuantityUi: "1.0",
                  averageEntryPrice: 0.52,
                  lastPriceQuote: 0.55,
                  marketStatus: "active",
                  marketResolved: false,
                  result: null,
                  settleTime: null,
                  settlementMint: "mint-usdc",
                  redemptionStatus: "open",
                  canSettle: false,
                  expectedPayoutAtomic: null,
                  expectedPayoutUi: null,
                  positionState: "open",
                  settlementState: "pending",
                  lastRequestId: "execreq_123",
                  lastUpdatedAt: "2026-03-14T17:00:00.000Z",
                  notes: ["prediction-market-live-requires-proof"],
                },
              ],
            },
          };
        }
        return {
          status: 404,
          payload: { ok: false, error: { code: "not-found", message: "nf" } },
        };
      },
    });

    const markets = await client.listPredictionMarkets({
      venueKey: "dflow",
      limit: 4,
    });
    expect(markets[0]?.marketId).toBe("PRES-2028");

    const preview = await client.previewPredictionOrder({
      venueKey: "dflow",
      instrumentId: "PRES-2028",
      outcomeId: "mint-yes",
      side: "buy_yes",
      quantityAtomic: "1000000",
    });
    expect(preview.outcomeSide).toBe("yes");
    expect(preview.estimatedNotionalUsd).toBe(0.52);

    const positions = await client.listPredictionPositions();
    expect(positions[0]?.key).toBe("dflow:PRES-2028:mint-yes");
    expect(positions[0]?.positionState).toBe("open");
  });

  test("waitForTerminalReceipt retries transient failures", async () => {
    let statusCalls = 0;
    let receiptCalls = 0;
    const transport: ExecutionTransport = async (input) => {
      if (input.path.includes("/status/")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return {
            status: 503,
            payload: {
              ok: false,
              error: {
                code: "submission-failed",
                message: "temporary-status-failure",
              },
            },
          };
        }
        return {
          status: 200,
          payload: {
            ok: true,
            requestId: "execreq_retry1234567890",
            status: {
              state: "finalized",
              terminal: true,
            },
          },
        };
      }
      if (input.path.includes("/receipt/")) {
        receiptCalls += 1;
        return {
          status: 200,
          payload: {
            ok: true,
            requestId: "execreq_retry1234567890",
            ready: true,
            receipt: {
              receiptId: "execrcpt_retry123",
              provider: "jito",
              outcome: {
                status: "finalized",
                signature: "sig_retry",
                networkFeeLamports: "5000",
              },
            },
          },
        };
      }
      return {
        status: 404,
        payload: { ok: false, error: { code: "not-found", message: "nf" } },
      };
    };

    const client = createExecutionClient({
      transport,
      pollIntervalMs: 10,
      pollTimeoutMs: 500,
      requestRetryCount: 2,
      requestRetryBaseDelayMs: 5,
    });

    const terminal = await client.waitForTerminalReceipt({
      requestId: "execreq_retry1234567890",
    });
    expect(terminal.status).toBe("finalized");
    expect(terminal.signature).toBe("sig_retry");
    expect(terminal.receiptId).toBe("execrcpt_retry123");
    expect(terminal.provider).toBe("jito");
    expect(terminal.networkFeeLamports).toBe("5000");
    expect(statusCalls).toBe(2);
    expect(receiptCalls).toBe(1);
  });
});
