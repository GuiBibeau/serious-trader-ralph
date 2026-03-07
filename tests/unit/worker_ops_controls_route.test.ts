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

function createOpsEnv(overrides?: Partial<Env>) {
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
      EXEC_CANARY_ENABLED: "1",
      EXEC_CANARY_AUTO_CREATE_WALLET: "0",
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("worker ops controls routes", () => {
  test("requires admin auth for ops controls", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/controls"),
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

  test("applies no-redeploy execution and canary kill switches", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const patchResponse = await worker.fetch(
        new Request("http://localhost/api/admin/ops/controls", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            updatedBy: "test-suite",
            execution: {
              enabled: false,
              disabledReason: "incident-123",
            },
            canary: {
              enabled: false,
              disabledReason: "incident-123",
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(patchResponse.status).toBe(200);

      const healthResponse = await worker.fetch(
        new Request("http://localhost/api/x402/exec/health"),
        env,
        createExecutionContextStub(),
      );
      const healthPayload = (await healthResponse.json()) as Record<
        string,
        unknown
      >;
      expect(healthPayload.ok).toBe(false);
      expect(healthPayload.controls).toMatchObject({
        execution: {
          enabled: false,
          disabledReason: "incident-123",
        },
      });
      expect(healthPayload.lanes).toMatchObject({
        fast: { enabled: false },
        protected: { enabled: false },
        safe: { enabled: false },
      });

      const canaryResponse = await worker.fetch(
        new Request("http://localhost/api/admin/execution/canary/run", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ trigger: "manual" }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(canaryResponse.status).toBe(200);
      expect(await canaryResponse.json()).toMatchObject({
        ok: false,
        status: "disabled",
        error: "incident-123",
      });
    } finally {
      sqlite.close();
    }
  });

  test("resets ops controls back to baseline", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      await worker.fetch(
        new Request("http://localhost/api/admin/ops/controls", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            execution: {
              enabled: false,
              disabledReason: "incident-123",
              lanes: {
                safe: false,
              },
            },
            canary: {
              enabled: false,
              disabledReason: "incident-123",
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      const resetResponse = await worker.fetch(
        new Request("http://localhost/api/admin/ops/controls/reset", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
          },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(resetResponse.status).toBe(200);
      expect(await resetResponse.json()).toMatchObject({
        ok: true,
        controls: {
          execution: {
            enabled: true,
            disabledReason: null,
            lanes: {
              fast: true,
              protected: true,
              safe: true,
            },
          },
          canary: {
            enabled: true,
            disabledReason: null,
          },
        },
      });
    } finally {
      sqlite.close();
    }
  });

  test("returns aggregated admin ops dashboard", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/dashboard", {
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
        controls: {
          execution: {
            enabled: true,
          },
        },
        canary: {
          ok: true,
        },
        execution: {
          totals: {
            accepted: 0,
          },
        },
      });
    } finally {
      sqlite.close();
    }
  });
});
