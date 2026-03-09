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

function createRuntimeCanaryEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
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

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      RUNTIME_CANARY_ENABLED: "1",
      RUNTIME_CANARY_AUTO_CREATE_WALLET: "0",
      RUNTIME_CANARY_DEPLOYMENT_ID: "runtime_canary_live_dca",
      RUNTIME_CANARY_NOTIONAL_USD: "5",
      RUNTIME_CANARY_ALLOCATED_USD: "25",
      RUNTIME_CANARY_DAILY_CAP_USD: "25",
      RUNTIME_CANARY_MAX_SLIPPAGE_BPS: "50",
      RUNTIME_CANARY_MIN_SOL_RESERVE_LAMPORTS: "50000000",
      RUNTIME_INTERNAL_STUB_MODE: "1",
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("worker runtime canary admin routes", () => {
  test("requires admin auth for runtime canary snapshot", async () => {
    const { env, sqlite } = createRuntimeCanaryEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/runtime/canary"),
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

  test("returns runtime canary snapshot when authorized", async () => {
    const { env, sqlite } = createRuntimeCanaryEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/runtime/canary", {
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
          deploymentId: "runtime_canary_live_dca",
          pairId: "SOL/USDC",
          notionalUsd: "5",
          allocatedUsd: "25",
          dailyCapUsd: 25,
          maxSlippageBps: 50,
        },
        deployment: {
          deploymentId: "runtime_canary_live_dca",
          mode: "live",
          state: "live",
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

  test("reports skipped post-deploy runs when config disables runtime canary", async () => {
    const { env, sqlite } = createRuntimeCanaryEnv({
      RUNTIME_CANARY_ENABLED: "0",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/runtime/canary/run", {
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
        error: "runtime-canary-disabled-by-config",
      });
    } finally {
      sqlite.close();
    }
  });
});
