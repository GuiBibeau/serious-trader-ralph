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
      EXEC_CANARY_ENABLED: "1",
      EXEC_CANARY_AUTO_CREATE_WALLET: "0",
      RUNTIME_CANARY_ENABLED: "1",
      RUNTIME_CANARY_AUTO_CREATE_WALLET: "0",
      RUNTIME_CANARY_DEPLOYMENT_ID: "runtime_canary_live_dca",
      RUNTIME_CANARY_NOTIONAL_USD: "5",
      RUNTIME_CANARY_ALLOCATED_USD: "25",
      RUNTIME_CANARY_DAILY_CAP_USD: "25",
      RUNTIME_CANARY_MAX_SLIPPAGE_BPS: "50",
      RUNTIME_CANARY_MIN_SOL_RESERVE_LAMPORTS: "50000000",
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
            runtime: {
              enabled: false,
              disabledReason: "runtime-incident-123",
              shadowOnly: false,
              shadowOnlyReason: null,
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
          runtime: {
            enabled: true,
            disabledReason: null,
            shadowOnly: true,
            shadowOnlyReason: "live-rollout-pending",
          },
        },
      });
    } finally {
      sqlite.close();
    }
  });

  test("returns runtime admin snapshot with health, lag, and deployment state", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/runtime", {
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
        runtime: {
          ok: true,
          controls: {
            enabled: true,
            shadowOnly: true,
            shadowOnlyReason: "live-rollout-pending",
          },
          integration: {
            stubModeEnabled: true,
          },
          health: {
            status: "healthy",
            feedGateway: {
              maxMarketAgeMs: expect.any(Number),
            },
            featureCache: {
              maxFeatureAgeMs: expect.any(Number),
            },
          },
          deployments: [
            {
              deploymentId: "deployment_shadow_fixture",
              mode: "shadow",
              state: "shadow",
            },
          ],
          canary: {
            ok: true,
            config: {
              enabled: true,
              deploymentId: "runtime_canary_live_dca",
              dailyCapUsd: 25,
              maxSlippageBps: 50,
            },
            deployment: {
              deploymentId: "runtime_canary_live_dca",
              mode: "live",
              state: "live",
            },
          },
        },
      });
    } finally {
      sqlite.close();
    }
  });

  test("blocks runtime resumes when the global runtime kill switch is enabled", async () => {
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
            runtime: {
              enabled: false,
              disabledReason: "runtime-incident-456",
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(patchResponse.status).toBe(200);

      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/deployments/deployment_shadow_fixture/resume",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "runtime-disabled",
        deploymentId: "deployment_shadow_fixture",
      });
    } finally {
      sqlite.close();
    }
  });

  test("blocks non-shadow runtime resumes while shadow-only mode is enabled", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/deployments/deployment_paper_fixture/resume",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "runtime-shadow-only",
        deploymentId: "deployment_paper_fixture",
        mode: "paper",
      });
    } finally {
      sqlite.close();
    }
  });

  test("proxies runtime deployment pause controls through the worker admin surface", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/deployments/deployment_shadow_fixture/pause",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        action: "pause",
        deployment: {
          deploymentId: "deployment_shadow_fixture",
          state: "paused",
        },
      });
    } finally {
      sqlite.close();
    }
  });

  test("fails closed on malformed runtime admin deployment IDs", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/deployments/%E0%A4%A/resume",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "not-found",
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
          runtime: {
            enabled: true,
            shadowOnly: true,
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
        runtime: {
          ok: true,
          deployments: [
            {
              deploymentId: "deployment_shadow_fixture",
            },
          ],
        },
      });
    } finally {
      sqlite.close();
    }
  });
});
