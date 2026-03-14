import { Database } from "bun:sqlite";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const requireUserMock = mock(async () => ({
  privyUserId: "did:privy:user_1",
  email: "user@example.com",
}));

mock.module("../../apps/worker/src/auth", () => ({
  requireUser: requireUserMock,
}));

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

function createExecEnv(): { env: Env; sqlite: Database } {
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
  for (const migrationName of [
    "0004_users_bots.sql",
    "0005_user_profile.sql",
    "0008_billing.sql",
    "0014_user_onboarding_status.sql",
    "0021_user_wallet_columns.sql",
    "0023_user_experience_onboarding.sql",
    "0025_execution_fabric.sql",
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
        INSERT INTO users (
          id,
          privy_user_id,
          onboarding_status,
          signer_type,
          privy_wallet_id,
          wallet_address,
          wallet_migrated_at,
          experience_level,
          level_source,
          onboarding_completed_at,
          onboarding_version,
          feed_seed_version
        ) VALUES (
          'user_1',
          'did:privy:user_1',
          'active',
          'privy',
          'wallet_1',
          '11111111111111111111111111111111',
          '2026-03-03T00:00:00.000Z',
          'beginner',
          'auto',
          '2026-03-03T00:00:00.000Z',
          1,
          1
        )
      `,
    )
    .run();
  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      PRIVY_APP_ID: "privy-app-id",
      PRIVY_APP_SECRET: "privy-app-secret",
      RPC_ENDPOINT: "https://rpc.test",
      JUPITER_BASE_URL: "https://jupiter.test",
    },
  });
  return { env, sqlite };
}

function buildDflowMarket(resolved: boolean) {
  return {
    ticker: "PRES-2028",
    title: "Will candidate X win in 2028?",
    eventTitle: "Presidential election",
    status: resolved ? "settled" : "active",
    result: resolved ? "yes" : null,
    endTime: "2028-11-06T08:00:00.000Z",
    settleTime: "2028-11-08T12:00:00.000Z",
    accounts: {
      acct_1: {
        yesMint: "YesMint1111111111111111111111111111111",
        noMint: "NoMint11111111111111111111111111111111",
        settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        yesBid: 0.48,
        yesAsk: 0.52,
        noBid: 0.47,
        noAsk: 0.53,
        openInterest: 5000,
        volume: 1250,
        redemptionStatus: resolved ? "redeemable" : "open",
        status: resolved ? "settled" : "active",
      },
    },
  };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  requireUserMock.mockClear();
});

describe("worker terminal prediction routes", () => {
  test("prediction discovery and preview routes return bounded DFlow market data", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      global.fetch = mock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/markets?")) {
          return new Response(
            JSON.stringify({ markets: [buildDflowMarket(false)] }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.includes("/markets/by-mint/")) {
          return new Response(
            JSON.stringify({ market: buildDflowMarket(false) }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`unexpected-fetch:${url}`);
      }) as typeof fetch;

      const marketsResponse = await worker.fetch(
        new Request(
          "http://localhost/api/terminal/prediction-markets?venueKey=dflow&limit=6",
          { headers: { authorization: "Bearer test" } },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(marketsResponse.status).toBe(200);
      const marketsBody = (await marketsResponse.json()) as {
        markets?: Array<{ marketId?: string; resolved?: boolean }>;
      };
      expect(marketsBody.markets?.[0]?.marketId).toBe("PRES-2028");
      expect(marketsBody.markets?.[0]?.resolved).toBe(false);

      const previewResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/prediction-preview", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            venueKey: "dflow",
            instrumentId: "PRES-2028",
            instrumentLabel: "Will candidate X win in 2028?",
            outcomeId: "YesMint1111111111111111111111111111111",
            side: "buy_yes",
            quantityAtomic: "1000000",
            orderType: "limit",
            timeInForce: "gtc",
            quantityMode: "base",
            limitPriceAtomic: "520000",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = (await previewResponse.json()) as {
        preview?: { outcomeSide?: string; estimatedNotionalUsd?: number };
      };
      expect(previewBody.preview?.outcomeSide).toBe("yes");
      expect(previewBody.preview?.estimatedNotionalUsd).toBe(0.52);
    } finally {
      sqlite.close();
    }
  });

  test("prediction order submit, positions, and settlement routes persist the paper lifecycle", async () => {
    const { env, sqlite } = createExecEnv();
    let resolved = false;
    try {
      global.fetch = mock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/markets?")) {
          return new Response(
            JSON.stringify({ markets: [buildDflowMarket(resolved)] }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.includes("/markets/by-mint/")) {
          return new Response(
            JSON.stringify({ market: buildDflowMarket(resolved) }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`unexpected-fetch:${url}`);
      }) as typeof fetch;

      const submitResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/prediction-orders", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
            "idempotency-key": "pred-order-1",
          },
          body: JSON.stringify({
            venueKey: "dflow",
            instrumentId: "PRES-2028",
            instrumentLabel: "Will candidate X win in 2028?",
            outcomeId: "YesMint1111111111111111111111111111111",
            side: "buy_yes",
            quantityAtomic: "1000000",
            orderType: "market",
            timeInForce: "gtc",
            quantityMode: "base",
            source: "PREDICTION_TICKET",
            reason: "Buy YES into event catalyst",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submitResponse.status).toBe(200);
      const submitBody = (await submitResponse.json()) as {
        result?: { requestId?: string; status?: string };
      };
      expect(submitBody.result?.status).toBe("finalized");

      const positionsResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/prediction-positions", {
          headers: { authorization: "Bearer test" },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(positionsResponse.status).toBe(200);
      const positionsBody = (await positionsResponse.json()) as {
        positions?: Array<{
          key?: string;
          netQuantityAtomic?: string;
          canSettle?: boolean;
          positionState?: string;
        }>;
      };
      expect(positionsBody.positions?.[0]?.netQuantityAtomic).toBe("1000000");
      expect(positionsBody.positions?.[0]?.canSettle).toBe(false);
      expect(positionsBody.positions?.[0]?.positionState).toBe("open");

      resolved = true;
      const resolvedPositionsResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/prediction-positions", {
          headers: { authorization: "Bearer test" },
        }),
        env,
        createExecutionContextStub(),
      );
      const resolvedPositionsBody =
        (await resolvedPositionsResponse.json()) as {
          positions?: Array<{
            key?: string;
            canSettle?: boolean;
            expectedPayoutAtomic?: string;
          }>;
        };
      const positionKey = resolvedPositionsBody.positions?.[0]?.key ?? "";
      expect(resolvedPositionsBody.positions?.[0]?.canSettle).toBe(true);
      expect(resolvedPositionsBody.positions?.[0]?.expectedPayoutAtomic).toBe(
        "1000000",
      );

      const settleResponse = await worker.fetch(
        new Request(
          `http://localhost/api/terminal/prediction-positions/${encodeURIComponent(positionKey)}/settle`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer test",
              "idempotency-key": "pred-settle-1",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(settleResponse.status).toBe(200);
      const settleBody = (await settleResponse.json()) as {
        result?: { status?: string };
      };
      expect(settleBody.result?.status).toBe("finalized");

      const closedPositionsResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/prediction-positions", {
          headers: { authorization: "Bearer test" },
        }),
        env,
        createExecutionContextStub(),
      );
      const closedPositionsBody = (await closedPositionsResponse.json()) as {
        positions?: Array<{
          netQuantityAtomic?: string;
          positionState?: string;
          settlementState?: string;
        }>;
      };
      expect(closedPositionsBody.positions?.[0]?.netQuantityAtomic).toBe("0");
      expect(closedPositionsBody.positions?.[0]?.positionState).toBe("closed");
      expect(closedPositionsBody.positions?.[0]?.settlementState).toBe(
        "redeemed",
      );
    } finally {
      sqlite.close();
    }
  });
});
