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
      RUNTIME_INTERNAL_STUB_MODE: "1",
      ...overrides,
    },
  });

  return { env, sqlite };
}

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs",
        "runtime-contracts",
        "fixtures",
        filename,
      ),
      "utf8",
    ),
  ) as T;
}

describe("worker runtime research curation routes", () => {
  test("require admin auth for curation", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/curation",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              sources: [loadFixture("runtime.research_source.valid.v1.json")],
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

  test("runs curation across registry and backtest surfaces", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/curation",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              sources: [loadFixture("runtime.research_source.valid.v1.json")],
              hypotheses: [
                loadFixture("runtime.research_hypothesis.valid.v1.json"),
              ],
              assets: [loadFixture("runtime.asset_record.valid.v1.json")],
              datasetSnapshots: [
                loadFixture(
                  "runtime.historical_dataset_snapshot.valid.v1.json",
                ),
              ],
              replayCorpora: [
                loadFixture("runtime.replay_corpus.valid.v1.json"),
              ],
              featureDefinitions: [
                loadFixture("runtime.feature_definition.valid.v1.json"),
              ],
              regimeTags: [loadFixture("runtime.regime_tag.valid.v1.json")],
              costModels: [
                loadFixture("runtime.execution_cost_model.valid.v1.json"),
              ],
              costObservations: [
                loadFixture("runtime.execution_cost_observation.valid.v1.json"),
              ],
              experiments: [
                loadFixture("runtime.research_experiment.valid.v1.json"),
              ],
              evidenceBundles: [
                loadFixture("runtime.research_evidence_bundle.valid.v1.json"),
              ],
              backtests: [
                {
                  experimentId: "experiment_trend_following_pilot",
                  replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
                  venueKey: "jupiter",
                  pairSymbol: "SOL/USDC",
                  marketType: "spot",
                  windowMode: "rolling",
                  trainingWindowObservations: 2,
                  testingWindowObservations: 1,
                  stepObservations: 1,
                  purgeObservations: 0,
                  baselineStrategies: ["flat_cash", "buy_and_hold"],
                },
              ],
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        summary: {
          sources: {
            attempted: 1,
            created: 1,
            records: [{ sourceId: expect.any(String) }],
          },
          hypotheses: {
            attempted: 1,
            created: 1,
            records: [{ hypothesisId: expect.any(String) }],
          },
          assets: {
            attempted: 1,
            created: 1,
            records: [{ assetKey: expect.any(String) }],
          },
          backtests: {
            attempted: 1,
            created: 1,
            records: [
              {
                experimentId: "experiment_trend_following_pilot",
                strategyKey: "trend_following",
                config: {
                  replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
                  pairSymbol: "SOL/USDC",
                  marketType: "spot",
                },
              },
            ],
          },
        },
        markdown: expect.stringContaining("Strategy Lab Curation"),
      });
    } finally {
      sqlite.close();
    }
  });

  test("returns a filtered substrate snapshot through the admin route", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/substrate?strategyKey=dca&venueKey=jupiter&assetKey=SOL&pairSymbol=SOL/USDC&marketType=spot",
          {
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
        filters: {
          strategyKey: "dca",
          venueKey: "jupiter",
          assetKey: "SOL",
          pairSymbol: "SOL/USDC",
          marketType: "spot",
        },
        substrate: {
          research: {
            hypotheses: expect.any(Array),
          },
          assets: expect.any(Array),
          datasetSnapshots: expect.any(Array),
          replayCorpora: expect.any(Array),
          featureDefinitions: expect.any(Array),
          regimeTags: expect.any(Array),
          costModels: expect.any(Array),
          costObservations: expect.any(Array),
          backtests: expect.any(Array),
        },
      });
    } finally {
      sqlite.close();
    }
  });
});
