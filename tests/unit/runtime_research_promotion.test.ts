import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseRuntimeAssetRecord,
  parseRuntimeDeploymentRecord,
} from "../../src/runtime/contracts/autonomous_runtime.js";
import { buildRuntimeResearchPolicyGate } from "../../src/runtime/research/policy_gate.js";
import {
  buildRuntimeResearchPromotion,
  parseRuntimeResearchPromotionRequest,
} from "../../src/runtime/research/promotion.js";
import { buildRuntimeResearchSynthesis } from "../../src/runtime/research/synthesis.js";
import { buildRuntimeResearchCandidateTriage } from "../../src/runtime/research/triage.js";

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

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function buildCandidateArtifacts() {
  const synthesis = buildRuntimeResearchSynthesis({
    request: {
      brief: briefFixture,
      strategyKey: "candidate_trend_following_jupiter_sol_usdc",
      title: "Trend continuation alpha",
    },
  });
  const triage = buildRuntimeResearchCandidateTriage({
    request: {
      synthesis,
    },
  });
  return { synthesis, triage };
}

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

function buildShadowDeployment(strategyKey: string) {
  return parseRuntimeDeploymentRecord({
    schemaVersion: "v1",
    deploymentId: `dep_${strategyKey}_shadow`,
    strategyKey,
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
  });
}

describe("runtime research promotion", () => {
  test("parses a promotion request", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const request = parseRuntimeResearchPromotionRequest({
      subjectKind: "strategy",
      subjectKey: synthesis.strategySpecDraft.strategyKey,
      currentState: "candidate",
      targetState: "draft",
      requestedBy: "codex",
      synthesis,
      triage,
    });

    expect(request.subjectKind).toBe("strategy");
    expect(request.targetState).toBe("draft");
  });

  test("passes the Jupiter Perps integrated promotion gate from the checked-in pilot artifact", () => {
    const request = parseRuntimeResearchPromotionRequest(
      readJson(
        "docs/strategy-lab/pilots/jupiter-perps-readiness/promotion.request.json",
      ),
    );
    const result = buildRuntimeResearchPromotion({ request });

    expect(request.subjectKind).toBe("venue");
    expect(request.subjectKey).toBe("jupiter_perps");
    expect(request.targetState).toBe("integrated");
    expect(result.promotion.status).toBe("pass");
    expect(
      result.promotion.checks.every((check) => check.status === "pass"),
    ).toBe(true);
    expect(result.promotion.evidenceRefs.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(["metadata_draft", "mapping_coverage"]),
    );
  });

  test("keeps the Raydium Perps integrated promotion request blocked until auth mapping exists", () => {
    const request = parseRuntimeResearchPromotionRequest(
      readJson(
        "docs/strategy-lab/pilots/raydium-perps-readiness/promotion.request.json",
      ),
    );
    const result = buildRuntimeResearchPromotion({ request });

    expect(request.subjectKind).toBe("venue");
    expect(request.subjectKey).toBe("raydium_perps");
    expect(request.targetState).toBe("integrated");
    expect(result.promotion.status).toBe("blocked");
    expect(
      result.promotion.checks.find(
        (check) => check.checkId === "candidate-integrated-mappings",
      )?.status,
    ).toBe("blocked");
    expect(result.promotion.evidenceRefs.map((ref) => ref.kind)).toContain(
      "metadata_draft",
    );
  });

  test("keeps the Drift BET integrated promotion request blocked until the maintained developer surface stabilizes", () => {
    const request = parseRuntimeResearchPromotionRequest(
      readJson(
        "docs/strategy-lab/pilots/drift-bet-readiness/promotion.request.json",
      ),
    );
    const result = buildRuntimeResearchPromotion({ request });

    expect(request.subjectKind).toBe("venue");
    expect(request.subjectKey).toBe("drift_bet");
    expect(request.targetState).toBe("integrated");
    expect(result.promotion.status).toBe("blocked");
    expect(
      result.promotion.checks.find(
        (check) => check.checkId === "candidate-integrated-mappings",
      )?.status,
    ).toBe("blocked");
    expect(result.promotion.evidenceRefs.map((ref) => ref.kind)).toContain(
      "metadata_draft",
    );
  });

  test("keeps the Monaco integrated promotion request blocked until the maintained client path is fixed", () => {
    const request = parseRuntimeResearchPromotionRequest(
      readJson(
        "docs/strategy-lab/pilots/monaco-readiness/promotion.request.json",
      ),
    );
    const result = buildRuntimeResearchPromotion({ request });

    expect(request.subjectKind).toBe("venue");
    expect(request.subjectKey).toBe("monaco");
    expect(request.targetState).toBe("integrated");
    expect(result.promotion.status).toBe("blocked");
    expect(
      result.promotion.checks.find(
        (check) => check.checkId === "candidate-integrated-mappings",
      )?.status,
    ).toBe("blocked");
    expect(result.promotion.evidenceRefs.map((ref) => ref.kind)).toContain(
      "metadata_draft",
    );
  });

  test("passes the Mango integrated promotion gate from the checked-in pilot artifact", () => {
    const request = parseRuntimeResearchPromotionRequest(
      readJson(
        "docs/strategy-lab/pilots/mango-v4-readiness/promotion.request.json",
      ),
    );
    const result = buildRuntimeResearchPromotion({ request });

    expect(request.subjectKind).toBe("venue");
    expect(request.subjectKey).toBe("mango");
    expect(request.targetState).toBe("integrated");
    expect(result.promotion.status).toBe("pass");
    expect(
      result.promotion.checks.every((check) => check.status === "pass"),
    ).toBe(true);
    expect(result.promotion.evidenceRefs.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(["metadata_draft", "mapping_coverage"]),
    );
  });

  test("promotes candidate strategies into draft with synthesis and triage evidence", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const result = buildRuntimeResearchPromotion({
      request: {
        subjectKind: "strategy",
        subjectKey: synthesis.strategySpecDraft.strategyKey,
        currentState: "candidate",
        targetState: "draft",
        requestedBy: "codex",
        synthesis,
        triage,
      },
    });

    expect(result.promotion.status).toBe("pass");
    expect(result.promotion.transitionType).toBe("promote");
    expect(
      result.promotion.checks.every((check) => check.status === "pass"),
    ).toBe(true);
  });

  test("blocks draft to shadow when the policy gate and implementation reference are missing", () => {
    const { synthesis } = buildCandidateArtifacts();
    const result = buildRuntimeResearchPromotion({
      request: {
        subjectKind: "strategy",
        subjectKey: synthesis.strategySpecDraft.strategyKey,
        currentState: "draft",
        targetState: "shadow",
        requestedBy: "codex",
      },
    });

    expect(result.promotion.status).toBe("blocked");
    expect(
      result.promotion.checks.some((check) => check.checkId === "policy-gate"),
    ).toBe(true);
    expect(
      result.promotion.checks.some(
        (check) => check.checkId === "implementation-reference",
      ),
    ).toBe(true);
  });

  test("applies draft to shadow when the shadow gate passes and a deployment is provided", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const policyGate = buildRuntimeResearchPolicyGate({
      request: {
        synthesis,
        triage,
        assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
      },
    });
    const deployment = buildShadowDeployment(
      synthesis.strategySpecDraft.strategyKey,
    );

    const result = buildRuntimeResearchPromotion({
      request: {
        subjectKind: "strategy",
        subjectKey: synthesis.strategySpecDraft.strategyKey,
        currentState: "draft",
        targetState: "shadow",
        requestedBy: "codex",
        policyGate,
        implementationReference: {
          kind: "pull_request",
          ref: "#348",
          mergedAt: "2026-03-12T05:00:00.000Z",
        },
        deployment,
        applyTransition: true,
        activateEvaluation: true,
      },
    });

    expect(result.promotion.status).toBe("applied");
    expect(
      result.promotion.actions.some(
        (action) => action.actionType === "upsert_runtime_deployment",
      ),
    ).toBe(true);
    expect(
      result.promotion.actions.some(
        (action) => action.actionType === "evaluate_runtime_deployment",
      ),
    ).toBe(true);
  });

  test("blocks shadow promotion when the deployment record does not match the target mode", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const policyGate = buildRuntimeResearchPolicyGate({
      request: {
        synthesis,
        triage,
        assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
      },
    });
    const deployment = parseRuntimeDeploymentRecord({
      ...buildShadowDeployment(synthesis.strategySpecDraft.strategyKey),
      deploymentId: `dep_${synthesis.strategySpecDraft.strategyKey}_paper`,
      mode: "paper",
      state: "paper",
    });

    const result = buildRuntimeResearchPromotion({
      request: {
        subjectKind: "strategy",
        subjectKey: synthesis.strategySpecDraft.strategyKey,
        currentState: "draft",
        targetState: "shadow",
        requestedBy: "codex",
        policyGate,
        implementationReference: {
          kind: "pull_request",
          ref: "#349",
          mergedAt: "2026-03-12T05:00:00.000Z",
        },
        deployment,
        applyTransition: true,
      },
    });

    expect(result.promotion.status).toBe("blocked");
    expect(
      result.promotion.checks.find(
        (check) => check.checkId === "deployment-record",
      ),
    ).toMatchObject({
      status: "blocked",
      observedValue: "paper:paper",
      thresholdValue: "shadow:shadow",
    });
  });

  test("requires human approval before limited-live readiness for assets", () => {
    const result = buildRuntimeResearchPromotion({
      request: {
        subjectKind: "asset",
        subjectKey: "SOL",
        currentState: "paper_ready",
        targetState: "limited_live_ready",
        requestedBy: "codex",
        evidenceRefs: [
          { kind: "bounded_canary_plan", ref: "canary_plan_sol" },
          { kind: "allowlist_change", ref: "allowlist_sol" },
        ],
      },
    });

    expect(result.promotion.status).toBe("requires_human_approval");
    expect(
      result.promotion.actions.some(
        (action) => action.actionType === "record_allowlist_change",
      ),
    ).toBe(true);
  });
});
