import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getRuntimeStrategyDeskScenarioWorkflow,
  upsertRuntimeStrategyDeskScenarioWorkflow,
} from "../../apps/worker/src/runtime_strategy_desk";
import type { Env } from "../../apps/worker/src/types";
import { createWorkerLiveEnv } from "../integration/_worker_live_test_utils";

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

function readFixture(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs/runtime-contracts/fixtures",
        fileName,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function buildBacktestReport(input: {
  reportId: string;
  experimentId: string;
  venueKey: string;
  netReturnBps: string;
  grossReturnBps: string;
  totalCostBps: string;
  tradeCount: number;
  maxDrawdownBps: string;
  excessVsFlatCashBps: string;
  windowMode?: "rolling" | "expanding" | "anchored";
}) {
  const base = readFixture("runtime.backtest_report.valid.v1.json") as Record<
    string,
    unknown
  >;
  return {
    ...base,
    reportId: input.reportId,
    experimentId: input.experimentId,
    generatedAt: "2026-03-17T05:00:00Z",
    venueKeys: [input.venueKey],
    config: {
      ...(base.config as Record<string, unknown>),
      venueKey: input.venueKey,
      windowMode: input.windowMode ?? "rolling",
    },
    aggregateMetrics: {
      observationCount: 4,
      tradeCount: input.tradeCount,
      grossReturnBps: input.grossReturnBps,
      netReturnBps: input.netReturnBps,
      totalCostBps: input.totalCostBps,
      winRateBps: 5000,
      maxDrawdownBps: input.maxDrawdownBps,
    },
    aggregateBaselineComparisons: [
      {
        baseline: "flat_cash",
        baselineReturnBps: "0.0000",
        excessReturnBps: input.excessVsFlatCashBps,
      },
      {
        baseline: "buy_and_hold",
        baselineReturnBps: "12.0000",
        excessReturnBps: (Number(input.netReturnBps) - 12).toFixed(4),
      },
    ],
    blockingReasons: [],
    summary: `Synthetic report ${input.reportId}`,
  };
}

function buildStudyScenario(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const scenario = readFixture(
    "runtime.strategy_desk_scenario.valid.v1.json",
  ) as Record<string, unknown>;
  return {
    ...scenario,
    state: "replay_ready",
    researchMatrix: {
      selectionMetric: "excess_vs_flat_cash_bps",
      backtestLegs: [
        {
          legId: "leg_spot_alpha",
          experimentId: "exp_spot_base",
          replayCorpusId: "replay_sol_usdc",
          venueKey: "jupiter",
          pairSymbol: "SOL/USDC",
          marketType: "spot",
          windowMode: "rolling",
          trainingWindowObservations: 8,
          testingWindowObservations: 4,
          stepObservations: 4,
          purgeObservations: 1,
          baselineStrategies: ["flat_cash", "buy_and_hold"],
        },
      ],
      windows: [
        {
          windowId: "selection_week_1",
          label: "Selection week 1",
          cohort: "selection",
          windowMode: "rolling",
          trainingWindowObservations: 8,
          testingWindowObservations: 4,
          stepObservations: 4,
          purgeObservations: 1,
        },
      ],
      variants: [
        {
          variantId: "fast",
          label: "Fast",
          parameterManifest: {
            threshold: "fast",
          },
        },
      ],
    },
    ...overrides,
  };
}

let studyWorkflowImport:
  | Promise<
      typeof import("../../apps/worker/src/runtime_strategy_desk_study.ts")
    >
  | undefined;

async function getStudyWorkflow() {
  mock.restore();
  studyWorkflowImport ??= import(
    "../../apps/worker/src/runtime_strategy_desk_study.ts?runtime-study-real"
  );
  return (await studyWorkflowImport).executeRuntimeStrategyDeskStudyWorkflow;
}

describe("runtime strategy desk study workflow", () => {
  test("builds a multi-window study matrix and preserves holdout summaries", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const executeRuntimeStrategyDeskStudyWorkflow = await getStudyWorkflow();
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      ) as Record<string, unknown>;
      const studyScenario = {
        ...scenario,
        state: "replay_ready",
        researchMatrix: {
          selectionMetric: "excess_vs_flat_cash_bps",
          backtestLegs: [
            {
              legId: "leg_spot_alpha",
              experimentId: "exp_spot_base",
              replayCorpusId: "replay_sol_usdc",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
              marketType: "spot",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
              baselineStrategies: ["flat_cash", "buy_and_hold"],
            },
            {
              legId: "leg_perp_hedge",
              experimentId: "exp_perp_base",
              replayCorpusId: "replay_sol_perp",
              venueKey: "drift",
              pairSymbol: "SOL-PERP",
              marketType: "perp",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
              baselineStrategies: ["flat_cash", "buy_and_hold"],
            },
          ],
          windows: [
            {
              windowId: "selection_week_1",
              label: "Selection week 1",
              cohort: "selection",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
            },
            {
              windowId: "holdout_week_1",
              label: "Holdout week 1",
              cohort: "holdout",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
            },
          ],
          variants: [
            {
              variantId: "fast",
              label: "Fast",
              parameterManifest: {
                threshold: "fast",
              },
              legOverrides: [
                {
                  legId: "leg_spot_alpha",
                  experimentId: "fast_spot",
                },
                {
                  legId: "leg_perp_hedge",
                  experimentId: "fast_perp",
                },
              ],
            },
            {
              variantId: "slow",
              label: "Slow",
              parameterManifest: {
                threshold: "slow",
              },
              legOverrides: [
                {
                  legId: "leg_spot_alpha",
                  experimentId: "slow_spot",
                },
                {
                  legId: "leg_perp_hedge",
                  experimentId: "slow_perp",
                },
              ],
            },
          ],
        },
      };

      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: studyScenario as never,
      });

      const result = await executeRuntimeStrategyDeskStudyWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "backtest",
          requestedBy: "operator_1",
        },
        {
          createId(prefix) {
            return prefix;
          },
          now() {
            return "2026-03-17T05:00:00Z";
          },
          async runRuntimeBacktest({ payload }) {
            const request = payload as {
              reportId: string;
              experimentId: string;
            };
            const reportId = request.reportId;
            const report = reportId.includes(
              "fast_selection_week_1_leg_spot_alpha",
            )
              ? buildBacktestReport({
                  reportId,
                  experimentId: request.experimentId,
                  venueKey: "jupiter",
                  netReturnBps: "80.0000",
                  grossReturnBps: "95.0000",
                  totalCostBps: "15.0000",
                  tradeCount: 6,
                  maxDrawdownBps: "35.0000",
                  excessVsFlatCashBps: "80.0000",
                })
              : reportId.includes("fast_selection_week_1_leg_perp_hedge")
                ? buildBacktestReport({
                    reportId,
                    experimentId: request.experimentId,
                    venueKey: "drift",
                    netReturnBps: "20.0000",
                    grossReturnBps: "28.0000",
                    totalCostBps: "8.0000",
                    tradeCount: 3,
                    maxDrawdownBps: "18.0000",
                    excessVsFlatCashBps: "20.0000",
                  })
                : reportId.includes("fast_holdout_week_1_leg_spot_alpha")
                  ? buildBacktestReport({
                      reportId,
                      experimentId: request.experimentId,
                      venueKey: "jupiter",
                      netReturnBps: "-12.0000",
                      grossReturnBps: "3.0000",
                      totalCostBps: "15.0000",
                      tradeCount: 4,
                      maxDrawdownBps: "60.0000",
                      excessVsFlatCashBps: "-12.0000",
                    })
                  : reportId.includes("fast_holdout_week_1_leg_perp_hedge")
                    ? buildBacktestReport({
                        reportId,
                        experimentId: request.experimentId,
                        venueKey: "drift",
                        netReturnBps: "-6.0000",
                        grossReturnBps: "2.0000",
                        totalCostBps: "8.0000",
                        tradeCount: 2,
                        maxDrawdownBps: "24.0000",
                        excessVsFlatCashBps: "-6.0000",
                      })
                    : reportId.includes("slow_selection_week_1_leg_spot_alpha")
                      ? buildBacktestReport({
                          reportId,
                          experimentId: request.experimentId,
                          venueKey: "jupiter",
                          netReturnBps: "42.0000",
                          grossReturnBps: "50.0000",
                          totalCostBps: "8.0000",
                          tradeCount: 4,
                          maxDrawdownBps: "20.0000",
                          excessVsFlatCashBps: "42.0000",
                        })
                      : reportId.includes(
                            "slow_selection_week_1_leg_perp_hedge",
                          )
                        ? buildBacktestReport({
                            reportId,
                            experimentId: request.experimentId,
                            venueKey: "drift",
                            netReturnBps: "8.0000",
                            grossReturnBps: "11.0000",
                            totalCostBps: "3.0000",
                            tradeCount: 2,
                            maxDrawdownBps: "10.0000",
                            excessVsFlatCashBps: "8.0000",
                          })
                        : reportId.includes(
                              "slow_holdout_week_1_leg_spot_alpha",
                            )
                          ? buildBacktestReport({
                              reportId,
                              experimentId: request.experimentId,
                              venueKey: "jupiter",
                              netReturnBps: "30.0000",
                              grossReturnBps: "38.0000",
                              totalCostBps: "8.0000",
                              tradeCount: 3,
                              maxDrawdownBps: "16.0000",
                              excessVsFlatCashBps: "30.0000",
                            })
                          : buildBacktestReport({
                              reportId,
                              experimentId: request.experimentId,
                              venueKey: "drift",
                              netReturnBps: "5.0000",
                              grossReturnBps: "7.0000",
                              totalCostBps: "2.0000",
                              tradeCount: 1,
                              maxDrawdownBps: "8.0000",
                              excessVsFlatCashBps: "5.0000",
                            });

            return {
              status: 201,
              ok: true,
              payload: {
                ok: true,
                source: "stub",
                created: true,
                report,
              },
            };
          },
        },
      );

      expect(result.run.runKind).toBe("backtest");
      expect(result.run.state).toBe("completed");
      expect(result.report.stage).toBe("backtest");
      expect(result.report.status).toBe("pass");
      expect(result.report.studyMatrix?.selectedVariantId).toBe("fast");
      expect(result.report.studyMatrix?.cells).toHaveLength(4);

      const fastSummary = result.report.studyMatrix?.variantSummaries.find(
        (summary) => summary.variantId === "fast",
      );
      expect(fastSummary?.selectionWindowCount).toBe(1);
      expect(fastSummary?.holdoutWindowCount).toBe(1);
      expect(fastSummary?.selectionMetrics?.netReturnBps).toBe("60.0000");
      expect(fastSummary?.holdoutMetrics?.netReturnBps).toBe("-10.0000");

      expect(result.report.checks.map((check) => check.checkId)).toEqual([
        "matrix-generated",
        "holdout-coverage",
        "variant-selection",
      ]);

      const persisted = await getRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenarioId: "desk_sol_composite_1",
      });
      expect(persisted.scenario.latestReportId).toBe(
        "desk_report_desk_sol_composite_1_backtest",
      );
    } finally {
      sqlite.close();
    }
  });

  test("blocks study runs when the scenario is paused", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const executeRuntimeStrategyDeskStudyWorkflow = await getStudyWorkflow();
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: buildStudyScenario({
          state: "paused",
        }) as never,
      });

      await expect(
        executeRuntimeStrategyDeskStudyWorkflow(
          {
            env,
            scenarioId: "desk_sol_composite_1",
            runKind: "backtest",
            requestedBy: "operator_1",
          },
          {
            async runRuntimeBacktest() {
              throw new Error("should-not-run-backtest");
            },
          },
        ),
      ).rejects.toThrow(
        "runtime-strategy-desk-scenario-state-not-ready:desk_sol_composite_1:paused:backtest",
      );
    } finally {
      sqlite.close();
    }
  });

  test("caps propagated evidence buckets to the report schema limit", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const executeRuntimeStrategyDeskStudyWorkflow = await getStudyWorkflow();
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: buildStudyScenario({
          evidence: Array.from({ length: 8 }, (_, index) => ({
            stage:
              index % 4 === 0
                ? "shadow"
                : index % 4 === 1
                  ? "paper"
                  : index % 4 === 2
                    ? "replay"
                    : "bounded_execution",
            summary: `existing-${index}`,
            evidenceRefs: [
              {
                kind: "strategy_desk_report",
                ref: `existing_report_${index}`,
              },
            ],
          })),
        }) as never,
      });

      const result = await executeRuntimeStrategyDeskStudyWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "backtest",
          requestedBy: "operator_1",
        },
        {
          createId(prefix) {
            return prefix;
          },
          now() {
            return "2026-03-17T05:00:00Z";
          },
          async runRuntimeBacktest({ payload }) {
            const request = payload as {
              reportId: string;
              experimentId: string;
            };
            return {
              status: 201,
              ok: true,
              payload: {
                ok: true,
                source: "stub",
                created: true,
                report: buildBacktestReport({
                  reportId: request.reportId,
                  experimentId: request.experimentId,
                  venueKey: "jupiter",
                  netReturnBps: "12.0000",
                  grossReturnBps: "18.0000",
                  totalCostBps: "6.0000",
                  tradeCount: 2,
                  maxDrawdownBps: "5.0000",
                  excessVsFlatCashBps: "12.0000",
                }),
              },
            };
          },
        },
      );

      expect(result.report.evidence).toHaveLength(8);
      expect(
        result.report.evidence.filter((bucket) => bucket.stage === "backtest"),
      ).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });

  test("rejects selected variants whose override leg ids are not backtest-bound", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const baseScenario = buildStudyScenario();
      const baseMatrix = baseScenario.researchMatrix as Record<string, unknown>;
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: {
          ...baseScenario,
          researchMatrix: {
            ...baseMatrix,
            variants: [
              {
                variantId: "broken",
                label: "Broken",
                parameterManifest: {
                  threshold: "broken",
                },
                legOverrides: [
                  {
                    legId: "leg_missing_override",
                    experimentId: "exp_missing_override",
                  },
                ],
              },
            ],
          },
        } as never,
      });

      const executeRuntimeStrategyDeskStudyWorkflow = await getStudyWorkflow();
      await expect(
        executeRuntimeStrategyDeskStudyWorkflow(
          {
            env,
            scenarioId: "desk_sol_composite_1",
            runKind: "backtest",
            requestedBy: "operator_1",
            variantIds: ["broken"],
          },
          {
            async runRuntimeBacktest() {
              throw new Error("should-not-run-backtest");
            },
          },
        ),
      ).rejects.toThrow(
        "runtime-strategy-desk-study-leg-unknown:desk_sol_composite_1:leg_missing_override",
      );
    } finally {
      sqlite.close();
    }
  });

  test("accepts anchored study windows when the runtime backtest report echoes anchored mode", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const baseScenario = buildStudyScenario();
      const baseMatrix = baseScenario.researchMatrix as Record<string, unknown>;
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: {
          ...baseScenario,
          researchMatrix: {
            ...baseMatrix,
            windows: [
              {
                windowId: "anchored_week_1",
                label: "Anchored week 1",
                cohort: "selection",
                windowMode: "anchored",
                trainingWindowObservations: 8,
                testingWindowObservations: 4,
                stepObservations: 4,
                purgeObservations: 1,
              },
            ],
          },
        } as never,
      });

      const executeRuntimeStrategyDeskStudyWorkflow = await getStudyWorkflow();
      const result = await executeRuntimeStrategyDeskStudyWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "backtest",
          requestedBy: "operator_1",
        },
        {
          createId(prefix) {
            return prefix;
          },
          now() {
            return "2026-03-17T05:00:00Z";
          },
          async runRuntimeBacktest({ payload }) {
            const request = payload as {
              reportId: string;
              experimentId: string;
            };
            return {
              status: 201,
              ok: true,
              payload: {
                ok: true,
                source: "stub",
                created: true,
                report: buildBacktestReport({
                  reportId: request.reportId,
                  experimentId: request.experimentId,
                  venueKey: "jupiter",
                  netReturnBps: "12.0000",
                  grossReturnBps: "18.0000",
                  totalCostBps: "6.0000",
                  tradeCount: 2,
                  maxDrawdownBps: "5.0000",
                  excessVsFlatCashBps: "12.0000",
                  windowMode: "anchored",
                }),
              },
            };
          },
        },
      );

      expect(result.report.status).toBe("requires_human_approval");
      expect(result.report.studyMatrix?.cells).toHaveLength(1);
      expect(result.report.studyMatrix?.cells[0]?.status).toBe("completed");
      expect(
        result.report.studyMatrix?.cells[0]?.legResults[0]?.metrics
          .netReturnBps,
      ).toBe("12.0000");
    } finally {
      sqlite.close();
    }
  });
});
