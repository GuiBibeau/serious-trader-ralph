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

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      RUNTIME_INTERNAL_STUB_MODE: "1",
      RUNTIME_INTERNAL_SERVICE_TOKEN: "runtime-secret",
      ...overrides,
    },
  });

  return { env, sqlite };
}

async function seedControls(env: Env): Promise<void> {
  for (const control of [
    {
      subjectKind: "venue",
      subjectKey: "jupiter",
      liveAllowed: true,
      killSwitchEnabled: false,
      updatedBy: "codex",
    },
    {
      subjectKind: "asset",
      subjectKey: "SOL",
      liveAllowed: true,
      killSwitchEnabled: false,
      updatedBy: "codex",
    },
  ]) {
    const response = await worker.fetch(
      new Request(
        "http://localhost/api/admin/ops/runtime/research/subject-controls",
        {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify(control),
        },
      ),
      env,
      createExecutionContextStub(),
    );
    expect(response.status).toBe(200);
  }
}

describe("worker runtime research post-live route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/post-live",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "strategy",
              subjectKey: "candidate_trend_following_jupiter_sol_usdc",
              requestedBy: "codex",
              currentState: "limited_live",
              deploymentId: "dep_trend_following_sol_usdc_limited_live",
            }),
          },
        ),
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

  test("stores a healthy post-live artifact", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      await seedControls(env);

      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/post-live",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "strategy",
              subjectKey: "candidate_trend_following_jupiter_sol_usdc",
              requestedBy: "codex",
              currentState: "limited_live",
              deploymentId: "dep_trend_following_sol_usdc_limited_live",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        artifact: {
          status: string;
          recommendedAction: string;
          postLiveId: string;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.artifact.status).toBe("pass");
      expect(payload.artifact.recommendedAction).toBe("observe");

      const listResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/research/post-live?postLiveId=${payload.artifact.postLiveId}`,
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(listResponse.status).toBe(200);
      const listPayload = (await listResponse.json()) as {
        ok: boolean;
        artifacts: Array<{ postLiveId: string }>;
      };
      expect(listPayload.ok).toBe(true);
      expect(listPayload.artifacts[0]?.postLiveId).toBe(
        payload.artifact.postLiveId,
      );
    } finally {
      sqlite.close();
    }
  });

  test("demotes a limited-live strategy when drift is applied", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      await seedControls(env);

      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/post-live",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "strategy",
              subjectKey: "candidate_trend_following_jupiter_sol_usdc",
              requestedBy: "codex",
              currentState: "limited_live",
              deploymentId: "dep_trend_following_sol_usdc_limited_live",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              applyAction: true,
              externalChecks: [
                {
                  checkId: "operator-drift-injection",
                  status: "blocked",
                  message: "Drift injection for rollback drill.",
                },
              ],
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        artifact: {
          status: string;
          appliedAction: string;
          appliedTargetState: string;
          followUpPromotionId: string;
        };
        promotion: {
          targetState: string;
          status: string;
        };
        event: { eventType: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.artifact.status).toBe("applied");
      expect(payload.artifact.appliedAction).toBe("demote");
      expect(payload.artifact.appliedTargetState).toBe("paper");
      expect(payload.promotion.targetState).toBe("paper");
      expect(payload.promotion.status).toBe("applied");
      expect(payload.event.eventType).toBe("applied");
      expect(payload.artifact.followUpPromotionId).toBeTruthy();
    } finally {
      sqlite.close();
    }
  });
});
