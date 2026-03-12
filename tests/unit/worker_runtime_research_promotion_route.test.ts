import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import { parseRuntimeAssetRecord } from "../../src/runtime/contracts/autonomous_runtime.js";
import { buildRuntimeResearchPolicyGate } from "../../src/runtime/research/policy_gate.js";
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

const briefFixture = {
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
} as const;

function buildAssetRecord(assetKey: "SOL" | "USDC") {
  const isSol = assetKey === "SOL";
  const nativeId = isSol
    ? "So11111111111111111111111111111111111111112"
    : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  return parseRuntimeAssetRecord({
    schemaVersion: "v1",
    assetKey,
    displayName: isSol ? "Solana" : "USD Coin",
    symbol: assetKey,
    chainKey: "solana-mainnet",
    canonicalId: nativeId,
    assetKind: isSol ? "native" : "stablecoin",
    riskClass: "core",
    listingState: "live",
    decimals: isSol ? 9 : 6,
    aliases: isSol ? ["WSOL"] : ["USD Coin"],
    quoteAssetKeys: ["USDC"],
    venueMappings: [
      {
        venueKey: "jupiter",
        nativeId,
        venueSymbol: assetKey,
        decimals: isSol ? 9 : 6,
        listingState: "live",
        quoteAssetKeys: ["USDC"],
        priceDecimals: 6,
        sizeDecimals: isSol ? 9 : 6,
        minNotionalUsd: "0.01",
      },
    ],
    createdAt: "2026-03-11T12:00:00.000Z",
    updatedAt: "2026-03-11T12:00:00.000Z",
    promotedAt: "2026-03-11T12:00:00.000Z",
    tags: ["asset-registry"],
  });
}

const synthesisFixture = buildRuntimeResearchSynthesis({
  request: {
    brief: briefFixture,
    strategyKey: "candidate_trend_following_jupiter_sol_usdc",
    title: "Trend continuation alpha",
  },
});

const triageFixture = buildRuntimeResearchCandidateTriage({
  request: {
    synthesis: synthesisFixture,
  },
});

const policyGateFixture = buildRuntimeResearchPolicyGate({
  request: {
    synthesis: synthesisFixture,
    triage: triageFixture,
    assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
  },
});

function buildShadowDeployment() {
  return {
    schemaVersion: "v1",
    deploymentId: `dep_${synthesisFixture.strategySpecDraft.strategyKey}_shadow`,
    strategyKey: synthesisFixture.strategySpecDraft.strategyKey,
    sleeveId: "sleeve_alpha",
    ownerUserId: "user_runtime_fixture",
    venueKey: "jupiter",
    pair: {
      symbol: "SOL/USDC",
      baseMint: "So11111111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    mode: "shadow",
    state: "shadow",
    lane: "safe",
    createdAt: "2026-03-11T12:00:00.000Z",
    updatedAt: "2026-03-11T12:00:00.000Z",
    policy: {
      maxNotionalUsd: "25",
      dailyLossLimitUsd: "10",
      maxSlippageBps: 50,
      maxConcurrentRuns: 1,
      rebalanceToleranceBps: 100,
    },
    capital: {
      allocatedUsd: "100",
      reservedUsd: "5",
      availableUsd: "95",
    },
    tags: ["strategy-lab", "shadow"],
  };
}

describe("worker runtime research promotion route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/promotions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "strategy",
              subjectKey: synthesisFixture.strategySpecDraft.strategyKey,
              currentState: "draft",
              targetState: "shadow",
              requestedBy: "codex",
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

  test("applies and persists a strategy promotion workflow", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/promotions",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "strategy",
              subjectKey: synthesisFixture.strategySpecDraft.strategyKey,
              currentState: "draft",
              targetState: "shadow",
              requestedBy: "codex",
              issueNumber: 322,
              pullRequestNumber: 400,
              synthesis: synthesisFixture,
              triage: triageFixture,
              policyGate: policyGateFixture,
              implementationReference: {
                kind: "pull_request",
                ref: "#400",
                mergedAt: "2026-03-12T00:00:00.000Z",
              },
              deployment: buildShadowDeployment(),
              applyTransition: true,
              activateEvaluation: true,
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        promotion: {
          status: "applied",
          currentState: "draft",
          targetState: "shadow",
          transitionType: "promote",
          issueNumber: 322,
          pullRequestNumber: 400,
          deploymentId: `dep_${synthesisFixture.strategySpecDraft.strategyKey}_shadow`,
        },
        event: {
          eventType: "applied",
        },
        markdown: expect.stringContaining("## Actions"),
      });

      const promotionId = String(payload.promotion.promotionId);
      const listingResponse = await worker.fetch(
        new Request(
          `http://localhost/api/admin/ops/runtime/research/promotions?promotionId=${promotionId}`,
          {
            method: "GET",
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(listingResponse.status).toBe(200);
      expect(await listingResponse.json()).toMatchObject({
        ok: true,
        promotions: [
          {
            promotionId,
            status: "applied",
          },
        ],
        events: [
          {
            promotionId,
            eventType: "applied",
          },
        ],
      });

      const promotionCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_lab_promotions")
        .get() as { count: number };
      const eventCount = sqlite
        .query("SELECT COUNT(*) AS count FROM strategy_lab_promotion_events")
        .get() as { count: number };
      expect(promotionCount.count).toBe(1);
      expect(eventCount.count).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  test("hydrates venue and asset readiness evidence into promotions", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      for (const control of [
        {
          subjectKind: "venue",
          subjectKey: "jupiter",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedBy: "codex",
        },
        {
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedBy: "codex",
        },
      ]) {
        await worker.fetch(
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
      }

      const readinessResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "asset",
              subjectKey: "SOL",
              targetState: "limited_live_ready",
              requestedBy: "codex",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      const readinessPayload = (await readinessResponse.json()) as {
        readiness: { readinessId: string };
      };

      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/promotions",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "asset",
              subjectKey: "SOL",
              currentState: "paper_ready",
              targetState: "limited_live_ready",
              requestedBy: "codex",
              readinessArtifactIds: [readinessPayload.readiness.readinessId],
              approvals: [
                {
                  targetMode: "limited_live",
                  approvedBy: "gui",
                  approvedAt: "2026-03-12T00:00:00.000Z",
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
        promotion: {
          status: string;
          evidenceRefs: Array<{ kind: string }>;
          checks: Array<{ checkId: string; status: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.promotion.status).toBe("pass");
      expect(payload.promotion.evidenceRefs.map((ref) => ref.kind)).toContain(
        "bounded_canary_plan",
      );
      expect(
        payload.promotion.checks.find(
          (check) => check.checkId === "human-approval",
        )?.status,
      ).toBe("pass");
    } finally {
      sqlite.close();
    }
  });
});
