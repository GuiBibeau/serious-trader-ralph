import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const executeRuntimeStrategyDeskResearchWorkflowMock = mock(
  async (input: {
    prompt: string;
    requestedBy: string;
    runKind?: "shadow" | "paper";
    candidateCount?: number;
  }) => ({
    prompt: input.prompt,
    requestedBy: input.requestedBy,
    runKind: input.runKind ?? "paper",
    generatedAt: "2026-03-17T03:06:30Z",
    candidateCount: input.candidateCount ?? 3,
    rankings: [
      {
        blueprintId: "basis_carry_sol",
        blueprintLabel: "Spot/perp basis carry",
        scenario: {
          schemaVersion: "v1",
          scenarioId: "research_01_basis_carry_sol",
          title: "SOL basis carry desk",
          summary: "Mock summary",
          ownerUserId: "user_1",
          strategyKey: "strategy_desk::research::basis_carry_sol",
          thesis: "Mock thesis",
          state: "paper_ready",
          createdAt: "2026-03-17T03:00:00Z",
          updatedAt: "2026-03-17T03:05:00Z",
          legs: [],
          evidence: [],
          implementationReferences: [],
          tags: ["basis"],
        },
        run: {
          schemaVersion: "v1",
          scenarioRunId: "desk_run_mock_1",
          scenarioId: "research_01_basis_carry_sol",
          scenarioState: "paper_ready",
          runKind: input.runKind ?? "paper",
          state: "completed",
          requestedBy: input.requestedBy,
          trigger: {
            kind: "operator",
            source: "strategy_desk_runner",
            observedAt: "2026-03-17T03:06:00Z",
          },
          createdAt: "2026-03-17T03:06:00Z",
          updatedAt: "2026-03-17T03:06:01Z",
          completedAt: "2026-03-17T03:06:30Z",
          legRuns: [],
        },
        report: {
          schemaVersion: "v1",
          reportId: "desk_report_mock_1",
          scenarioId: "research_01_basis_carry_sol",
          scenarioRunId: "desk_run_mock_1",
          stage: input.runKind ?? "paper",
          status: "pass",
          summary: "Mock report",
          generatedAt: "2026-03-17T03:06:30Z",
          legOutcomes: [],
          evidence: [],
          checks: [],
          approvals: [],
        },
        metrics: {
          promptFitScore: 88,
          executionScore: 100,
          diversityScore: 64,
          estimatedGrossEdgeUsd: 12.5,
          estimatedCostUsd: 4.2,
          estimatedNetPnlUsd: 8.3,
          totalScore: 78.4,
        },
        keywordMatches: ["perps", "prediction"],
        rationale: ["Mock rationale"],
      },
    ],
    markdownSummary: "# Strategy Desk Research\n",
  }),
);

mock.module("../../apps/worker/src/runtime_strategy_desk_research", () => ({
  executeRuntimeStrategyDeskResearchWorkflow:
    executeRuntimeStrategyDeskResearchWorkflowMock,
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

describe("worker runtime strategy desk research route", () => {
  test("dispatches prompt-driven research through the workflow", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/research",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              prompt: "Research basis, perps, prediction, and flash ideas",
              requestedBy: "operator_1",
              runKind: "paper",
              candidateCount: 3,
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        candidateCount: number;
        rankings: Array<{ scenario: { scenarioId: string } }>;
        markdownSummary: string;
      };
      expect(payload.ok).toBe(true);
      expect(payload.candidateCount).toBe(3);
      expect(payload.rankings[0]?.scenario.scenarioId).toBe(
        "research_01_basis_carry_sol",
      );
      expect(payload.markdownSummary).toContain("Strategy Desk Research");
      expect(
        executeRuntimeStrategyDeskResearchWorkflowMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Research basis, perps, prediction, and flash ideas",
          requestedBy: "operator_1",
          runKind: "paper",
          candidateCount: 3,
        }),
      );
    } finally {
      sqlite.close();
    }
  });

  test("rejects invalid bodies", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/strategy-desk/research",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              prompt: "",
              requestedBy: "",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(400);
    } finally {
      sqlite.close();
    }
  });
});
