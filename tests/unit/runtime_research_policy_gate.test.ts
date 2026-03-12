import { describe, expect, test } from "bun:test";
import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchPolicyGateArtifact,
  parseRuntimeResearchReproducibilityBundleRecord,
} from "../../src/runtime/contracts/autonomous_runtime.js";
import {
  buildRuntimeResearchPolicyGate,
  buildRuntimeResearchPolicyGateMarkdown,
  parseRuntimeResearchPolicyGateRequest,
  requireRuntimeResearchPolicyGatePass,
} from "../../src/runtime/research/policy_gate.js";
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

function buildCandidateArtifacts(options?: {
  strategyKey?: string;
  title?: string;
  marketType?: "spot" | "perp" | "options";
}) {
  const synthesis = buildRuntimeResearchSynthesis({
    request: {
      brief: briefFixture,
      strategyKey:
        options?.strategyKey ?? "candidate_trend_following_jupiter_sol_usdc",
      title: options?.title ?? "Trend continuation alpha",
      ...(options?.marketType ? { marketType: options.marketType } : {}),
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

function buildBacktestReport(strategyKey: string) {
  return parseRuntimeBacktestReport({
    schemaVersion: "v1",
    reportId: `backtest_${strategyKey}`,
    experimentId: `experiment_${strategyKey}`,
    strategyKey,
    status: "completed",
    generatedAt: "2026-03-11T13:00:00.000Z",
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "64c6a2327fab56cb970acfeb4676720cf0bd6c0c",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feature_cache_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_11_backtest",
        capturedAt: "2026-03-11T12:30:00.000Z",
      },
    ],
    strategySpecDigest: "sha256:strategy",
    config: {
      replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
      venueKey: "jupiter",
      pairSymbol: "SOL/USDC",
      marketType: "spot",
      windowMode: "rolling",
      trainingWindowObservations: 32,
      testingWindowObservations: 8,
      stepObservations: 4,
      purgeObservations: 2,
      baselineStrategies: ["flat_cash", "buy_and_hold"],
    },
    foldReports: [
      {
        foldId: "fold_0",
        foldIndex: 0,
        trainingStartAt: "2026-03-10T00:00:00.000Z",
        trainingEndAt: "2026-03-10T12:00:00.000Z",
        testStartAt: "2026-03-10T12:00:00.000Z",
        testEndAt: "2026-03-11T00:00:00.000Z",
        trainObservationCount: 32,
        purgedObservationCount: 2,
        testObservationCount: 8,
        metrics: {
          observationCount: 8,
          tradeCount: 3,
          grossReturnBps: "42.1500",
          netReturnBps: "39.4000",
          totalCostBps: "2.7500",
          winRateBps: 6667,
          maxDrawdownBps: "8.1000",
        },
        baselineComparisons: [
          {
            baseline: "flat_cash",
            baselineReturnBps: "0.0000",
            excessReturnBps: "39.4000",
          },
          {
            baseline: "buy_and_hold",
            baselineReturnBps: "10.5000",
            excessReturnBps: "28.9000",
          },
        ],
        regimeMetrics: [
          {
            regimeKey: "short_trend",
            regimeValue: "positive",
            observationCount: 8,
            tradeCount: 3,
            netReturnBps: "39.4000",
            winRateBps: 6667,
          },
        ],
      },
    ],
    aggregateMetrics: {
      observationCount: 8,
      tradeCount: 3,
      grossReturnBps: "42.1500",
      netReturnBps: "39.4000",
      totalCostBps: "2.7500",
      winRateBps: 6667,
      maxDrawdownBps: "8.1000",
    },
    aggregateBaselineComparisons: [
      {
        baseline: "flat_cash",
        baselineReturnBps: "0.0000",
        excessReturnBps: "39.4000",
      },
      {
        baseline: "buy_and_hold",
        baselineReturnBps: "10.5000",
        excessReturnBps: "28.9000",
      },
    ],
    aggregateRegimeMetrics: [
      {
        regimeKey: "short_trend",
        regimeValue: "positive",
        observationCount: 8,
        tradeCount: 3,
        netReturnBps: "39.4000",
        winRateBps: 6667,
      },
    ],
    promotionEligible: true,
    blockingReasons: [],
    summary: "Backtest cleared the bounded promotion gate.",
    tags: ["backtest", "paper"],
  });
}

function buildReproducibilityBundle(strategyKey: string) {
  return parseRuntimeResearchReproducibilityBundleRecord({
    schemaVersion: "v1",
    reproducibilityBundleId: `repro_${strategyKey}`,
    experimentId: `experiment_${strategyKey}`,
    strategyKey,
    createdAt: "2026-03-11T13:05:00.000Z",
    updatedAt: "2026-03-11T13:05:00.000Z",
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [{ sourceId: "source_article_momentum" }],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "64c6a2327fab56cb970acfeb4676720cf0bd6c0c",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feature_cache_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_11_backtest",
        capturedAt: "2026-03-11T12:30:00.000Z",
      },
    ],
    manifest: {
      manifestId: `manifest_${strategyKey}`,
      generatedAt: "2026-03-11T13:05:00.000Z",
      codeRevision: {
        vcs: "git",
        repository: "github.com/GuiBibeau/serious-trader-ralph",
        revision: "64c6a2327fab56cb970acfeb4676720cf0bd6c0c",
        treeDirty: false,
      },
      datasetSnapshots: [
        {
          datasetId: "dataset_feature_cache_sol_usdc_market_events",
          snapshotId: "snapshot_2026_03_11_backtest",
          capturedAt: "2026-03-11T12:30:00.000Z",
        },
      ],
      replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
      venueKey: "jupiter",
      pairSymbol: "SOL/USDC",
      marketType: "spot",
      strategySpecDigest: "sha256:strategy",
      featureVersions: [
        {
          recordId: "feature_short_return",
          key: "short_return_bps",
          version: "v1",
          updatedAt: "2026-03-11T12:30:00.000Z",
        },
      ],
      regimeVersions: [
        {
          recordId: "regime_short_trend",
          key: "short_trend",
          version: "v1",
          updatedAt: "2026-03-11T12:30:00.000Z",
        },
      ],
      costModel: {
        modelId: "cost_model_jupiter_sol_usdc_spot",
        calibrationId: "calibration_seed",
        updatedAt: "2026-03-11T12:30:00.000Z",
      },
      backtestConfig: {
        replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
        venueKey: "jupiter",
        pairSymbol: "SOL/USDC",
        marketType: "spot",
        windowMode: "rolling",
        trainingWindowObservations: 32,
        testingWindowObservations: 8,
        stepObservations: 4,
        purgeObservations: 2,
        baselineStrategies: ["flat_cash", "buy_and_hold"],
      },
    },
    expectedResult: {
      reportId: `backtest_${strategyKey}`,
      status: "completed",
      promotionEligible: true,
      aggregateMetrics: {
        observationCount: 8,
        tradeCount: 3,
        grossReturnBps: "42.1500",
        netReturnBps: "39.4000",
        totalCostBps: "2.7500",
        winRateBps: 6667,
        maxDrawdownBps: "8.1000",
      },
      aggregateBaselineComparisons: [
        {
          baseline: "flat_cash",
          baselineReturnBps: "0.0000",
          excessReturnBps: "39.4000",
        },
      ],
      aggregateRegimeMetrics: [
        {
          regimeKey: "short_trend",
          regimeValue: "positive",
          observationCount: 8,
          tradeCount: 3,
          netReturnBps: "39.4000",
          winRateBps: 6667,
        },
      ],
      blockingReasons: [],
    },
    artifacts: [
      {
        artifactId: `repro-manifest-${strategyKey}`,
        kind: "reproducibility-manifest",
        uri: `runtime-reproducibility://${strategyKey}`,
      },
    ],
    linkedEvidenceBundleIds: [`evidence_${strategyKey}_paper`],
    verificationTolerance: {
      maxNetReturnDeltaBps: "0.1000",
      maxTotalCostDeltaBps: "0.1000",
      maxDrawdownDeltaBps: "0.1000",
      maxWinRateDeltaBps: 1,
      maxTradeCountDelta: 0,
    },
    latestVerification: {
      verifiedAt: "2026-03-11T13:10:00.000Z",
      verificationMode: "bounded_tolerance",
      passed: true,
      reportId: `backtest_${strategyKey}`,
      rerunReportId: `backtest_${strategyKey}`,
      netReturnDeltaBps: "0.0000",
      totalCostDeltaBps: "0.0000",
      maxDrawdownDeltaBps: "0.0000",
      winRateDeltaBps: 0,
      tradeCountDelta: 0,
      blockingReasons: [],
    },
    summary: "Reproducibility verification passed for the candidate.",
    tags: ["reproducible"],
  });
}

function buildEvidenceBundle(strategyKey: string, promotionTarget: string) {
  return parseRuntimeResearchEvidenceBundleRecord({
    schemaVersion: "v1",
    evidenceBundleId: `evidence_${strategyKey}_${promotionTarget}`,
    experimentId: `experiment_${strategyKey}`,
    strategyKey,
    status: promotionTarget === "paper" ? "ready_for_review" : "approved",
    promotionTarget,
    createdAt: "2026-03-11T13:15:00.000Z",
    updatedAt: "2026-03-11T13:15:00.000Z",
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [{ sourceId: "source_article_momentum" }],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "64c6a2327fab56cb970acfeb4676720cf0bd6c0c",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feature_cache_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_11_backtest",
        capturedAt: "2026-03-11T12:30:00.000Z",
      },
    ],
    artifacts: [
      {
        artifactId: `artifact_${strategyKey}_${promotionTarget}`,
        kind: "proof-bundle",
        uri: `r2://artifacts/${strategyKey}/${promotionTarget}.md`,
      },
    ],
    summary: `Evidence bundle for ${promotionTarget}.`,
    tags: ["promotion"],
  });
}

describe("runtime research policy gate", () => {
  test("parses a policy-gate request", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const request = parseRuntimeResearchPolicyGateRequest({
      synthesis,
      triage,
      limitedLiveCanaryPassed: true,
    });

    expect(request.synthesis.synthesisId).toBe(synthesis.synthesisId);
    expect(request.triage.triageId).toBe(triage.triageId);
    expect(request.limitedLiveCanaryPassed).toBe(true);
  });

  test("passes shadow and blocks later modes when evidence is missing", () => {
    const { synthesis, triage } = buildCandidateArtifacts();
    const policyGate = buildRuntimeResearchPolicyGate({
      request: {
        synthesis,
        triage,
        assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
      },
    });

    parseRuntimeResearchPolicyGateArtifact(policyGate);
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "shadow")?.status,
    ).toBe("pass");
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "paper")?.status,
    ).toBe("blocked");
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "limited_live")
        ?.status,
    ).toBe("blocked");
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "broad_live")?.status,
    ).toBe("blocked");

    const markdown = buildRuntimeResearchPolicyGateMarkdown(policyGate);
    expect(markdown).toContain("## Shadow");
    expect(markdown).toContain("## Broad Live");
    expect(() =>
      requireRuntimeResearchPolicyGatePass({
        artifact: policyGate,
        targetMode: "paper",
      }),
    ).toThrow("runtime-research-policy-blocked:paper:blocked");
  });

  test("fails closed for unsupported perp venue combinations", () => {
    const { synthesis, triage } = buildCandidateArtifacts({
      strategyKey: "candidate_funding_carry_perp",
      title: "Funding carry alpha",
      marketType: "perp",
    });
    const policyGate = buildRuntimeResearchPolicyGate({
      request: {
        synthesis,
        triage,
        assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
      },
    });

    const shadowGate = policyGate.gates.find(
      (gate) => gate.targetMode === "shadow",
    );
    expect(shadowGate?.status).toBe("blocked");
    expect(
      shadowGate?.checks.find((check) => check.checkId === "venue-capability")
        ?.status,
    ).toBe("blocked");
  });

  test("requires explicit approval before broader live even after automated checks pass", () => {
    const { synthesis, triage } = buildCandidateArtifacts({
      strategyKey: "candidate_breakout_live_ready",
      title: "Breakout rotation alpha",
    });
    const liveCapableSynthesis = {
      ...synthesis,
      strategySpecDraft: {
        ...synthesis.strategySpecDraft,
        supportedModes: ["shadow", "paper", "live"],
        supportedVenues: [
          {
            venueKey: "jupiter",
            onboardingState: "broad_live_ready",
            notes: "Fully onboarded for this test fixture.",
          },
        ],
        promotionPolicy: {
          ...synthesis.strategySpecDraft.promotionPolicy,
          liveLaneAllowlist: ["safe"],
          limitedLiveOnly: true,
        },
      },
    };
    const strategyKey = liveCapableSynthesis.strategySpecDraft.strategyKey;
    const policyGate = buildRuntimeResearchPolicyGate({
      request: {
        synthesis: liveCapableSynthesis,
        triage,
        assetRecords: [buildAssetRecord("SOL"), buildAssetRecord("USDC")],
        backtestReport: buildBacktestReport(strategyKey),
        reproducibilityBundle: buildReproducibilityBundle(strategyKey),
        evidenceBundles: [
          buildEvidenceBundle(strategyKey, "paper"),
          buildEvidenceBundle(strategyKey, "limited_live"),
        ],
        approvals: [
          {
            targetMode: "paper",
            approvedBy: "operator@example.com",
            approvedAt: "2026-03-11T13:20:00.000Z",
          },
          {
            targetMode: "limited_live",
            approvedBy: "operator@example.com",
            approvedAt: "2026-03-11T13:25:00.000Z",
          },
        ],
        limitedLiveCanaryPassed: true,
        limitedLiveSoakPassed: true,
      },
    });

    expect(
      policyGate.gates.find((gate) => gate.targetMode === "paper")?.status,
    ).toBe("pass");
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "limited_live")
        ?.status,
    ).toBe("pass");
    expect(
      policyGate.gates.find((gate) => gate.targetMode === "broad_live")?.status,
    ).toBe("requires_human_approval");

    expect(
      requireRuntimeResearchPolicyGatePass({
        artifact: policyGate,
        targetMode: "limited_live",
      }).status,
    ).toBe("pass");
  });
});
