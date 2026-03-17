import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const executeRuntimeStrategyDeskScenarioWorkflowMock = mock(
  async (input: {
    scenarioId: string;
    runKind: "shadow" | "paper";
    requestedBy: string;
    walletAddress: string;
  }) => ({
    scenario: {
      schemaVersion: "v1",
      scenarioId: input.scenarioId,
      title: "Mock desk scenario",
      summary: "Mock scenario summary",
      ownerUserId: "user_1",
      strategyKey: "strategy_desk::mock",
      thesis: "Mock thesis",
      state: "paper_ready",
      createdAt: "2026-03-17T03:00:00Z",
      updatedAt: "2026-03-17T03:05:00Z",
      legs: [],
      evidence: [],
      implementationReferences: [],
      tags: [],
    },
    run: {
      schemaVersion: "v1",
      scenarioRunId: "desk_run_mock_1",
      scenarioId: input.scenarioId,
      scenarioState: "paper_ready",
      runKind: input.runKind,
      state: "completed",
      requestedBy: input.requestedBy,
      trigger: {
        kind: "operator",
        source: "strategy_desk_runner",
        observedAt: "2026-03-17T03:06:00Z",
      },
      createdAt: "2026-03-17T03:06:00Z",
      updatedAt: "2026-03-17T03:06:01Z",
      legRuns: [],
    },
    report: {
      schemaVersion: "v1",
      reportId: "desk_report_mock_1",
      scenarioId: input.scenarioId,
      scenarioRunId: "desk_run_mock_1",
      stage: input.runKind,
      status: "pass",
      summary: "Mock report",
      generatedAt: "2026-03-17T03:06:02Z",
      legOutcomes: [
        {
          legId: "leg_1",
          status: "pass",
          evidenceRefs: [
            {
              kind: "strategy_desk_leg_receipt",
              ref: "desk_run_mock_1:leg_1",
            },
          ],
        },
      ],
      evidence: [],
      checks: [
        {
          checkId: "mock",
          status: "pass",
          message: "mock",
        },
      ],
      approvals: [],
    },
  }),
);

mock.module("../../apps/worker/src/runtime_strategy_desk_runner", () => ({
  executeRuntimeStrategyDeskScenarioWorkflow:
    executeRuntimeStrategyDeskScenarioWorkflowMock,
}));
mock.module("../../apps/worker/src/auth", () => ({
  requireUser: mock(async () => ({
    privyUserId: "did:privy:user_1",
    email: "user@example.com",
  })),
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
    "0031_strategy_desk_registry.sql",
    "0032_strategy_desk_leg_intent.sql",
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
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("worker runtime strategy desk execute route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/execute",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              runKind: "paper",
              requestedBy: "operator_1",
              walletAddress: "11111111111111111111111111111111",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(401);
    } finally {
      sqlite.close();
    }
  });

  test("dispatches scenario execution through the runner workflow", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/execute",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              runKind: "paper",
              requestedBy: "operator_1",
              walletAddress: "11111111111111111111111111111111",
              maxRetriesPerLeg: 1,
              trigger: {
                reason: "manual-eval",
              },
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        run: { scenarioRunId: string };
        report: { reportId: string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.run.scenarioRunId).toBe("desk_run_mock_1");
      expect(payload.report.reportId).toBe("desk_report_mock_1");
      expect(
        executeRuntimeStrategyDeskScenarioWorkflowMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
          maxRetriesPerLeg: 1,
          trigger: {
            reason: "manual-eval",
          },
        }),
      );
    } finally {
      sqlite.close();
    }
  });
});
