import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const executeRuntimeStrategyDeskStudyWorkflowMock = mock(
  async (input: {
    scenarioId: string;
    runKind: "replay" | "backtest";
    requestedBy: string;
    variantIds?: string[];
    windowIds?: string[];
  }) => ({
    scenario: {
      schemaVersion: "v1",
      scenarioId: input.scenarioId,
      title: "Mock study scenario",
      summary: "Mock study summary",
      ownerUserId: "user_1",
      strategyKey: "strategy_desk::mock",
      thesis: "Mock thesis",
      state: "replay_ready",
      createdAt: "2026-03-17T03:00:00Z",
      updatedAt: "2026-03-17T03:05:00Z",
      legs: [],
      evidence: [],
      implementationReferences: [],
      tags: [],
      researchMatrix: {
        selectionMetric: "excess_vs_flat_cash_bps",
        backtestLegs: [],
        windows: [],
        variants: [],
      },
    },
    run: {
      schemaVersion: "v1",
      scenarioRunId: "desk_run_study_mock_1",
      scenarioId: input.scenarioId,
      scenarioState: "replay_ready",
      runKind: input.runKind,
      state: "completed",
      requestedBy: input.requestedBy,
      trigger: {
        kind: "operator",
        source: "strategy_desk_study",
        observedAt: "2026-03-17T03:06:00Z",
      },
      createdAt: "2026-03-17T03:06:00Z",
      updatedAt: "2026-03-17T03:06:01Z",
      completedAt: "2026-03-17T03:06:30Z",
      legRuns: [],
    },
    report: {
      schemaVersion: "v1",
      reportId: "desk_report_study_mock_1",
      scenarioId: input.scenarioId,
      scenarioRunId: "desk_run_study_mock_1",
      stage: input.runKind,
      status: "pass",
      summary: "Mock study report",
      generatedAt: "2026-03-17T03:06:30Z",
      legOutcomes: [
        {
          legId: "leg_1",
          status: "pass",
          evidenceRefs: [],
        },
      ],
      studyMatrix: {
        matrixId: "matrix_1",
        runKind: input.runKind,
        selectionMetric: "excess_vs_flat_cash_bps",
        generatedAt: "2026-03-17T03:06:30Z",
        selectedVariantId: "fast",
        windows: [
          {
            windowId: "selection_1",
            label: "Selection 1",
            cohort: "selection",
          },
        ],
        variantSummaries: [
          {
            variantId: "fast",
            label: "Fast",
            parameterManifest: { threshold: "fast" },
            selectionWindowCount: 1,
            holdoutWindowCount: 0,
            selectionMetrics: {
              observationCount: 2,
              tradeCount: 1,
              grossReturnBps: "10.0000",
              netReturnBps: "8.0000",
              totalCostBps: "2.0000",
              winRateBps: 5000,
              maxDrawdownBps: "5.0000",
            },
            selectionBaselineComparisons: [
              {
                baseline: "flat_cash",
                baselineReturnBps: "0.0000",
                excessReturnBps: "8.0000",
              },
            ],
          },
        ],
        cells: [
          {
            cellId: "fast:selection_1",
            variantId: "fast",
            variantLabel: "Fast",
            windowId: "selection_1",
            windowLabel: "Selection 1",
            cohort: "selection",
            status: "completed",
            legResults: [
              {
                legId: "leg_1",
                reportId: "backtest_fast_selection_1_leg_1",
                reproducibilityBundleId:
                  "repro_backtest_fast_selection_1_leg_1",
                status: "completed",
                metrics: {
                  observationCount: 2,
                  tradeCount: 1,
                  grossReturnBps: "10.0000",
                  netReturnBps: "8.0000",
                  totalCostBps: "2.0000",
                  winRateBps: 5000,
                  maxDrawdownBps: "5.0000",
                },
                baselineComparisons: [
                  {
                    baseline: "flat_cash",
                    baselineReturnBps: "0.0000",
                    excessReturnBps: "8.0000",
                  },
                ],
              },
            ],
            aggregateMetrics: {
              observationCount: 2,
              tradeCount: 1,
              grossReturnBps: "10.0000",
              netReturnBps: "8.0000",
              totalCostBps: "2.0000",
              winRateBps: 5000,
              maxDrawdownBps: "5.0000",
            },
            aggregateBaselineComparisons: [
              {
                baseline: "flat_cash",
                baselineReturnBps: "0.0000",
                excessReturnBps: "8.0000",
              },
            ],
          },
        ],
      },
      evidence: [],
      checks: [
        {
          checkId: "matrix-generated",
          status: "pass",
          message: "matrix ok",
        },
      ],
      approvals: [],
    },
  }),
);

mock.module("../../apps/worker/src/runtime_strategy_desk_study", () => ({
  executeRuntimeStrategyDeskStudyWorkflow:
    executeRuntimeStrategyDeskStudyWorkflowMock,
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
    "0033_strategy_desk_scorecards.sql",
    "0034_strategy_desk_research_matrix.sql",
    "0035_strategy_desk_promotion_handoffs.sql",
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

describe("worker runtime strategy desk study route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/study",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              runKind: "backtest",
              requestedBy: "operator_1",
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

  test("dispatches scenario study through the study workflow", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/study",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              runKind: "backtest",
              requestedBy: "operator_1",
              variantIds: ["fast"],
              windowIds: ["selection_1"],
              selectionMetric: "excess_vs_flat_cash_bps",
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
        report: {
          reportId: string;
          studyMatrix?: { selectedVariantId?: string };
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.run.scenarioRunId).toBe("desk_run_study_mock_1");
      expect(payload.report.reportId).toBe("desk_report_study_mock_1");
      expect(payload.report.studyMatrix?.selectedVariantId).toBe("fast");
      expect(executeRuntimeStrategyDeskStudyWorkflowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioId: "desk_sol_composite_1",
          runKind: "backtest",
          requestedBy: "operator_1",
          variantIds: ["fast"],
          windowIds: ["selection_1"],
          selectionMetric: "excess_vs_flat_cash_bps",
        }),
      );
    } finally {
      sqlite.close();
    }
  });
});
