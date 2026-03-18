import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listRuntimeStrategyDeskScenariosWorkflow } from "../../apps/worker/src/runtime_strategy_desk";
import { executeRuntimeStrategyDeskResearchWorkflow } from "../../apps/worker/src/runtime_strategy_desk_research";
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
      RPC_ENDPOINT: "https://rpc.example.test",
      JUPITER_BASE_URL: "https://jupiter.example.test",
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("runtime strategy desk research workflow", () => {
  test("generates ranked composite paper candidates and persists them", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const result = await executeRuntimeStrategyDeskResearchWorkflow({
        env,
        prompt:
          "Research 4 strategies that mix perps, prediction markets, flash liquidity, and orderbooks around SOL inefficiencies",
        requestedBy: "did:privy:operator_1",
        ownerUserId: "user_1",
        runKind: "paper",
        candidateCount: 4,
      });

      expect(result.candidateCount).toBe(4);
      expect(result.rankings).toHaveLength(4);
      expect(result.rankings[0]?.metrics.totalScore).toBeGreaterThan(0);
      expect(result.rankings[0]?.report.stage).toBe("paper");
      expect(
        result.rankings.every((entry) => entry.run.state === "completed"),
      ).toBe(true);
      expect(
        result.rankings.some((entry) =>
          entry.scenario.legs.some((leg) => leg.intentFamily === "perp_order"),
        ),
      ).toBe(true);
      expect(
        result.rankings.some((entry) =>
          entry.scenario.legs.some(
            (leg) => leg.intentFamily === "prediction_order",
          ),
        ),
      ).toBe(true);
      expect(result.markdownSummary).toContain("Top Candidates");

      const stored = await listRuntimeStrategyDeskScenariosWorkflow({
        env,
        ownerUserId: "user_1",
        limit: 10,
      });
      expect(stored.scenarios).toHaveLength(4);
    } finally {
      sqlite.close();
    }
  });

  test("defaults to a 10-candidate paper batch when count is omitted", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const result = await executeRuntimeStrategyDeskResearchWorkflow({
        env,
        prompt:
          "Research different venue-mixing strategies around routing inefficiencies",
        requestedBy: "did:privy:operator_1",
      });

      expect(result.runKind).toBe("paper");
      expect(result.candidateCount).toBe(10);
      expect(result.rankings).toHaveLength(10);
    } finally {
      sqlite.close();
    }
  });
});
