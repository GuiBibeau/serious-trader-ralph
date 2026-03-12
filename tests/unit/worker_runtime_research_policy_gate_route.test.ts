import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import { buildRuntimeResearchSynthesis } from "../../src/runtime/research/synthesis.js";
import { buildRuntimeResearchCandidateTriage } from "../../src/runtime/research/triage.js";
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
      ...overrides,
    },
  });

  return { env, sqlite };
}

const synthesisFixture = buildRuntimeResearchSynthesis({
  request: {
    brief: {
      briefId: "brief_latest_signal",
      generatedAt: "2026-03-11T12:00:00.000Z",
      profile: "custom",
      title: "Latest signal research",
      summary:
        "Reviewed 1 approved source across 1 acquisition request. Most recent coverage: Momentum Alpha in Crypto.",
      findings: [
        "Momentum Alpha in Crypto (published 2026-03-11T08:00:00.000Z): Measure momentum across venue fragments and validate liquidity persistence.",
      ],
      approvedHosts: ["research.example.com"],
      requestCount: 1,
      sourceCount: 1,
      createdCount: 1,
      existingCount: 0,
      citations: [
        {
          sourceId: "source_article_momentum",
          materialDigest: "sha256:source_article_momentum",
          notes: "published 2026-03-11T08:00:00.000Z",
        },
      ],
      sources: [
        {
          sourceId: "source_article_momentum",
          sourceKind: "article",
          title: "Momentum Alpha in Crypto",
          url: "https://research.example.com/posts/momentum-alpha",
          canonicalUrl: "https://research.example.com/posts/momentum-alpha",
          authors: ["Ada Researcher"],
          publishedAt: "2026-03-11T08:00:00.000Z",
          retrievedAt: "2026-03-11T12:00:00.000Z",
          venueKeys: ["jupiter"],
          assetKeys: ["SOL", "USDC"],
          tags: ["signal", "momentum"],
          digest: "sha256:source_article_momentum",
        },
      ],
    },
    strategyKey: "candidate_trend_following_jupiter_sol_usdc",
    title: "Trend continuation alpha",
  },
});

const triageFixture = buildRuntimeResearchCandidateTriage({
  request: {
    synthesis: synthesisFixture,
  },
});

describe("worker runtime research policy gate route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/policy-gate",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              synthesis: synthesisFixture,
              triage: triageFixture,
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

  test("builds a policy gate artifact and blocks unsupported live promotion", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/policy-gate",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              synthesis: synthesisFixture,
              triage: triageFixture,
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.policyGate.policyGateId).toEqual(expect.any(String));
      expect(
        payload.policyGate.gates.find(
          (gate: { targetMode: string }) => gate.targetMode === "shadow",
        )?.status,
      ).toBe("pass");
      expect(
        payload.policyGate.gates.find(
          (gate: { targetMode: string }) => gate.targetMode === "paper",
        )?.status,
      ).toBe("blocked");
      expect(
        payload.policyGate.gates.find(
          (gate: { targetMode: string }) => gate.targetMode === "limited_live",
        )?.status,
      ).toBe("blocked");
      expect(String(payload.markdown)).toContain("## Limited Live");
    } finally {
      sqlite.close();
    }
  });
});
