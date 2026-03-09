import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerExecutionAdapter } from "../../apps/worker/src/execution/router";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

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

function createRuntimeExecutionEnv() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0027_runtime_canary.sql",
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
  sqlite
    .query(
      `
      INSERT INTO runtime_canary_state (
        state_key,
        schema_version,
        deployment_id,
        wallet_id,
        wallet_address,
        disabled,
        created_at,
        updated_at
      ) VALUES (?1, 'v1', ?2, ?3, ?4, 0, ?5, ?5)
      `,
    )
    .run(
      "mainnet",
      "runtime_canary_live_dca",
      "wallet_runtime_canary",
      "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
      "2026-03-08T00:00:00.000Z",
    );

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      RUNTIME_INTERNAL_STUB_MODE: "0",
      RUNTIME_CANARY_ENABLED: "1",
      RUNTIME_CANARY_AUTO_CREATE_WALLET: "0",
      RUNTIME_CANARY_DEPLOYMENT_ID: "runtime_canary_live_dca",
      RUNTIME_CANARY_NOTIONAL_USD: "5",
      RUNTIME_CANARY_ALLOCATED_USD: "25",
      RUNTIME_CANARY_DAILY_CAP_USD: "25",
      RUNTIME_CANARY_MAX_SLIPPAGE_BPS: "50",
      RUNTIME_CANARY_MIN_SOL_RESERVE_LAMPORTS: "50000000",
      EXEC_LANE_SAFE_ADAPTER: "runtime_canary_test",
      RPC_ENDPOINT: "https://rpc.test.local",
      BALANCE_RPC_ENDPOINT: "https://rpc.test.local",
      JUPITER_BASE_URL: "https://jupiter.test.local",
    },
  });

  return { env, sqlite };
}

const VALID_RUNTIME_DEPLOYMENT = {
  schemaVersion: "v1",
  deploymentId: "deployment_123",
  strategyKey: "dca",
  sleeveId: "sleeve_alpha",
  ownerUserId: "user_123",
  pair: {
    symbol: "SOL/USDC",
    baseMint: "So11111111111111111111111111111111111111112",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  mode: "shadow",
  state: "shadow",
  lane: "safe",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z",
  policy: {
    maxNotionalUsd: "250.00",
    dailyLossLimitUsd: "35.00",
    maxSlippageBps: 50,
    maxConcurrentRuns: 2,
    rebalanceToleranceBps: 100,
  },
  capital: {
    allocatedUsd: "1000.00",
    reservedUsd: "125.00",
    availableUsd: "875.00",
  },
  tags: ["fixture"],
};

const VALID_RUNTIME_EXECUTION_PLAN = {
  schemaVersion: "v1",
  planId: "plan_123",
  deploymentId: "deployment_123",
  runId: "run_123",
  createdAt: "2026-03-07T00:00:00.000Z",
  mode: "shadow",
  lane: "safe",
  idempotencyKey: "deployment_123:run_123",
  simulateOnly: true,
  dryRun: true,
  slices: [
    {
      sliceId: "slice_1",
      action: "buy",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      inputAmountAtomic: "5000000",
      minOutputAmountAtomic: "30000000",
      notionalUsd: "5.00",
      slippageBps: 50,
    },
  ],
};

describe("worker runtime internal routes", () => {
  test("requires runtime service auth", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health"),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "auth-required",
    });
  });

  test("fails closed when runtime service auth is not configured", async () => {
    const env = createWorkerLiveEnv({
      overrides: {
        RUNTIME_INTERNAL_SERVICE_TOKEN: "",
      },
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "runtime-service-auth-not-configured",
    });
  });

  test("returns authenticated runtime bridge health", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      schemaVersion: "v1",
      service: "worker-runtime-bridge",
      authenticatedService: "runtime-rs",
      integration: {
        stubModeEnabled: true,
      },
      routes: {
        deployments: "/api/internal/runtime/deployments",
        executionPlans: "/api/internal/runtime/execution-plans",
        health: "/api/internal/runtime/health",
        scorecards: "/api/internal/runtime/scorecards",
      },
    });
  });

  test("accepts runtime deployment records through the private route family", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/deployments", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_DEPLOYMENT),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "accepted",
      source: "stub",
      deployment: {
        deploymentId: "deployment_123",
        strategyKey: "dca",
      },
    });
  });

  test("accepts service-authenticated runtime execution plans", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/execution-plans", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_EXECUTION_PLAN),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      accepted: true,
      source: "stub",
      submitRequestId: "submit_plan_123",
      coordination: {
        planId: "plan_123",
        deploymentId: "deployment_123",
        runId: "run_123",
        sliceCount: 1,
      },
    });
  });

  test("executes the bounded runtime canary plan in non-stub mode", async () => {
    const { env, sqlite } = createRuntimeExecutionEnv();
    const originalFetch = globalThis.fetch;
    registerExecutionAdapter("runtime_canary_test", async (input) => ({
      status: "finalized",
      signature: "sig_runtime_canary",
      usedQuote: input.quoteResponse,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route: "runtime_canary_test",
        classification: "finalized",
      },
    }));

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://jupiter.test.local/swap/v1/quote")) {
        return new Response(
          JSON.stringify({
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "5000000",
            outputMint: "So11111111111111111111111111111111111111112",
            outAmount: "35000000",
            otherAmountThreshold: "34000000",
            swapMode: "ExactIn",
            slippageBps: 50,
            priceImpactPct: "0.001",
            routePlan: [],
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url === "https://rpc.test.local") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "getBalance") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: { value: 100_000_000 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "getTokenAccountsByOwner") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: {
                value: [
                  {
                    account: {
                      data: {
                        parsed: {
                          info: {
                            tokenAmount: {
                              amount: "20000000",
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/internal/runtime/execution-plans", {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schemaVersion: "v1",
            planId: "plan_live_canary",
            deploymentId: "runtime_canary_live_dca",
            runId: "run_live_canary",
            createdAt: "2026-03-08T00:00:00.000Z",
            mode: "live",
            lane: "safe",
            idempotencyKey: "runtime_canary_live_dca:run_live_canary",
            simulateOnly: false,
            dryRun: false,
            slices: [
              {
                sliceId: "slice_1",
                action: "buy",
                inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                outputMint: "So11111111111111111111111111111111111111112",
                inputAmountAtomic: "5000000",
                minOutputAmountAtomic: "34000000",
                notionalUsd: "5.00",
                slippageBps: 50,
              },
            ],
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        ok: true,
        accepted: true,
        source: "worker",
        submitRequestId: expect.any(String),
        receipt: {
          status: "landed",
          signature: "sig_runtime_canary",
        },
        observedLedger: {
          deploymentId: "runtime_canary_live_dca",
          sleeveId: "sleeve_runtime_canary",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
      sqlite.close();
    }
  });

  test("returns stubbed runtime scorecards and promotion gates", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/scorecards?deploymentId=deployment_123",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      deploymentId: "deployment_123",
      report: {
        mode: "shadow",
        scorecard: {
          triggerQuality: {
            totalRuns: 3,
          },
        },
      },
    });
    expect(payload.report.promotionGates[0]).toMatchObject({
      sourceMode: "shadow",
      targetMode: "paper",
      status: "pass",
    });
  });
});
