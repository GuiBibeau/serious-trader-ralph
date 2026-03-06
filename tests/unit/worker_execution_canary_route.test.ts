import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
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

function createExecutionCanaryEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
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

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      EXEC_CANARY_ENABLED: "0",
      EXEC_CANARY_AUTO_CREATE_WALLET: "0",
      EXEC_CANARY_NOTIONAL_USD: "5",
      EXEC_CANARY_DAILY_CAP_USD: "25",
      EXEC_CANARY_MAX_SLIPPAGE_BPS: "50",
      EXEC_CANARY_MIN_SOL_RESERVE_LAMPORTS: "50000000",
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("worker execution canary admin routes", () => {
  test("requires admin auth for canary snapshot", async () => {
    const { env, sqlite } = createExecutionCanaryEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/execution/canary"),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: "auth-required",
      });
    } finally {
      sqlite.close();
    }
  });

  test("returns canary snapshot when authorized", async () => {
    const { env, sqlite } = createExecutionCanaryEnv({
      EXEC_CANARY_ENABLED: "1",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/execution/canary", {
          headers: {
            authorization: "Bearer admin-secret",
          },
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        config: {
          enabled: true,
          pairId: "SOL/USDC",
          notionalUsd: "5",
          dailyCapUsd: 25,
          maxSlippageBps: 50,
        },
        wallet: {
          walletId: null,
          walletAddress: null,
        },
      });
    } finally {
      sqlite.close();
    }
  });

  test("reports skipped post-deploy runs when config disables canary", async () => {
    const { env, sqlite } = createExecutionCanaryEnv({
      EXEC_CANARY_ENABLED: "0",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/execution/canary/run", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ trigger: "post_deploy" }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: false,
        status: "skipped",
        triggerSource: "post_deploy",
        error: "execution-canary-disabled-by-config",
      });
    } finally {
      sqlite.close();
    }
  });
});
