import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

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
      RUNTIME_INTERNAL_STUB_MODE: "1",
      RUNTIME_INTERNAL_SERVICE_TOKEN: "runtime-secret",
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

describe("worker runtime strategy desk routes", () => {
  test("requires admin auth for scenario list", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
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

  test("persists scenarios, lists them, reads detail, and enforces valid state transitions", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const createResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(scenario),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(createResponse.status).toBe(200);
      const createPayload = (await createResponse.json()) as {
        ok: boolean;
        scenario: { scenarioId: string; legs: Array<{ legId: string }> };
      };
      expect(createPayload.ok).toBe(true);
      expect(createPayload.scenario.scenarioId).toBe("desk_sol_composite_1");
      expect(createPayload.scenario.legs).toHaveLength(4);

      const listResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios?ownerUserId=user_1&state=paper_ready&venueKey=jupiter&intentFamily=spot_swap&marketType=spot",
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
        filters: {
          ownerUserId: string | null;
          state: string | null;
          venueKey: string | null;
          intentFamily: string | null;
          marketType: string | null;
        };
        scenarios: Array<{ scenarioId: string; latestReportId?: string }>;
      };
      expect(listPayload.ok).toBe(true);
      expect(listPayload.filters).toEqual({
        scenarioId: null,
        ownerUserId: "user_1",
        strategyKey: null,
        state: "paper_ready",
        venueKey: "jupiter",
        intentFamily: "spot_swap",
        marketType: "spot",
      });
      expect(listPayload.scenarios[0]?.scenarioId).toBe("desk_sol_composite_1");

      const mismatchedTupleResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios?venueKey=jupiter&intentFamily=prediction_order&marketType=prediction",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(mismatchedTupleResponse.status).toBe(200);
      const mismatchedTuplePayload = (await mismatchedTupleResponse.json()) as {
        ok: boolean;
        scenarios: Array<{ scenarioId: string }>;
      };
      expect(mismatchedTuplePayload.ok).toBe(true);
      expect(mismatchedTuplePayload.scenarios).toEqual([]);

      const detailResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(detailResponse.status).toBe(200);
      const detailPayload = (await detailResponse.json()) as {
        ok: boolean;
        scenario: { state: string; legs: Array<{ legId: string }> };
      };
      expect(detailPayload.ok).toBe(true);
      expect(detailPayload.scenario.state).toBe("paper_ready");
      expect(detailPayload.scenario.legs.map((leg) => leg.legId)).toEqual([
        "leg_spot_alpha",
        "leg_perp_hedge",
        "leg_prediction_overlay",
        "leg_flash_rebalance",
      ]);

      const promotedScenario = {
        ...scenario,
        state: "operator_review",
        updatedAt: "2026-03-17T03:10:00Z",
      };
      const promotedResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(promotedScenario),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(promotedResponse.status).toBe(200);

      const regressedScenario = {
        ...promotedScenario,
        state: "draft",
        updatedAt: "2026-03-17T03:11:00Z",
      };
      const regressedResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(regressedScenario),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(regressedResponse.status).toBe(400);
      const regressedPayload = (await regressedResponse.json()) as {
        ok: boolean;
        error: string;
      };
      expect(regressedPayload.ok).toBe(false);
      expect(regressedPayload.error).toContain(
        "runtime-strategy-desk-scenario-transition-invalid",
      );
    } finally {
      sqlite.close();
    }
  });

  test("persists runs and reports separately from scenarios and updates scenario report pointers", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "pass",
      };

      for (const payload of [scenario]) {
        const response = await worker.fetch(
          new Request(
            "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const runResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/runs",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(run),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(runResponse.status).toBe(200);
      const runPayload = (await runResponse.json()) as {
        ok: boolean;
        run: { scenarioRunId: string; scenarioId: string };
      };
      expect(runPayload.ok).toBe(true);
      expect(runPayload.run.scenarioRunId).toBe(
        "desk_run_sol_composite_paper_1",
      );

      const runsListResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/runs?scenarioId=desk_sol_composite_1&runKind=paper",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(runsListResponse.status).toBe(200);
      const runsListPayload = (await runsListResponse.json()) as {
        ok: boolean;
        runs: Array<{
          scenarioRunId: string;
          legRuns: Array<{ legId: string }>;
        }>;
      };
      expect(runsListPayload.ok).toBe(true);
      expect(runsListPayload.runs[0]?.legRuns).toHaveLength(4);

      const reportResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(report),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(reportResponse.status).toBe(200);
      const reportPayload = (await reportResponse.json()) as {
        ok: boolean;
        report: { reportId: string; scenarioRunId: string };
      };
      expect(reportPayload.ok).toBe(true);
      expect(reportPayload.report.reportId).toBe(
        "desk_report_sol_composite_paper_1",
      );

      const reportsListResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports?scenarioRunId=desk_run_sol_composite_paper_1&stage=paper",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(reportsListResponse.status).toBe(200);
      const reportsListPayload = (await reportsListResponse.json()) as {
        ok: boolean;
        reports: Array<{ reportId: string; summary: string }>;
      };
      expect(reportsListPayload.ok).toBe(true);
      expect(reportsListPayload.reports[0]?.reportId).toBe(
        "desk_report_sol_composite_paper_1",
      );

      const detailResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(detailResponse.status).toBe(200);
      const detailPayload = (await detailResponse.json()) as {
        ok: boolean;
        scenario: { latestReportId?: string };
      };
      expect(detailPayload.ok).toBe(true);
      expect(detailPayload.scenario.latestReportId).toBe(
        "desk_report_sol_composite_paper_1",
      );

      const newerReport = {
        ...report,
        reportId: "desk_report_sol_composite_paper_2",
        generatedAt: "2026-03-17T03:09:00Z",
        summary: "Newer paper composite report.",
      };
      const newerReportResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(newerReport),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(newerReportResponse.status).toBe(200);

      const olderBackfillReport = {
        ...report,
        reportId: "desk_report_sol_composite_paper_backfill",
        generatedAt: "2026-03-17T03:08:30Z",
        summary: "Older backfill paper composite report.",
      };
      const olderBackfillResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(olderBackfillReport),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(olderBackfillResponse.status).toBe(200);

      const latestDetailResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(latestDetailResponse.status).toBe(200);
      const latestDetailPayload = (await latestDetailResponse.json()) as {
        ok: boolean;
        scenario: { latestReportId?: string };
      };
      expect(latestDetailPayload.ok).toBe(true);
      expect(latestDetailPayload.scenario.latestReportId).toBe(
        "desk_report_sol_composite_paper_2",
      );

      const scenarioCount = sqlite
        .query(
          "SELECT COUNT(*) AS count FROM strategy_desk_scenarios WHERE scenario_id = ?1",
        )
        .get("desk_sol_composite_1") as { count: number };
      const runCount = sqlite
        .query(
          "SELECT COUNT(*) AS count FROM strategy_desk_runs WHERE scenario_run_id = ?1",
        )
        .get("desk_run_sol_composite_paper_1") as { count: number };
      const reportCount = sqlite
        .query(
          "SELECT COUNT(*) AS count FROM strategy_desk_reports WHERE report_id = ?1",
        )
        .get("desk_report_sol_composite_paper_1") as { count: number };
      expect(scenarioCount.count).toBe(1);
      expect(runCount.count).toBe(1);
      expect(reportCount.count).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  test("prepares, applies, and rolls back bounded execution handoffs", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "pass",
      };

      for (const [path, payload] of [
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          scenario,
        ],
        ["http://localhost/api/admin/ops/runtime/strategy-desk/runs", run],
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          report,
        ],
      ] as const) {
        const response = await worker.fetch(
          new Request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const prepareResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requestedBy: "operator_1",
              targetMode: "limited_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(prepareResponse.status).toBe(200);
      const preparePayload = (await prepareResponse.json()) as {
        ok: boolean;
        handoff: { handoffId: string; status: string; bindings: unknown[] };
        events: Array<{ eventType: string }>;
      };
      expect(preparePayload.ok).toBe(true);
      expect(preparePayload.handoff.status).toBe("draft");
      expect(preparePayload.handoff.bindings.length).toBeGreaterThan(0);
      expect(preparePayload.events.map((event) => event.eventType)).toEqual([
        "prepared",
      ]);

      const handoffId = preparePayload.handoff.handoffId;

      for (const action of ["submit", "approve", "apply"] as const) {
        const response = await worker.fetch(
          new Request(
            `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                action,
                actor: "operator_1",
              }),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const appliedDetailResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}`,
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(appliedDetailResponse.status).toBe(200);
      const appliedDetailPayload = (await appliedDetailResponse.json()) as {
        ok: boolean;
        handoff: { status: string };
        events: Array<{ eventType: string }>;
        executionRecipes: Array<{ recipeId: string }>;
      };
      expect(appliedDetailPayload.ok).toBe(true);
      expect(appliedDetailPayload.handoff.status).toBe("applied");
      expect(
        appliedDetailPayload.events.map((event) => event.eventType),
      ).toEqual(["prepared", "submitted", "approved", "applied"]);
      expect(appliedDetailPayload.executionRecipes.length).toBeGreaterThan(0);

      const promotionCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_lab_promotions")
        .get() as { count: number };
      const recipeCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_desk_execution_recipes")
        .get() as { count: number };
      expect(promotionCount.count).toBe(1);
      expect(recipeCount.count).toBeGreaterThan(0);

      const pauseResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "pause",
              actor: "operator_1",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(pauseResponse.status).toBe(200);
      const pausePayload = (await pauseResponse.json()) as {
        ok: boolean;
        scenario: { state: string };
      };
      expect(pausePayload.ok).toBe(true);
      expect(pausePayload.scenario.state).toBe("paused");

      const demoteResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "demote",
              actor: "operator_1",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(demoteResponse.status).toBe(200);
      const demotePayload = (await demoteResponse.json()) as {
        ok: boolean;
        scenario: { state: string };
        handoff: { status: string };
      };
      expect(demotePayload.ok).toBe(true);
      expect(demotePayload.scenario.state).toBe("paper_ready");
      expect(demotePayload.handoff.status).toBe("archived");
    } finally {
      sqlite.close();
    }
  });

  test("applies bounded execution handoffs once and records the applying operator in promotion artifacts", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "pass",
      };

      for (const [path, payload] of [
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          scenario,
        ],
        ["http://localhost/api/admin/ops/runtime/strategy-desk/runs", run],
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          report,
        ],
      ] as const) {
        const response = await worker.fetch(
          new Request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const prepareResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requestedBy: "requester_1",
              targetMode: "limited_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(prepareResponse.status).toBe(200);
      const preparePayload = (await prepareResponse.json()) as {
        handoff: { handoffId: string };
      };
      const handoffId = preparePayload.handoff.handoffId;

      for (const [action, actor] of [
        ["submit", "requester_1"],
        ["approve", "approver_2"],
        ["apply", "approver_2"],
      ] as const) {
        const response = await worker.fetch(
          new Request(
            `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                action,
                actor,
              }),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const promotionRow = sqlite
        .query(
          "SELECT requested_by AS requestedBy, metadata_json AS metadataJson FROM strategy_lab_promotions LIMIT 1",
        )
        .get() as { requestedBy: string; metadataJson: string };
      const appliedEventRow = sqlite
        .query(
          "SELECT actor FROM strategy_lab_promotion_events WHERE event_type = 'applied' LIMIT 1",
        )
        .get() as { actor: string };

      expect(promotionRow.requestedBy).toBe("approver_2");
      expect(JSON.parse(promotionRow.metadataJson)).toMatchObject({
        handoffRequestedBy: "requester_1",
      });
      expect(appliedEventRow.actor).toBe("approver_2");

      const secondApplyResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "apply",
              actor: "approver_2",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(secondApplyResponse.status).toBe(400);
      await expect(secondApplyResponse.json()).resolves.toMatchObject({
        ok: false,
        error: `runtime-strategy-desk-handoff-already-applied:${handoffId}`,
      });

      const promotionCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_lab_promotions")
        .get() as { count: number };
      expect(promotionCount.count).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  test("blocks apply when the prepared handoff still has blocked checks", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "blocked",
      };

      for (const [path, payload] of [
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          scenario,
        ],
        ["http://localhost/api/admin/ops/runtime/strategy-desk/runs", run],
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          report,
        ],
      ] as const) {
        const response = await worker.fetch(
          new Request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const prepareResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requestedBy: "operator_1",
              targetMode: "limited_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(prepareResponse.status).toBe(200);
      const preparePayload = (await prepareResponse.json()) as {
        handoff: { handoffId: string; checks: Array<{ status: string }> };
      };
      const handoffId = preparePayload.handoff.handoffId;
      expect(
        preparePayload.handoff.checks.some(
          (check) => check.status === "blocked",
        ),
      ).toBe(true);

      for (const action of ["submit", "approve"] as const) {
        const response = await worker.fetch(
          new Request(
            `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                action,
                actor: "operator_1",
              }),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const applyResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "apply",
              actor: "operator_1",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(applyResponse.status).toBe(400);
      const applyPayload = (await applyResponse.json()) as {
        ok: boolean;
        error: string;
      };
      expect(applyPayload.ok).toBe(false);
      expect(applyPayload.error).toContain(
        `runtime-strategy-desk-handoff-checks-blocked:${handoffId}:paper-report-pass`,
      );
    } finally {
      sqlite.close();
    }
  });

  test("blocks apply when a newer active handoff supersedes an older approved handoff", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "pass",
      };

      for (const [path, payload] of [
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          scenario,
        ],
        ["http://localhost/api/admin/ops/runtime/strategy-desk/runs", run],
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          report,
        ],
      ] as const) {
        const response = await worker.fetch(
          new Request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      async function prepareApproveHandoff(requestedBy: string) {
        const prepareResponse = await worker.fetch(
          new Request(
            "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                requestedBy,
                targetMode: "limited_live",
              }),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(prepareResponse.status).toBe(200);
        const preparePayload = (await prepareResponse.json()) as {
          handoff: { handoffId: string };
        };
        const handoffId = preparePayload.handoff.handoffId;

        for (const action of ["submit", "approve"] as const) {
          const response = await worker.fetch(
            new Request(
              `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
              {
                method: "POST",
                headers: {
                  authorization: "Bearer admin-secret",
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  action,
                  actor: requestedBy,
                }),
              },
            ),
            env,
            createExecutionContextStub(),
          );
          expect(response.status).toBe(200);
        }

        return handoffId;
      }

      const staleApprovedHandoffId = await prepareApproveHandoff("operator_1");
      const prepareNewerDraftResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requestedBy: "operator_2",
              targetMode: "limited_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(prepareNewerDraftResponse.status).toBe(200);
      const prepareNewerDraftPayload =
        (await prepareNewerDraftResponse.json()) as {
          handoff: { handoffId: string };
        };
      const activeApprovedHandoffId =
        prepareNewerDraftPayload.handoff.handoffId;

      sqlite
        .query(
          "UPDATE strategy_desk_scenarios SET active_handoff_id = ?1, updated_at = ?2 WHERE scenario_id = ?3",
        )
        .run(
          activeApprovedHandoffId,
          "2026-03-17T03:10:00Z",
          "desk_sol_composite_1",
        );

      const applyResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${staleApprovedHandoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "apply",
              actor: "operator_1",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(applyResponse.status).toBe(400);
      await expect(applyResponse.json()).resolves.toMatchObject({
        ok: false,
        error: `runtime-strategy-desk-handoff-not-active:apply:${activeApprovedHandoffId}`,
      });
    } finally {
      sqlite.close();
    }
  });

  test("demotes approved handoffs without requiring materialized deployment controls", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const run = readFixture("runtime.strategy_desk_run.valid.v1.json");
      const report = {
        ...readFixture("runtime.strategy_desk_report.valid.v1.json"),
        status: "pass",
      };

      for (const [path, payload] of [
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios",
          scenario,
        ],
        ["http://localhost/api/admin/ops/runtime/strategy-desk/runs", run],
        [
          "http://localhost/api/admin/ops/runtime/strategy-desk/reports",
          report,
        ],
      ] as const) {
        const response = await worker.fetch(
          new Request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const prepareResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requestedBy: "operator_1",
              targetMode: "limited_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(prepareResponse.status).toBe(200);
      const preparePayload = (await prepareResponse.json()) as {
        handoff: { handoffId: string };
      };
      const handoffId = preparePayload.handoff.handoffId;

      for (const action of ["submit", "approve"] as const) {
        const response = await worker.fetch(
          new Request(
            `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                action,
                actor: "operator_1",
              }),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
      }

      const demoteResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/strategy-desk/handoffs/${handoffId}/transition`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "demote",
              actor: "operator_1",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(demoteResponse.status).toBe(200);
      const demotePayload = (await demoteResponse.json()) as {
        ok: boolean;
        scenario: { state: string };
        handoff: { status: string };
      };
      expect(demotePayload.ok).toBe(true);
      expect(demotePayload.scenario.state).toBe("paper_ready");
      expect(demotePayload.handoff.status).toBe("archived");

      const promotionCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_lab_promotions")
        .get() as { count: number };
      expect(promotionCount.count).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
