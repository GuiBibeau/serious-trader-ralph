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
      DRIFT_DATA_API_BASE: "https://drift.test",
      DRIFT_SWIFT_API_BASE: "",
    },
  });
  return { env, sqlite };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  requireUserMock.mockClear();
});

describe("worker terminal perp routes", () => {
  test("perp discovery, preview, submit, and positions persist the paper lifecycle", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      global.fetch = mock(async (input: RequestInfo | URL) => {
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
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
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
                  ts: "2026-03-14T18:00:00.000Z",
                },
              ],
            }),
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
          "http://localhost/api/terminal/perp-markets?venueKey=drift&limit=4",
          { headers: { authorization: "Bearer test" } },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(marketsResponse.status).toBe(200);
      const marketsBody = (await marketsResponse.json()) as {
        markets?: Array<{ instrumentId?: string; initialMarginRatio?: number }>;
      };
      expect(marketsBody.markets?.[0]?.instrumentId).toBe("SOL-PERP");
      expect(marketsBody.markets?.[0]?.initialMarginRatio).toBe(0.1);

      const previewResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-preview", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            instrumentLabel: "SOL-PERP",
            side: "long",
            quantityAtomic: "2",
            collateralAtomic: "100000000",
            orderType: "limit",
            timeInForce: "gtc",
            limitPriceAtomic: "155000000",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = (await previewResponse.json()) as {
        preview?: {
          provider?: string;
          projectedSignedQuantityAtomic?: string;
          projectedNotionalQuote?: number;
        };
      };
      expect(previewBody.preview?.provider).toBe("drift");
      expect(previewBody.preview?.projectedSignedQuantityAtomic).toBe("2");
      expect(previewBody.preview?.projectedNotionalQuote).toBeCloseTo(306.6, 3);

      const submitResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-orders", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
            "idempotency-key": "perp-order-1",
          },
          body: JSON.stringify({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            instrumentLabel: "SOL-PERP",
            side: "long",
            quantityAtomic: "2",
            collateralAtomic: "100000000",
            orderType: "market",
            timeInForce: "gtc",
            source: "PERPS_PANEL",
            reason: "Open tactical long",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submitResponse.status).toBe(200);
      const submitBody = (await submitResponse.json()) as {
        result?: { status?: string; instrumentId?: string };
      };
      expect(submitBody.result?.status).toBe("finalized");
      expect(submitBody.result?.instrumentId).toBe("SOL-PERP");

      const positionsResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-positions", {
          headers: { authorization: "Bearer test" },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(positionsResponse.status).toBe(200);
      const positionsBody = (await positionsResponse.json()) as {
        positions?: Array<{
          instrumentId?: string;
          side?: string;
          signedQuantityAtomic?: string;
          collateralAtomic?: string;
          positionState?: string;
          initialMarginRatio?: number;
          maintenanceMarginRatio?: number;
        }>;
      };
      expect(positionsBody.positions?.[0]?.instrumentId).toBe("SOL-PERP");
      expect(positionsBody.positions?.[0]?.side).toBe("long");
      expect(positionsBody.positions?.[0]?.signedQuantityAtomic).toBe("2");
      expect(positionsBody.positions?.[0]?.collateralAtomic).toBe("100000000");
      expect(positionsBody.positions?.[0]?.positionState).toBe("open");
      expect(positionsBody.positions?.[0]?.initialMarginRatio).toBe(0.1);
      expect(positionsBody.positions?.[0]?.maintenanceMarginRatio).toBe(0.05);
    } finally {
      sqlite.close();
    }
  });

  test("perp preview uses the current position hint instead of requiring history scans", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      global.fetch = mock(async (input: RequestInfo | URL) => {
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
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
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
                  ts: "2026-03-14T18:00:00.000Z",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        throw new Error(`unexpected-fetch:${url}`);
      }) as typeof fetch;

      const previewResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-preview", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            instrumentLabel: "SOL-PERP",
            side: "long",
            quantityAtomic: "2",
            collateralAtomic: "100000000",
            currentPosition: {
              instrumentId: "SOL-PERP",
              signedQuantityAtomic: "5",
              collateralAtomic: "200000000",
              averageEntryPrice: 150,
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = (await previewResponse.json()) as {
        preview?: {
          currentSignedQuantityAtomic?: string;
          currentCollateralAtomic?: string;
          projectedSignedQuantityAtomic?: string;
          projectedCollateralAtomic?: string;
        };
      };
      expect(previewBody.preview?.currentSignedQuantityAtomic).toBe("5");
      expect(previewBody.preview?.currentCollateralAtomic).toBe("200000000");
      expect(previewBody.preview?.projectedSignedQuantityAtomic).toBe("7");
      expect(previewBody.preview?.projectedCollateralAtomic).toBe("300000000");
    } finally {
      sqlite.close();
    }
  });

  test("perp preview and submit reject non-positive quantities as validation errors", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const driftFetch = mock(async () => {
        throw new Error("drift-should-not-be-called");
      });
      global.fetch = driftFetch as typeof fetch;

      const previewResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-preview", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            instrumentLabel: "SOL-PERP",
            side: "long",
            quantityAtomic: "0",
            collateralAtomic: "100000000",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(previewResponse.status).toBe(400);
      await expect(previewResponse.json()).resolves.toEqual({
        ok: false,
        error: "invalid-terminal-perp-order",
      });

      const submitResponse = await worker.fetch(
        new Request("http://localhost/api/terminal/perp-orders", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
            "idempotency-key": "perp-order-zero",
          },
          body: JSON.stringify({
            venueKey: "drift",
            instrumentId: "SOL-PERP",
            instrumentLabel: "SOL-PERP",
            side: "long",
            quantityAtomic: "0",
            collateralAtomic: "100000000",
            source: "PERPS_PANEL",
            reason: "Invalid zero-sized order",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submitResponse.status).toBe(400);
      await expect(submitResponse.json()).resolves.toEqual({
        ok: false,
        error: "invalid-terminal-perp-order",
      });
      expect(driftFetch).not.toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  });
});
