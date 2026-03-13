import { parseRuntimeBacktestRunRequest } from "../../../src/runtime/research/curation.js";
import {
  executionErrorStatus,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
import { json } from "./response";
import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeLedgerSnapshot,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchExperimentRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchReproducibilityBundleRecord,
  parseRuntimeResearchSourceRecord,
  parseRuntimeRunRecord,
  RUNTIME_PROTOCOL_SCHEMA_VERSION,
  type RuntimeAssetListingState,
  type RuntimeAssetRecord,
  type RuntimeBacktestReport,
  type RuntimeDeploymentRecord,
  type RuntimeExecutionCostModelRecord,
  type RuntimeExecutionCostObservationRecord,
  type RuntimeExecutionPlan,
  type RuntimeFeatureDefinitionRecord,
  type RuntimeHistoricalDatasetSnapshotRecord,
  type RuntimeLedgerSnapshot,
  type RuntimeRegimeTagRecord,
  type RuntimeReplayCorpusRecord,
  type RuntimeResearchEvidenceBundleRecord,
  type RuntimeResearchExperimentRecord,
  type RuntimeResearchHypothesisRecord,
  type RuntimeResearchReproducibilityBundleRecord,
  type RuntimeResearchSourceRecord,
  type RuntimeRunRecord,
} from "./runtime_contracts";
import type { Env } from "./types";

const BEARER_RE = /^bearer\s+/i;
const INTERNAL_RUNTIME_PREFIX = "/api/internal/runtime";
const INTERNAL_RUNTIME_HEALTH_PATH = `${INTERNAL_RUNTIME_PREFIX}/health`;
const INTERNAL_RUNTIME_DEPLOYMENTS_PATH = `${INTERNAL_RUNTIME_PREFIX}/deployments`;
const INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX = `${INTERNAL_RUNTIME_PREFIX}/deployments/`;
const INTERNAL_RUNTIME_RUNS_PREFIX = `${INTERNAL_RUNTIME_PREFIX}/runs/`;
const INTERNAL_RUNTIME_EXECUTION_PLANS_PATH = `${INTERNAL_RUNTIME_PREFIX}/execution-plans`;
const INTERNAL_RUNTIME_SCORECARDS_PATH = `${INTERNAL_RUNTIME_PREFIX}/scorecards`;
const INTERNAL_RUNTIME_LEADERBOARDS_PATH = `${INTERNAL_RUNTIME_PREFIX}/leaderboards`;
const INTERNAL_RUNTIME_ALLOCATOR_PATH = `${INTERNAL_RUNTIME_PREFIX}/allocator`;
const INTERNAL_RUNTIME_RESEARCH_PATH = `${INTERNAL_RUNTIME_PREFIX}/research`;
const INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/hypotheses`;
const INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/sources`;
const INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/experiments`;
const INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/evidence-bundles`;
const INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/reproducibility-bundles`;
const INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_RERUN_PATH = `${INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH}/rerun`;
const INTERNAL_RUNTIME_ASSETS_PATH = `${INTERNAL_RUNTIME_PREFIX}/assets`;
const INTERNAL_RUNTIME_ASSETS_PREFIX = `${INTERNAL_RUNTIME_ASSETS_PATH}/`;
const INTERNAL_RUNTIME_DATASETS_PATH = `${INTERNAL_RUNTIME_PREFIX}/datasets`;
const INTERNAL_RUNTIME_BACKTESTS_PATH = `${INTERNAL_RUNTIME_PREFIX}/backtests`;
const INTERNAL_RUNTIME_DATASET_SNAPSHOTS_PATH = `${INTERNAL_RUNTIME_DATASETS_PATH}/snapshots`;
const INTERNAL_RUNTIME_REPLAY_CORPORA_PATH = `${INTERNAL_RUNTIME_DATASETS_PATH}/replay-corpora`;
const INTERNAL_RUNTIME_FEATURES_PATH = `${INTERNAL_RUNTIME_PREFIX}/features`;
const INTERNAL_RUNTIME_FEATURE_DEFINITIONS_PATH = `${INTERNAL_RUNTIME_FEATURES_PATH}/definitions`;
const INTERNAL_RUNTIME_REGIME_TAGS_PATH = `${INTERNAL_RUNTIME_FEATURES_PATH}/regime-tags`;
const INTERNAL_RUNTIME_COST_MODELS_PATH = `${INTERNAL_RUNTIME_PREFIX}/cost-models`;
const INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH = `${INTERNAL_RUNTIME_PREFIX}/cost-model-observations`;
const FIXTURE_TIMESTAMP = "2026-03-07T00:00:00.000Z";
const FIXTURE_BASE_MINT = "So11111111111111111111111111111111111111112";
const FIXTURE_QUOTE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_RUNTIME_SERVICE = "runtime-rs";

export type RuntimeControlAction = "pause" | "resume" | "kill";

export type RuntimeInternalJsonResult = {
  status: number;
  ok: boolean;
  payload: Record<string, unknown>;
};

export type RuntimeAdminSnapshot = {
  ok: boolean;
  source: string;
  integration: {
    stubModeEnabled: boolean;
    runtimeBaseUrl: string | null;
    serviceName: string;
  };
  health: Record<string, unknown> | null;
  deployments: RuntimeDeploymentRecord[];
  leaderboard: Record<string, unknown> | null;
  error: string | null;
};

function parseBearerToken(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!BEARER_RE.test(raw)) return null;
  return raw.replace(BEARER_RE, "").trim() || null;
}

function isRuntimeStubModeEnabled(env: Env): boolean {
  return String(env.RUNTIME_INTERNAL_STUB_MODE ?? "").trim() === "1";
}

function configuredRuntimeServiceName(env: Env): string {
  const configured = String(env.RUNTIME_INTERNAL_SERVICE_NAME ?? "").trim();
  return configured || DEFAULT_RUNTIME_SERVICE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readRuntimeServiceBaseUrl(env: Env): string | null {
  const raw = String(env.RUNTIME_INTERNAL_BASE_URL ?? "").trim();
  return raw || null;
}

function buildRuntimeIntegration(
  env: Env,
): RuntimeAdminSnapshot["integration"] {
  return {
    stubModeEnabled: isRuntimeStubModeEnabled(env),
    runtimeBaseUrl: readRuntimeServiceBaseUrl(env),
    serviceName: configuredRuntimeServiceName(env),
  };
}

function authorizeRuntimeServiceRoute(
  request: Request,
  env: Env,
):
  | { ok: true; service: string }
  | { ok: false; status: number; error: string } {
  const configuredToken = String(
    env.RUNTIME_INTERNAL_SERVICE_TOKEN ?? "",
  ).trim();
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      error: "runtime-service-auth-not-configured",
    };
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token || token !== configuredToken) {
    return {
      ok: false,
      status: 401,
      error: "auth-required",
    };
  }

  return {
    ok: true,
    service: configuredRuntimeServiceName(env),
  };
}

function inferFixtureDeploymentMode(
  deploymentId: string,
): RuntimeDeploymentRecord["mode"] {
  const normalized = deploymentId.trim().toLowerCase();
  if (normalized.includes("live")) return "live";
  if (normalized.includes("paper")) return "paper";
  return "shadow";
}

function resumeStateForDeploymentId(
  deploymentId: string,
): RuntimeDeploymentRecord["state"] {
  const mode = inferFixtureDeploymentMode(deploymentId);
  if (mode === "paper") return "paper";
  if (mode === "live") return "live";
  return "shadow";
}

function createRuntimeDeploymentFixture(
  deploymentId: string,
  state?: RuntimeDeploymentRecord["state"],
  mode?: RuntimeDeploymentRecord["mode"],
): RuntimeDeploymentRecord {
  const fixtureMode = mode ?? inferFixtureDeploymentMode(deploymentId);
  const fixtureState =
    state ?? (fixtureMode === "shadow" ? "shadow" : fixtureMode);
  return parseRuntimeDeploymentRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    deploymentId,
    strategyKey: "dca",
    sleeveId: "sleeve_alpha",
    ownerUserId: "user_runtime_fixture",
    venueKey: "jupiter",
    pair: {
      symbol: "SOL/USDC",
      baseMint: FIXTURE_BASE_MINT,
      quoteMint: FIXTURE_QUOTE_MINT,
    },
    mode: fixtureMode,
    state: fixtureState,
    lane: "safe",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    ...(fixtureState === "paused" ? { pausedAt: FIXTURE_TIMESTAMP } : {}),
    ...(fixtureState === "killed" ? { killedAt: FIXTURE_TIMESTAMP } : {}),
    policy: {
      maxNotionalUsd: "250.00",
      dailyLossLimitUsd: "35.00",
      maxSlippageBps: 50,
      maxConcurrentRuns: 2,
      rebalanceToleranceBps: 100,
    },
    capital: {
      allocatedUsd: "1000.00",
      reservedUsd: "125.00",
      availableUsd: "875.00",
    },
    tags: ["fixture", "internal-route"],
  });
}

function createRuntimeRunFixture(deploymentId: string): RuntimeRunRecord {
  return parseRuntimeRunRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    runId: `run_${deploymentId}`,
    deploymentId,
    runKey: `${deploymentId}:2026-03-07T00:00:00Z`,
    trigger: {
      kind: "operator",
      source: "runtime-internal-fixture",
      observedAt: FIXTURE_TIMESTAMP,
      reason: "fixture-bootstrap",
    },
    state: "planned",
    plannedAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    executionPlanId: `plan_${deploymentId}`,
  });
}

function createRuntimeLedgerFixture(
  deploymentId: string,
): RuntimeLedgerSnapshot {
  return parseRuntimeLedgerSnapshot({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    snapshotId: `ledger_${deploymentId}`,
    deploymentId,
    sleeveId: "sleeve_alpha",
    asOf: FIXTURE_TIMESTAMP,
    balances: [
      {
        mint: FIXTURE_QUOTE_MINT,
        symbol: "USDC",
        decimals: 6,
        freeAtomic: "875000000",
        reservedAtomic: "125000000",
        priceUsd: "1.00",
      },
      {
        mint: FIXTURE_BASE_MINT,
        symbol: "SOL",
        decimals: 9,
        freeAtomic: "1500000000",
        reservedAtomic: "0",
        priceUsd: "142.00",
      },
    ],
    positions: [
      {
        instrumentId: "SOL/USDC",
        side: "long",
        quantityAtomic: "1500000000",
        entryPriceUsd: "140.00",
        markPriceUsd: "142.00",
        unrealizedPnlUsd: "3.00",
      },
    ],
    totals: {
      equityUsd: "1088.00",
      reservedUsd: "125.00",
      availableUsd: "963.00",
      realizedPnlUsd: "10.00",
      unrealizedPnlUsd: "3.00",
    },
  });
}

function createRuntimeScorecardFixture(deploymentId: string) {
  return {
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    deploymentId,
    mode: "shadow",
    state: "shadow",
    generatedAt: FIXTURE_TIMESTAMP,
    scorecard: {
      triggerQuality: {
        totalRuns: 3,
        freshTriggerCount: 3,
        staleFeatureRejectCount: 0,
        freshTriggerRateBps: 10000,
      },
      planQuality: {
        allowedRunCount: 3,
        plannedRunCount: 3,
        planCoverageBps: 10000,
        dryRunCount: 3,
        simulateOnlyCount: 3,
        dryRunPlanRateBps: 10000,
        simulateOnlyPlanRateBps: 10000,
      },
      expectedVsObserved: {
        submitAttemptCount: 3,
        receiptCount: 3,
        reconciliationCount: 3,
        reconciliationPassCount: 3,
        reconciliationManualReviewCount: 0,
        reconciliationFailedCount: 0,
        reconciliationPassRateBps: 10000,
        correctionAppliedCount: 0,
        driftAlertCount: 0,
        completedRunCount: 3,
        failedRunCount: 0,
        manualReviewRunCount: 0,
      },
      pnl: {
        latestEquityUsd: "1088.00",
        latestReservedUsd: "125.00",
        latestAvailableUsd: "963.00",
        realizedPnlUsd: "10.00",
        unrealizedPnlUsd: "3.00",
        totalPnlUsd: "13.00",
        maxDrawdownUsd: "2.00",
      },
      risk: {
        verdictCount: 3,
        allowCount: 3,
        rejectCount: 0,
        pauseCount: 0,
        allowRateBps: 10000,
        rejectRateBps: 0,
        pauseRateBps: 0,
        staleFeatureRejectCount: 0,
        concentrationRejectCount: 0,
        killSwitchPauseCount: 0,
      },
      cost: {
        modelId: "cost_model_jupiter_sol_usdc_spot",
        modelStatus: "active",
        coveredRunCount: 3,
        modelCoverageBps: 10000,
        evaluatedNotionalUsd: "15.00",
        modeledTotalCostUsd: "0.63",
        observedTotalCostUsd: "0.63",
        costDriftUsd: "0.00",
        costDriftBps: 0,
        expectedEndToEndLatencyMs: 5750,
        observedEndToEndLatencyMs: 4800,
        latencyDriftMs: 950,
        reconciliationDriftCount: 0,
      },
      featureCatalog: {
        requiredFeatureCount: 1,
        definedFeatureCount: 1,
        featureDefinitionCoverageBps: 10000,
        requiredRegimeTagCount: 0,
        definedRegimeTagCount: 0,
        regimeTagCoverageBps: 10000,
        maxObservedFeatureAgeMs: 500,
        freshnessSloMs: 20000,
        maxAllowedFeatureDriftBps: 50,
        missingFeatureKeys: [],
        missingRegimeKeys: [],
      },
      oracle: {
        requiredSourceCount: 3,
        healthySourceCount: 3,
        sourceCoverageBps: 10000,
        maxObservedAgeMs: 900,
        freshnessSloMs: 60000,
        maxObservedDivergenceBps: 12,
        maxAllowedDivergenceBps: 150,
        staleRejectCount: 0,
        divergenceRejectCount: 0,
        missingInstrumentCount: 0,
      },
      allocator: {
        decisionCount: 3,
        fullGrantCount: 3,
        constrainedCount: 0,
        zeroGrantCount: 0,
        fullGrantRateBps: 10000,
      },
      research: {
        backtestReportId: "backtest_trend_following_candidate",
        backtestStatus: "completed",
        promotionEligible: true,
        foldCount: 3,
        positiveFoldCount: 3,
        positiveFoldRateBps: 10000,
        baselineComparisonCount: 2,
        baselinePassCount: 2,
        baselineOutperformanceRateBps: 10000,
        significanceConfidenceBps: 9200,
        netReturnBps: "11.1667",
        maxDrawdownBps: "4.5000",
        flatCashExcessReturnBps: "11.1667",
        buyAndHoldExcessReturnBps: "3.6667",
        regimeCount: 2,
        weakRegimeCount: 0,
        regimeStabilityBps: 10000,
        aggregateBaselineComparisons: [
          {
            baseline: "flat_cash",
            baselineReturnBps: "0.0000",
            excessReturnBps: "11.1667",
          },
          {
            baseline: "buy_and_hold",
            baselineReturnBps: "7.5000",
            excessReturnBps: "3.6667",
          },
        ],
        aggregateRegimeMetrics: [
          {
            regimeKey: "short_trend",
            regimeValue: "positive",
            observationCount: 12,
            tradeCount: 4,
            netReturnBps: "8.5000",
            winRateBps: 7500,
          },
        ],
        blockingReasons: [],
      },
    },
    promotionGates: [
      {
        sourceMode: "shadow",
        targetMode: "paper",
        eligible: true,
        status: "pass",
        summary: "Shadow promotion gate evaluation complete.",
        checks: [
          {
            gateId: "shadow-min-runs",
            status: "pass",
            observedValue: "3",
            thresholdValue: "3",
            message: "Shadow mode needs enough completed evidence runs.",
          },
        ],
      },
      {
        sourceMode: "paper",
        targetMode: "live",
        eligible: false,
        status: "not_applicable",
        summary: "Paper-to-live promotion only applies to paper deployments.",
        checks: [
          {
            gateId: "deployment-mode",
            status: "not_applicable",
            observedValue: "shadow",
            thresholdValue: "paper",
            message:
              "Paper-to-live promotion only applies to paper deployments.",
          },
        ],
      },
    ],
    proofArtifactMarkdown: "## Runtime Promotion Readiness",
  };
}

function createRuntimeLeaderboardFixture() {
  return {
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    generatedAt: FIXTURE_TIMESTAMP,
    entryCount: 1,
    entries: [
      {
        candidateId: "trend_following::jupiter::SOL/USDC::spot",
        strategyKey: "trend_following",
        venueKey: "jupiter",
        pairSymbol: "SOL/USDC",
        marketType: "spot",
        reportId: "backtest_trend_following_candidate",
        generatedAt: FIXTURE_TIMESTAMP,
        deploymentId: "deployment_shadow_fixture",
        deploymentMode: "shadow",
        deploymentState: "shadow",
        promotionEligible: true,
        leaderboardScore: 17610,
        positiveFoldRateBps: 10000,
        significanceConfidenceBps: 9200,
        weakRegimeCount: 0,
        netReturnBps: "11.1667",
        flatCashExcessReturnBps: "11.1667",
        buyAndHoldExcessReturnBps: "3.6667",
        promotionGateStatus: "pass",
        blockingReasons: [],
        summary:
          "Trend following candidate cleared significance and robustness gates.",
      },
    ],
  };
}

function createRuntimeAllocatorFixture(deploymentId: string) {
  return {
    ok: true,
    source: "stub",
    deploymentId,
    sleeveId: "sleeve_alpha",
    currentDecision: {
      schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
      decisionId: `alloc_${deploymentId}`,
      runId: `run_${deploymentId}`,
      deploymentId,
      sleeveId: "sleeve_alpha",
      decidedAt: FIXTURE_TIMESTAMP,
      sleeveEquityUsd: "1000.00",
      totalRequestedAllocatedUsd: "1000.00",
      totalGrantedAllocatedUsd: "1000.00",
      totalRequestedReservedUsd: "250.00",
      totalGrantedReservedUsd: "250.00",
      requestedAllocatedUsd: "1000.00",
      grantedAllocatedUsd: "1000.00",
      requestedReservedUsd: "125.00",
      grantedReservedUsd: "125.00",
      grantedAvailableUsd: "875.00",
      priorityRank: 1,
      priorityScore: 136,
      constrained: false,
      peerGrants: [
        {
          deploymentId,
          strategyKey: "dca",
          mode: "shadow",
          state: "shadow",
          priorityRank: 1,
          priorityScore: 136,
          requestedAllocatedUsd: "1000.00",
          grantedAllocatedUsd: "1000.00",
          requestedReservedUsd: "125.00",
          grantedReservedUsd: "125.00",
          constrained: false,
        },
      ],
    },
    decisions: [],
    pressureSummary: {
      byStrategy: [
        {
          subjectKey: "dca",
          limitBps: 10000,
          requestedAllocatedUsd: "1000.00",
          grantedAllocatedUsd: "1000.00",
          requestedReservedUsd: "125.00",
          grantedReservedUsd: "125.00",
          maxAllocatedUsd: "1000.00",
          utilizationBps: 10000,
          constrained: false,
          subjectState: "shared-strategy-budget",
        },
      ],
      byVenue: [
        {
          subjectKey: "jupiter",
          limitBps: 10000,
          requestedAllocatedUsd: "1000.00",
          grantedAllocatedUsd: "1000.00",
          requestedReservedUsd: "125.00",
          grantedReservedUsd: "125.00",
          maxAllocatedUsd: "1000.00",
          utilizationBps: 10000,
          constrained: false,
          subjectState: "broad_live_ready",
        },
      ],
      byAsset: [
        {
          subjectKey: "SOL",
          limitBps: 10000,
          requestedAllocatedUsd: "1000.00",
          grantedAllocatedUsd: "1000.00",
          requestedReservedUsd: "125.00",
          grantedReservedUsd: "125.00",
          maxAllocatedUsd: "1000.00",
          utilizationBps: 10000,
          constrained: false,
          subjectState: "live:core",
        },
      ],
    },
    sleeve: {
      sleeveId: "sleeve_alpha",
      equityUsd: "1000.00",
      reservedUsd: "125.00",
      availableUsd: "875.00",
      quoteMint: FIXTURE_QUOTE_MINT,
      quoteSymbol: "USDC",
      deployments: [
        {
          deploymentId,
          strategyKey: "dca",
          state: "shadow",
          allocatedUsd: "1000.00",
          reservedUsd: "125.00",
          availableUsd: "875.00",
        },
      ],
    },
  };
}

function createRuntimeHealthFixture() {
  return {
    serviceName: DEFAULT_RUNTIME_SERVICE,
    status: "healthy",
    environment: "local",
    protocolVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    marketAdapterStatus: "healthy",
    feedBootstrapSource: "stub",
    feedGateway: {
      status: "healthy",
      maxMarketAgeMs: 2400,
      maxSlotAgeMs: 1700,
      maxSlotGapObserved: 0,
      staleMarketStreams: [],
      staleSlotCommitments: [],
    },
    featureCache: {
      status: "healthy",
      maxFeatureAgeMs: 2600,
      maxSlotAgeMs: 1800,
      maxSlotGapObserved: 0,
      staleFeatureKeys: [],
    },
    oracleRegistry: {
      status: "healthy",
      providerCount: 3,
      mappedInstrumentCount: 6,
      healthyInstrumentCount: 4,
      staleInstrumentCount: 0,
      latestObservedAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
    strategyRegistry: {
      status: "healthy",
      deploymentCount: 1,
      runCount: 0,
      lastError: null,
    },
    researchRegistry: {
      status: "healthy",
      hypothesisCount: 1,
      sourceCount: 1,
      experimentCount: 1,
      evidenceBundleCount: 1,
      latestExperimentCompletedAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
    assetRegistry: {
      status: "healthy",
      assetCount: 2,
      liveAssetCount: 2,
      lastError: null,
    },
    historicalDataLake: {
      status: "healthy",
      datasetSnapshotCount: 2,
      replayCorpusCount: 1,
      latestSnapshotCapturedAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
    featureCatalogRegistry: {
      status: "healthy",
      featureDefinitionCount: 4,
      activeFeatureDefinitionCount: 4,
      regimeTagCount: 4,
      activeRegimeTagCount: 4,
      latestUpdatedAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
    costModelRegistry: {
      status: "healthy",
      modelCount: 3,
      activeModelCount: 3,
      latestModelUpdatedAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
    allocator: {
      status: "healthy",
      decisionCount: 1,
      constrainedDecisionCount: 0,
      latestDecisionAt: FIXTURE_TIMESTAMP,
      lastError: null,
    },
  };
}

function createRuntimeResearchHypothesisFixture(): RuntimeResearchHypothesisRecord {
  return parseRuntimeResearchHypothesisRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    hypothesisId: "hypothesis_signal_trend",
    strategyKey: "trend_following",
    title: "Trend continuation after liquidity shocks",
    thesis:
      "High-quality liquidity shocks should resolve into short continuation bursts.",
    status: "candidate",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [
      {
        sourceId: "source_paper_microstructure",
        locator: "sec-2",
        materialDigest: "sha256:citation",
        notes: "primary evidence",
      },
    ],
    tags: ["candidate"],
  });
}

function createRuntimeResearchSourceFixture(): RuntimeResearchSourceRecord {
  return parseRuntimeResearchSourceRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    sourceId: "source_paper_microstructure",
    sourceKind: "paper",
    title: "Microstructure signals for crypto execution",
    url: "https://example.com/papers/microstructure",
    canonicalUrl: "https://example.com/papers/microstructure",
    authors: ["Ada Researcher"],
    publishedAt: "2026-02-01T00:00:00.000Z",
    retrievedAt: FIXTURE_TIMESTAMP,
    contentDigest: "sha256:paper",
    provenance: {
      acquisitionKind: "paper_feed",
      collectedFrom: "https://example.com/feed/crypto.xml",
      hostname: "example.com",
      publisher: "Example Research",
      firstSeenAt: FIXTURE_TIMESTAMP,
      lastSeenAt: FIXTURE_TIMESTAMP,
    },
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    tags: ["signal"],
  });
}

function createRuntimeResearchExperimentFixture(): RuntimeResearchExperimentRecord {
  return parseRuntimeResearchExperimentRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    experimentId: "experiment_signal_trend_shadow",
    hypothesisId: "hypothesis_signal_trend",
    strategyKey: "trend_following",
    status: "completed",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    completedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [
      {
        sourceId: "source_paper_microstructure",
        locator: "sec-2",
        materialDigest: "sha256:citation",
      },
    ],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
      comparedTo: "main~1",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_features_sol_usdc",
        snapshotId: "snapshot_2026_03_10",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "r2://datasets/features/2026-03-10.parquet",
        contentDigest: "sha256:dataset",
      },
    ],
    artifacts: [
      {
        artifactId: "replay-1",
        kind: "replay-report",
        uri: "r2://artifacts/replay-1.json",
        contentDigest: "sha256:replay-1",
        createdAt: FIXTURE_TIMESTAMP,
      },
    ],
    summary: "Shadow replay passed the initial trigger-quality gate.",
    tags: ["shadow"],
  });
}

function createRuntimeResearchEvidenceBundleFixture(): RuntimeResearchEvidenceBundleRecord {
  return parseRuntimeResearchEvidenceBundleRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    evidenceBundleId: "evidence_signal_trend_shadow",
    experimentId: "experiment_signal_trend_shadow",
    strategyKey: "trend_following",
    status: "ready_for_review",
    promotionTarget: "paper",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [
      {
        sourceId: "source_paper_microstructure",
        locator: "sec-2",
        materialDigest: "sha256:citation",
      },
    ],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
      comparedTo: "main~1",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_features_sol_usdc",
        snapshotId: "snapshot_2026_03_10",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "r2://datasets/features/2026-03-10.parquet",
        contentDigest: "sha256:dataset",
      },
    ],
    artifacts: [
      {
        artifactId: "proof-markdown",
        kind: "proof-bundle",
        uri: "r2://artifacts/proof-markdown.md",
        contentDigest: "sha256:proof-markdown",
        createdAt: FIXTURE_TIMESTAMP,
      },
      {
        artifactId: "shadow-scorecard",
        kind: "scorecard",
        uri: "r2://artifacts/shadow-scorecard.json",
        contentDigest: "sha256:shadow-scorecard",
        createdAt: FIXTURE_TIMESTAMP,
      },
    ],
    summary: "Evidence bundle for shadow-to-paper review.",
    tags: ["promotion"],
  });
}

function createRuntimeResearchReproducibilityBundleFixture(): RuntimeResearchReproducibilityBundleRecord {
  return parseRuntimeResearchReproducibilityBundleRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    reproducibilityBundleId: "repro_signal_trend_shadow",
    experimentId: "experiment_signal_trend_shadow",
    strategyKey: "trend_following",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    sourceCitations: [
      {
        sourceId: "source_paper_microstructure",
        locator: "sec-2",
        materialDigest: "sha256:citation",
      },
    ],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
      comparedTo: "main~1",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_features_sol_usdc",
        snapshotId: "snapshot_2026_03_10",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "r2://datasets/features/2026-03-10.parquet",
        contentDigest: "sha256:dataset",
      },
    ],
    manifest: {
      manifestId: "manifest_signal_trend_shadow",
      generatedAt: FIXTURE_TIMESTAMP,
      codeRevision: {
        vcs: "git",
        repository: "github.com/GuiBibeau/serious-trader-ralph",
        revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
        comparedTo: "main~1",
        treeDirty: false,
      },
      datasetSnapshots: [
        {
          datasetId: "dataset_features_sol_usdc",
          snapshotId: "snapshot_2026_03_10",
          capturedAt: FIXTURE_TIMESTAMP,
          uri: "r2://datasets/features/2026-03-10.parquet",
          contentDigest: "sha256:dataset",
        },
      ],
      replayCorpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
      venueKey: "jupiter",
      pairSymbol: "SOL/USDC",
      marketType: "spot",
      strategySpecDigest: "sha256:strategy",
      featureVersions: [
        {
          recordId: "feature_short_return",
          key: "short_return_bps",
          version: "v1",
          updatedAt: FIXTURE_TIMESTAMP,
        },
      ],
      regimeVersions: [
        {
          recordId: "regime_long_trend",
          key: "long_trend",
          version: "v1",
          updatedAt: FIXTURE_TIMESTAMP,
        },
      ],
      costModel: {
        modelId: "cost_model_jupiter_sol_usdc_spot",
        calibrationId: "calibration_seed",
        updatedAt: FIXTURE_TIMESTAMP,
      },
      backtestConfig: {
        replayCorpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
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
      reportId: "backtest_alloc_dca_report",
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
      aggregateBaselineComparisons: [],
      aggregateRegimeMetrics: [],
      blockingReasons: [],
    },
    artifacts: [
      {
        artifactId: "repro-manifest",
        kind: "reproducibility-manifest",
        uri: "runtime-reproducibility://repro_signal_trend_shadow",
        createdAt: FIXTURE_TIMESTAMP,
      },
      {
        artifactId: "backtest-report",
        kind: "backtest-report",
        uri: "runtime-backtest://backtest_alloc_dca_report",
        createdAt: FIXTURE_TIMESTAMP,
      },
    ],
    linkedEvidenceBundleIds: ["evidence_signal_trend_shadow"],
    verificationTolerance: {
      maxNetReturnDeltaBps: "0.1000",
      maxTotalCostDeltaBps: "0.1000",
      maxDrawdownDeltaBps: "0.1000",
      maxWinRateDeltaBps: 1,
      maxTradeCountDelta: 0,
    },
    latestVerification: {
      verifiedAt: FIXTURE_TIMESTAMP,
      verificationMode: "bounded_tolerance",
      passed: true,
      reportId: "backtest_alloc_dca_report",
      rerunReportId: "backtest_alloc_dca_report",
      netReturnDeltaBps: "0.0000",
      totalCostDeltaBps: "0.0000",
      maxDrawdownDeltaBps: "0.0000",
      winRateDeltaBps: 0,
      tradeCountDelta: 0,
      blockingReasons: [],
    },
    summary: "Reproducibility bundle for the trend-following backtest.",
    tags: ["reproducible"],
  });
}

function createRuntimeResearchRegistryFixture() {
  return {
    hypotheses: [createRuntimeResearchHypothesisFixture()],
    sources: [createRuntimeResearchSourceFixture()],
    experiments: [createRuntimeResearchExperimentFixture()],
    evidenceBundles: [createRuntimeResearchEvidenceBundleFixture()],
    reproducibilityBundles: [
      createRuntimeResearchReproducibilityBundleFixture(),
    ],
  };
}

function createRuntimeBacktestFixture(
  reportId = "backtest_alloc_dca_report",
): RuntimeBacktestReport {
  return parseRuntimeBacktestReport({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    reportId,
    experimentId: "experiment_alloc_dca_backtest",
    strategyKey: "dca",
    status: "completed",
    generatedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter"],
    assetKeys: ["SOL", "USDC"],
    codeRevision: {
      vcs: "git",
      repository: "github.com/GuiBibeau/serious-trader-ralph",
      revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
      treeDirty: false,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feature_cache_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_backtest",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#marketEvents",
        contentDigest: "sha256:feature-cache",
      },
    ],
    strategySpecDigest:
      "sha256:1992048eb2efcd762981bd78d6ae7685c39873c4ccb8189681e2003ca8d84bff",
    config: {
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
    foldReports: [
      {
        foldId: "fold_0",
        foldIndex: 0,
        trainingStartAt: "2026-03-07T00:00:00Z",
        trainingEndAt: "2026-03-07T00:00:10Z",
        testStartAt: "2026-03-07T00:00:10Z",
        testEndAt: "2026-03-07T00:00:15Z",
        trainObservationCount: 2,
        purgedObservationCount: 0,
        testObservationCount: 1,
        metrics: {
          observationCount: 1,
          tradeCount: 1,
          grossReturnBps: "22.5384",
          netReturnBps: "22.5384",
          totalCostBps: "0.0000",
          winRateBps: 10000,
          maxDrawdownBps: "0.0000",
        },
        baselineComparisons: [
          {
            baseline: "flat_cash",
            baselineReturnBps: "0.0000",
            excessReturnBps: "22.5384",
          },
        ],
        regimeMetrics: [
          {
            regimeKey: "short_trend",
            regimeValue: "flat",
            observationCount: 1,
            tradeCount: 1,
            netReturnBps: "22.5384",
            winRateBps: 10000,
          },
        ],
      },
    ],
    aggregateMetrics: {
      observationCount: 1,
      tradeCount: 1,
      grossReturnBps: "22.5384",
      netReturnBps: "22.5384",
      totalCostBps: "0.0000",
      winRateBps: 10000,
      maxDrawdownBps: "0.0000",
    },
    aggregateBaselineComparisons: [
      {
        baseline: "flat_cash",
        baselineReturnBps: "0.0000",
        excessReturnBps: "22.5384",
      },
    ],
    aggregateRegimeMetrics: [
      {
        regimeKey: "short_trend",
        regimeValue: "flat",
        observationCount: 1,
        tradeCount: 1,
        netReturnBps: "22.5384",
        winRateBps: 10000,
      },
    ],
    promotionEligible: true,
    blockingReasons: [],
    summary:
      "Backtest cleared two walk-forward folds for dca with positive aggregate net return.",
    tags: ["backtest", "paper"],
  });
}

function inferStrategyKeyFromExperimentId(experimentId: string): string {
  const normalized = experimentId.trim().toLowerCase();
  if (normalized.includes("trend")) return "trend_following";
  if (normalized.includes("mean")) return "mean_reversion";
  if (normalized.includes("breakout")) return "breakout";
  if (normalized.includes("macro")) return "macro_rotation";
  if (normalized.includes("volatility")) return "volatility_target";
  if (normalized.includes("rebalance")) return "threshold_rebalance";
  if (normalized.includes("twap")) return "twap";
  return "dca";
}

function buildRuntimeBacktestFixtureFromRunRequest(payload: unknown) {
  const request = parseRuntimeBacktestRunRequest(payload);
  const reportId =
    request.reportId ??
    `backtest_${request.experimentId.replace(/[^a-z0-9]+/gi, "_")}_report`;
  const base = createRuntimeBacktestFixture(reportId);
  const [baseAsset = "SOL", quoteAsset = "USDC"] = request.pairSymbol
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parseRuntimeBacktestReport({
    ...base,
    reportId,
    experimentId: request.experimentId,
    strategyKey: inferStrategyKeyFromExperimentId(request.experimentId),
    venueKeys: [request.venueKey],
    assetKeys: [baseAsset, quoteAsset],
    config: {
      ...base.config,
      replayCorpusId: request.replayCorpusId,
      venueKey: request.venueKey,
      pairSymbol: request.pairSymbol,
      marketType: request.marketType,
      windowMode: request.windowMode,
      trainingWindowObservations: request.trainingWindowObservations,
      testingWindowObservations: request.testingWindowObservations,
      stepObservations: request.stepObservations,
      purgeObservations: request.purgeObservations,
      baselineStrategies: request.baselineStrategies,
    },
  });
}

function createRuntimeAssetFixture(
  assetKey = "SOL",
  listingState: RuntimeAssetListingState = "live",
): RuntimeAssetRecord {
  const isSol = assetKey === "SOL";
  const nativeId = isSol
    ? "So11111111111111111111111111111111111111112"
    : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  return parseRuntimeAssetRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    assetKey,
    displayName: isSol ? "Solana" : "USD Coin",
    symbol: assetKey,
    chainKey: "solana-mainnet",
    canonicalId: nativeId,
    assetKind: isSol ? "native" : "stablecoin",
    riskClass: "core",
    listingState,
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
        notes: "Primary live mapping.",
      },
      {
        venueKey: "magicblock",
        nativeId,
        venueSymbol: assetKey,
        decimals: isSol ? 9 : 6,
        listingState: "paper",
        quoteAssetKeys: ["USDC"],
        priceDecimals: 6,
        sizeDecimals: isSol ? 9 : 6,
        minNotionalUsd: "0.01",
        notes: "Paper-only mapping.",
      },
      {
        venueKey: "raydium",
        nativeId,
        venueSymbol: assetKey,
        decimals: isSol ? 9 : 6,
        listingState: "paper",
        quoteAssetKeys: ["USDC"],
        priceDecimals: 6,
        sizeDecimals: isSol ? 9 : 6,
        minNotionalUsd: "0.01",
        notes: "Native paper routing mapping.",
      },
    ],
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    ...(listingState === "live" ? { promotedAt: FIXTURE_TIMESTAMP } : {}),
    ...(listingState === "paused" ? { pausedAt: FIXTURE_TIMESTAMP } : {}),
    ...(listingState === "deprecated"
      ? { deprecatedAt: FIXTURE_TIMESTAMP }
      : {}),
    tags: ["asset-registry", "fixture"],
    notes: "Stubbed asset registry fixture.",
  });
}

function createRuntimeAssetRegistryFixture() {
  return {
    assets: [
      createRuntimeAssetFixture("SOL", "live"),
      createRuntimeAssetFixture("USDC", "live"),
    ],
  };
}

function createRuntimeCostModelFixture(
  venueKey = "jupiter",
): RuntimeExecutionCostModelRecord {
  return parseRuntimeExecutionCostModelRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    modelId: `cost_model_${venueKey}_sol_usdc_spot`,
    venueKey,
    marketType: "spot",
    pairSymbol: "SOL/USDC",
    instrumentId: "SOL/USDC",
    assetKeys: ["SOL", "USDC"],
    modeCoverage:
      venueKey === "jupiter"
        ? ["shadow", "paper", "live"]
        : ["shadow", "paper"],
    status: "active",
    assumptions: {
      feeBps: venueKey === "phoenix" ? 4 : venueKey === "magicblock" ? 6 : 8,
      slippageBps:
        venueKey === "phoenix" ? 10 : venueKey === "magicblock" ? 18 : 22,
      marketImpactBps:
        venueKey === "phoenix" ? 6 : venueKey === "magicblock" ? 8 : 12,
      partialFillRateBps: venueKey === "phoenix" ? 125 : 50,
      partialFillPenaltyBps: venueKey === "phoenix" ? 10 : 12,
    },
    calibration: {
      calibrationId: `calibration_${venueKey}_sol_usdc_spot_seed`,
      methodology: "seed_replay_bootstrap",
      sampleStartAt: "2026-03-07T00:00:00.000Z",
      sampleEndAt: FIXTURE_TIMESTAMP,
      sampleCount:
        venueKey === "phoenix" ? 160 : venueKey === "magicblock" ? 180 : 240,
      confidenceBps:
        venueKey === "phoenix" ? 7900 : venueKey === "magicblock" ? 8100 : 8600,
      referenceNotionalUsd: "25.00",
      tags: ["seed", "bootstrap"],
      notes: "Stubbed execution cost model calibration.",
    },
    driftGuard: {
      maxCostDriftBps:
        venueKey === "phoenix" ? 70 : venueKey === "magicblock" ? 80 : 90,
      maxLatencyDriftMs:
        venueKey === "phoenix" ? 5000 : venueKey === "magicblock" ? 6000 : 8000,
      maxReconciliationDriftUsd:
        venueKey === "phoenix"
          ? "1.00"
          : venueKey === "magicblock"
            ? "1.25"
            : "1.50",
    },
    latencyProfile: {
      expectedQuoteMs:
        venueKey === "phoenix" ? 150 : venueKey === "magicblock" ? 200 : 250,
      expectedSubmitMs:
        venueKey === "phoenix" ? 350 : venueKey === "magicblock" ? 400 : 750,
      expectedSettlementMs:
        venueKey === "phoenix" ? 4000 : venueKey === "magicblock" ? 3000 : 5000,
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
        contentDigest: "sha256:fixture",
      },
      {
        datasetId: "dataset_feed_replay_sol_usdc_slot_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#slotEvents",
        contentDigest: "sha256:fixture",
      },
    ],
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    tags: ["seed", "spot"],
    notes: "Stubbed execution cost model fixture.",
  });
}

function createRuntimeCostModelRegistryFixture() {
  return {
    costModels: [
      createRuntimeCostModelFixture("jupiter"),
      createRuntimeCostModelFixture("magicblock"),
      createRuntimeCostModelFixture("phoenix"),
    ],
  };
}

function createRuntimeCostObservationFixture(
  venueKey = "jupiter",
): RuntimeExecutionCostObservationRecord {
  return parseRuntimeExecutionCostObservationRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    observationId: `costobs_${venueKey}_deployment_shadow_fixture_run_1`,
    modelId: `cost_model_${venueKey}_sol_usdc_spot`,
    deploymentId: "deployment_shadow_fixture",
    runId: "deployment_shadow_fixture_run_1",
    receiptId: `receipt_${venueKey}_deployment_shadow_fixture_run_1`,
    venueKey,
    marketType: "spot",
    pairSymbol: "SOL/USDC",
    assetKeys: ["SOL", "USDC"],
    mode: "paper",
    observedAt: FIXTURE_TIMESTAMP,
    evaluatedNotionalUsd: "25.00",
    modeledTotalCostUsd: venueKey === "phoenix" ? "0.05" : "0.11",
    observedTotalCostUsd: venueKey === "phoenix" ? "0.06" : "0.13",
    costDriftUsd: venueKey === "phoenix" ? "0.01" : "0.02",
    costDriftBps: venueKey === "phoenix" ? 40 : 80,
    expectedEndToEndLatencyMs:
      venueKey === "phoenix" ? 4350 : venueKey === "magicblock" ? 3400 : 5750,
    observedEndToEndLatencyMs:
      venueKey === "phoenix" ? 4525 : venueKey === "magicblock" ? 3625 : 6125,
    latencyDriftMs:
      venueKey === "phoenix" ? 175 : venueKey === "magicblock" ? 225 : 375,
    reconciliationStatus: "passed",
    reconciliationDriftUsd: venueKey === "phoenix" ? "0.01" : "0.02",
    tags: ["cost-observation", "paper"],
    notes: "Stubbed modeled-versus-observed execution cost observation.",
  });
}

function createRuntimeCostObservationRegistryFixture() {
  return {
    costObservations: [
      createRuntimeCostObservationFixture("jupiter"),
      createRuntimeCostObservationFixture("magicblock"),
      createRuntimeCostObservationFixture("phoenix"),
    ],
  };
}

function createRuntimeFeatureDefinitionFixture(
  featureKey = "short_return_bps",
): RuntimeFeatureDefinitionRecord {
  const titleByFeatureKey: Record<string, string> = {
    short_return_bps: "Short-window return",
    long_return_bps: "Long-window return",
    realized_volatility_bps: "Realized volatility",
    spread_bps: "Spread",
  };
  const inputRequirementsByFeatureKey: Record<
    string,
    Array<{ inputKey: string; freshnessMs: number }>
  > = {
    short_return_bps: [{ inputKey: "mid_price_usd", freshnessMs: 20000 }],
    long_return_bps: [{ inputKey: "mid_price_usd", freshnessMs: 20000 }],
    realized_volatility_bps: [
      { inputKey: "mid_price_usd", freshnessMs: 20000 },
    ],
    spread_bps: [
      { inputKey: "best_bid_usd", freshnessMs: 20000 },
      { inputKey: "best_ask_usd", freshnessMs: 20000 },
    ],
  };
  return parseRuntimeFeatureDefinitionRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    featureId: `feature_${featureKey}_v1`,
    featureKey,
    version: "1.0.0",
    title: titleByFeatureKey[featureKey] ?? featureKey,
    summary: "Stubbed runtime feature catalog definition.",
    status: "active",
    marketType: "spot",
    venueKeys: ["jupiter", "magicblock", "phoenix"],
    assetKeys: ["SOL", "USDC"],
    pairSymbols: ["SOL/USDC"],
    inputRequirements: (
      inputRequirementsByFeatureKey[featureKey] ?? [
        { inputKey: "mid_price_usd", freshnessMs: 20000 },
      ]
    ).map((requirement) => ({
      inputKey: requirement.inputKey,
      required: true,
      freshnessMs: requirement.freshnessMs,
      notes: "Required by the seeded feature definition.",
    })),
    derivedFromFeatureKeys: [],
    freshnessSloMs: 20000,
    maxAllowedDriftBps: featureKey === "realized_volatility_bps" ? 75 : 50,
    minCoverageBps: 10000,
    provenance: {
      generatedBy: "strategy-lab::feature-catalog",
      generatedRevision: "seed",
      generatedAt: FIXTURE_TIMESTAMP,
      notes: "Stubbed runtime feature catalog provenance.",
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
        contentDigest: "sha256:fixture",
      },
      {
        datasetId: "dataset_feed_replay_sol_usdc_slot_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#slotEvents",
        contentDigest: "sha256:fixture",
      },
    ],
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    tags: ["seed", "feature-catalog"],
    notes: "Stubbed feature definition fixture.",
  });
}

function createRuntimeRegimeTagFixture(
  regimeKey = "volatility_band",
): RuntimeRegimeTagRecord {
  const dimensionByRegimeKey: Record<
    string,
    RuntimeRegimeTagRecord["dimension"]
  > = {
    short_trend: "trend",
    long_trend: "trend",
    volatility_band: "volatility",
    liquidity_state: "liquidity",
  };
  const sourceFeaturesByRegimeKey: Record<string, string[]> = {
    short_trend: ["short_return_bps"],
    long_trend: ["long_return_bps"],
    volatility_band: ["realized_volatility_bps"],
    liquidity_state: ["spread_bps"],
  };
  return parseRuntimeRegimeTagRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    regimeTagId: `regime_${regimeKey}_v1`,
    regimeKey,
    version: "1.0.0",
    title: regimeKey.replaceAll("_", " "),
    summary: "Stubbed runtime regime tag definition.",
    status: "active",
    dimension: dimensionByRegimeKey[regimeKey] ?? "trend",
    value: "classified",
    marketType: "spot",
    venueKeys: ["jupiter", "magicblock", "phoenix"],
    assetKeys: ["SOL", "USDC"],
    pairSymbols: ["SOL/USDC"],
    sourceFeatureKeys: sourceFeaturesByRegimeKey[regimeKey] ?? [
      "short_return_bps",
    ],
    freshnessSloMs: 20000,
    maxAllowedDriftBps: regimeKey === "volatility_band" ? 75 : 50,
    minConfidenceBps: 8000,
    provenance: {
      generatedBy: "strategy-lab::regime-catalog",
      generatedRevision: "seed",
      generatedAt: FIXTURE_TIMESTAMP,
      notes: "Stubbed runtime regime tag provenance.",
    },
    datasetSnapshots: [
      {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
        contentDigest: "sha256:fixture",
      },
      {
        datasetId: "dataset_feed_replay_sol_usdc_slot_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#slotEvents",
        contentDigest: "sha256:fixture",
      },
    ],
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    tags: ["seed", "feature-catalog"],
    notes: "Stubbed regime tag fixture.",
  });
}

function createRuntimeFeatureCatalogRegistryFixture() {
  return {
    featureDefinitions: [
      createRuntimeFeatureDefinitionFixture("short_return_bps"),
      createRuntimeFeatureDefinitionFixture("long_return_bps"),
      createRuntimeFeatureDefinitionFixture("realized_volatility_bps"),
      createRuntimeFeatureDefinitionFixture("spread_bps"),
    ],
    regimeTags: [
      createRuntimeRegimeTagFixture("short_trend"),
      createRuntimeRegimeTagFixture("long_trend"),
      createRuntimeRegimeTagFixture("volatility_band"),
      createRuntimeRegimeTagFixture("liquidity_state"),
    ],
  };
}

function createRuntimeHistoricalDatasetSnapshotFixture(
  datasetId = "dataset_feed_replay_sol_usdc_market_events",
): RuntimeHistoricalDatasetSnapshotRecord {
  const isSlotDataset = datasetId.includes("slot");
  return parseRuntimeHistoricalDatasetSnapshotRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    datasetId,
    snapshotId: "snapshot_2026_03_07_seed",
    datasetKind: isSlotDataset ? "slot_events" : "market_events",
    normalizationKind: "replay_ready",
    format: "fixture_json",
    retentionClass: "seed",
    capturedAt: FIXTURE_TIMESTAMP,
    coverageStartAt: "2026-03-07T00:00:00Z",
    coverageEndAt: "2026-03-07T00:00:05Z",
    rowCount: isSlotDataset ? 3 : 2,
    venueKeys: [isSlotDataset ? "helius" : "jupiter"],
    assetKeys: ["SOL", "USDC"],
    pairSymbols: ["SOL/USDC"],
    chainKeys: ["solana-mainnet"],
    uri: `repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#${
      isSlotDataset ? "slotEvents" : "marketEvents"
    }`,
    contentDigest: "sha256:fixture",
    provenance: {
      acquisitionKind: "research_fixture",
      collectedFrom:
        "services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
      provider: "repo-fixture",
      collectedAt: FIXTURE_TIMESTAMP,
      generator: "runtime-rs",
      generatorRevision: "feed-replay-seed-v1",
      notes: "Stubbed historical dataset provenance.",
    },
    samplingNotes: "Complete deterministic fixture coverage.",
    compactionNotes: "No compaction applied to the fixture seed.",
    tags: ["seed", "deterministic", "replay"],
    notes: "Stubbed historical dataset snapshot fixture.",
  });
}

function createRuntimeReplayCorpusFixture(): RuntimeReplayCorpusRecord {
  return parseRuntimeReplayCorpusRecord({
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    corpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
    title: "SOL/USDC feed gateway seed replay corpus",
    summary:
      "Deterministic replay corpus seeded from the checked-in runtime feed fixture.",
    replayKind: "feed_gateway_v1",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    venueKeys: ["jupiter", "helius"],
    assetKeys: ["SOL", "USDC"],
    pairSymbols: ["SOL/USDC"],
    chainKeys: ["solana-mainnet"],
    datasetSnapshots: [
      {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
        contentDigest: "sha256:fixture",
      },
      {
        datasetId: "dataset_feed_replay_sol_usdc_slot_events",
        snapshotId: "snapshot_2026_03_07_seed",
        capturedAt: FIXTURE_TIMESTAMP,
        uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#slotEvents",
        contentDigest: "sha256:fixture",
      },
    ],
    fixtureUri:
      "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
    contentDigest: "sha256:fixture",
    deterministicSeed: 100,
    tags: ["seed", "deterministic", "feed-gateway"],
    notes: "Stubbed replay corpus fixture.",
  });
}

function createRuntimeHistoricalDataLakeFixture() {
  return {
    datasetSnapshots: [
      createRuntimeHistoricalDatasetSnapshotFixture(
        "dataset_feed_replay_sol_usdc_market_events",
      ),
      createRuntimeHistoricalDatasetSnapshotFixture(
        "dataset_feed_replay_sol_usdc_slot_events",
      ),
    ],
    replayCorpora: [createRuntimeReplayCorpusFixture()],
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("invalid-json");
  }
}

function runtimeInternalUnavailable(env: Env) {
  return json(
    {
      ok: false,
      error: "runtime-integration-not-configured",
      stubModeEnabled: isRuntimeStubModeEnabled(env),
      runtimeBaseUrl: readRuntimeServiceBaseUrl(env),
    },
    { status: 503 },
  );
}

function buildRuntimeHealthPayload(env: Env, service: string) {
  return {
    ok: true,
    schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
    service: "worker-runtime-bridge",
    authenticatedService: service,
    integration: {
      stubModeEnabled: isRuntimeStubModeEnabled(env),
      runtimeBaseUrl: readRuntimeServiceBaseUrl(env),
    },
    routes: {
      deployments: INTERNAL_RUNTIME_DEPLOYMENTS_PATH,
      runs: `${INTERNAL_RUNTIME_PREFIX}/runs/:deploymentId`,
      positions: `${INTERNAL_RUNTIME_PREFIX}/positions`,
      pnl: `${INTERNAL_RUNTIME_PREFIX}/pnl`,
      scorecards: INTERNAL_RUNTIME_SCORECARDS_PATH,
      leaderboards: INTERNAL_RUNTIME_LEADERBOARDS_PATH,
      allocator: INTERNAL_RUNTIME_ALLOCATOR_PATH,
      research: INTERNAL_RUNTIME_RESEARCH_PATH,
      reproducibilityBundles:
        INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH,
      assets: INTERNAL_RUNTIME_ASSETS_PATH,
      datasets: INTERNAL_RUNTIME_DATASETS_PATH,
      backtests: INTERNAL_RUNTIME_BACKTESTS_PATH,
      features: INTERNAL_RUNTIME_FEATURES_PATH,
      costModels: INTERNAL_RUNTIME_COST_MODELS_PATH,
      costModelObservations: INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH,
      executionPlans: INTERNAL_RUNTIME_EXECUTION_PLANS_PATH,
      health: `${INTERNAL_RUNTIME_PREFIX}/health`,
    },
  };
}

function mapControlActionToState(
  action: RuntimeControlAction,
  deploymentId: string,
): RuntimeDeploymentRecord["state"] {
  if (action === "pause") return "paused";
  if (action === "resume") return resumeStateForDeploymentId(deploymentId);
  return "killed";
}

function controlActionFromPath(pathname: string): {
  deploymentId: string;
  action: RuntimeControlAction;
} | null {
  if (!pathname.startsWith(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX)) return null;
  const suffix = pathname.slice(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX.length);
  const [deploymentId, action] = suffix.split("/");
  if (!deploymentId) return null;
  if (action === "pause" || action === "resume" || action === "kill") {
    return { deploymentId, action };
  }
  return null;
}

function runtimeEvaluateDeploymentIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX)) {
    return null;
  }
  const suffix = pathname.slice(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX.length);
  const evaluateSuffix = "/evaluate";
  if (!suffix.endsWith(evaluateSuffix)) {
    return null;
  }
  const deploymentId = suffix.slice(0, -evaluateSuffix.length);
  return deploymentId && !deploymentId.includes("/") ? deploymentId : null;
}

function runtimeAssetTransitionKeyFromPath(pathname: string): string | null {
  if (!pathname.startsWith(INTERNAL_RUNTIME_ASSETS_PREFIX)) {
    return null;
  }
  const suffix = pathname.slice(INTERNAL_RUNTIME_ASSETS_PREFIX.length);
  const transitionSuffix = "/transition";
  if (!suffix.endsWith(transitionSuffix)) {
    return null;
  }
  const assetKey = suffix.slice(0, -transitionSuffix.length);
  return assetKey && !assetKey.includes("/") ? assetKey : null;
}

async function dispatchRuntimeInternalJson(input: {
  env: Env;
  method: string;
  pathname: string;
  body?: unknown;
}): Promise<RuntimeInternalJsonResult> {
  const headers = new Headers({
    authorization: `Bearer ${String(input.env.RUNTIME_INTERNAL_SERVICE_TOKEN ?? "").trim()}`,
    accept: "application/json",
  });
  let body: string | undefined;
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(input.body);
  }

  let response: Response;
  if (isRuntimeStubModeEnabled(input.env)) {
    const url = new URL(input.pathname, "http://runtime-internal.local");
    const request = new Request(url.toString(), {
      method: input.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    response =
      (await handleRuntimeInternalRoute(request, url, input.env)) ??
      json({ ok: false, error: "runtime-route-not-handled" }, { status: 404 });
  } else {
    const baseUrl = readRuntimeServiceBaseUrl(input.env);
    if (!baseUrl) {
      response = runtimeInternalUnavailable(input.env);
    } else {
      try {
        response = await fetch(new URL(input.pathname, baseUrl), {
          method: input.method,
          headers,
          ...(body !== undefined ? { body } : {}),
        });
      } catch (error) {
        response = json(
          {
            ok: false,
            error: "runtime-integration-request-failed",
            details: {
              reason: error instanceof Error ? error.message : "unknown-error",
            },
          },
          { status: 502 },
        );
      }
    }
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    ok: response.ok,
    payload: isRecord(payload)
      ? payload
      : {
          ok: response.ok,
          error: "invalid-runtime-json-response",
          status: response.status,
        },
  };
}

function parseRuntimeDeploymentList(value: unknown): RuntimeDeploymentRecord[] {
  if (!Array.isArray(value)) return [];
  const deployments: RuntimeDeploymentRecord[] = [];
  for (const entry of value) {
    try {
      deployments.push(parseRuntimeDeploymentRecord(entry));
    } catch {}
  }
  return deployments;
}

function runtimeErrorFromPayload(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  return (
    readStringOrNull(payload.error) ??
    readStringOrNull(payload.message) ??
    fallback
  );
}

function createRuntimeEvaluationFixture(deploymentId: string) {
  const deployment = createRuntimeDeploymentFixture(deploymentId);
  return {
    ok: true,
    source: "stub",
    deployment,
    run: {
      schemaVersion: RUNTIME_PROTOCOL_SCHEMA_VERSION,
      runId: `run_${deploymentId}`,
      deploymentId,
      runKey: `${deploymentId}:${FIXTURE_TIMESTAMP}`,
      trigger: {
        kind: "canary",
        source: "runtime-internal-fixture",
        observedAt: FIXTURE_TIMESTAMP,
        reason: "post_deploy",
      },
      state: "completed",
      plannedAt: FIXTURE_TIMESTAMP,
      submittedAt: FIXTURE_TIMESTAMP,
      completedAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      executionPlanId: `plan_${deploymentId}`,
    },
    coordination: {
      planId: `plan_${deploymentId}`,
      deploymentId,
      runId: `run_${deploymentId}`,
      mode: deployment.mode,
      lane: deployment.lane,
      sliceCount: 1,
      submitRequestId: `submit_${deploymentId}`,
    },
    reconciliation: {
      receiptId: `receipt_${deploymentId}`,
      status: "passed",
      driftUsd: "0.00",
      autoCorrected: false,
    },
  };
}

export async function readRuntimeAdminSnapshot(
  env: Env,
): Promise<RuntimeAdminSnapshot> {
  const integration = buildRuntimeIntegration(env);
  const [healthResult, leaderboardResult] = await Promise.all([
    dispatchRuntimeInternalJson({
      env,
      method: "GET",
      pathname: INTERNAL_RUNTIME_HEALTH_PATH,
    }),
    dispatchRuntimeInternalJson({
      env,
      method: "GET",
      pathname: INTERNAL_RUNTIME_LEADERBOARDS_PATH,
    }),
  ]);
  if (!healthResult.ok) {
    return {
      ok: false,
      source: "worker",
      integration,
      health: null,
      deployments: [],
      leaderboard: null,
      error: runtimeErrorFromPayload(
        healthResult.payload,
        "runtime-health-unavailable",
      ),
    };
  }

  const health = isRecord(healthResult.payload.health)
    ? healthResult.payload.health
    : integration.stubModeEnabled
      ? createRuntimeHealthFixture()
      : null;
  const source =
    readStringOrNull(healthResult.payload.source) ??
    (integration.stubModeEnabled ? "stub" : "runtime-rs");

  const deploymentsResult = await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: INTERNAL_RUNTIME_DEPLOYMENTS_PATH,
  });
  if (!deploymentsResult.ok) {
    return {
      ok: false,
      source,
      integration,
      health,
      deployments: [],
      leaderboard: isRecord(leaderboardResult.payload.leaderboard)
        ? leaderboardResult.payload.leaderboard
        : integration.stubModeEnabled
          ? createRuntimeLeaderboardFixture()
          : null,
      error: runtimeErrorFromPayload(
        deploymentsResult.payload,
        "runtime-deployments-unavailable",
      ),
    };
  }

  return {
    ok: true,
    source: readStringOrNull(deploymentsResult.payload.source) ?? source,
    integration,
    health,
    deployments: parseRuntimeDeploymentList(
      deploymentsResult.payload.deployments,
    ),
    leaderboard: isRecord(leaderboardResult.payload.leaderboard)
      ? leaderboardResult.payload.leaderboard
      : integration.stubModeEnabled
        ? createRuntimeLeaderboardFixture()
        : null,
    error: null,
  };
}

export async function readRuntimeDeployment(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_DEPLOYMENTS_PATH}/${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function upsertRuntimeDeployment(
  env: Env,
  deployment: RuntimeDeploymentRecord,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_DEPLOYMENTS_PATH,
    body: deployment,
  });
}

export async function evaluateRuntimeDeployment(input: {
  env: Env;
  deploymentId: string;
  body?: Record<string, unknown>;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: `${INTERNAL_RUNTIME_DEPLOYMENTS_PATH}/${encodeURIComponent(
      input.deploymentId,
    )}/evaluate`,
    body: input.body ?? {},
  });
}

export async function readRuntimeDeploymentRuns(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_PREFIX}/runs/${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function readRuntimeScorecard(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_SCORECARDS_PATH}?deploymentId=${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function readRuntimeStrategyLeaderboard(
  env: Env,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: INTERNAL_RUNTIME_LEADERBOARDS_PATH,
  });
}

export async function readRuntimeAllocatorSummary(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_ALLOCATOR_PATH}?deploymentId=${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function readRuntimeResearchRegistry(input: {
  env: Env;
  strategyKey?: string;
  venueKey?: string;
  assetKey?: string;
  sourceId?: string;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.strategyKey) search.set("strategyKey", input.strategyKey);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.sourceId) search.set("sourceId", input.sourceId);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_RESEARCH_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_RESEARCH_PATH,
  });
}

export async function writeRuntimeResearchHypothesis(input: {
  env: Env;
  hypothesis: RuntimeResearchHypothesisRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH,
    body: input.hypothesis,
  });
}

export async function writeRuntimeResearchSource(input: {
  env: Env;
  sourceRecord: RuntimeResearchSourceRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH,
    body: input.sourceRecord,
  });
}

export async function writeRuntimeResearchExperiment(input: {
  env: Env;
  experiment: RuntimeResearchExperimentRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH,
    body: input.experiment,
  });
}

export async function writeRuntimeResearchEvidenceBundle(input: {
  env: Env;
  evidenceBundle: RuntimeResearchEvidenceBundleRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH,
    body: input.evidenceBundle,
  });
}

export async function writeRuntimeResearchReproducibilityBundle(input: {
  env: Env;
  reproducibilityBundle: RuntimeResearchReproducibilityBundleRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH,
    body: input.reproducibilityBundle,
  });
}

export async function rerunRuntimeResearchReproducibilityBundle(input: {
  env: Env;
  reproducibilityBundleId: string;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_RERUN_PATH,
    body: {
      reproducibilityBundleId: input.reproducibilityBundleId,
    },
  });
}

export async function readRuntimeAssetRegistry(input: {
  env: Env;
  assetKey?: string;
  venueKey?: string;
  listingState?: RuntimeAssetListingState;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.listingState) search.set("listingState", input.listingState);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_ASSETS_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_ASSETS_PATH,
  });
}

export async function writeRuntimeAsset(input: {
  env: Env;
  asset: RuntimeAssetRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_ASSETS_PATH,
    body: input.asset,
  });
}

export async function transitionRuntimeAssetListingState(input: {
  env: Env;
  assetKey: string;
  listingState: RuntimeAssetListingState;
  changedAt?: string;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: `${INTERNAL_RUNTIME_ASSETS_PATH}/${encodeURIComponent(
      input.assetKey,
    )}/transition`,
    body: {
      listingState: input.listingState,
      ...(input.changedAt ? { changedAt: input.changedAt } : {}),
    },
  });
}

export async function readRuntimeHistoricalDataLake(input: {
  env: Env;
  datasetId?: string;
  snapshotId?: string;
  corpusId?: string;
  venueKey?: string;
  assetKey?: string;
  datasetKind?: string;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.datasetId) search.set("datasetId", input.datasetId);
  if (input.snapshotId) search.set("snapshotId", input.snapshotId);
  if (input.corpusId) search.set("corpusId", input.corpusId);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.datasetKind) search.set("datasetKind", input.datasetKind);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_DATASETS_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_DATASETS_PATH,
  });
}

export async function readRuntimeBacktests(input: {
  env: Env;
  reportId?: string;
  experimentId?: string;
  strategyKey?: string;
  venueKey?: string;
  assetKey?: string;
  marketType?: string;
  status?: string;
  promotionEligible?: boolean;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.reportId) search.set("reportId", input.reportId);
  if (input.experimentId) search.set("experimentId", input.experimentId);
  if (input.strategyKey) search.set("strategyKey", input.strategyKey);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.marketType) search.set("marketType", input.marketType);
  if (input.status) search.set("status", input.status);
  if (typeof input.promotionEligible === "boolean") {
    search.set("promotionEligible", String(input.promotionEligible));
  }
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_BACKTESTS_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_BACKTESTS_PATH,
  });
}

export async function runRuntimeBacktest(input: {
  env: Env;
  payload: RuntimeBacktestReport | Record<string, unknown>;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_BACKTESTS_PATH,
    body: input.payload,
  });
}

export async function writeRuntimeHistoricalDatasetSnapshot(input: {
  env: Env;
  datasetSnapshot: RuntimeHistoricalDatasetSnapshotRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_DATASET_SNAPSHOTS_PATH,
    body: input.datasetSnapshot,
  });
}

export async function writeRuntimeReplayCorpus(input: {
  env: Env;
  replayCorpus: RuntimeReplayCorpusRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_REPLAY_CORPORA_PATH,
    body: input.replayCorpus,
  });
}

export async function readRuntimeFeatureCatalogRegistry(input: {
  env: Env;
  featureId?: string;
  featureKey?: string;
  regimeTagId?: string;
  regimeKey?: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  marketType?: string;
  status?: string;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.featureId) search.set("featureId", input.featureId);
  if (input.featureKey) search.set("featureKey", input.featureKey);
  if (input.regimeTagId) search.set("regimeTagId", input.regimeTagId);
  if (input.regimeKey) search.set("regimeKey", input.regimeKey);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.pairSymbol) search.set("pairSymbol", input.pairSymbol);
  if (input.marketType) search.set("marketType", input.marketType);
  if (input.status) search.set("status", input.status);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_FEATURES_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_FEATURES_PATH,
  });
}

export async function writeRuntimeFeatureDefinition(input: {
  env: Env;
  featureDefinition: RuntimeFeatureDefinitionRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_FEATURE_DEFINITIONS_PATH,
    body: input.featureDefinition,
  });
}

export async function writeRuntimeRegimeTag(input: {
  env: Env;
  regimeTag: RuntimeRegimeTagRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_REGIME_TAGS_PATH,
    body: input.regimeTag,
  });
}

export async function readRuntimeCostModelRegistry(input: {
  env: Env;
  modelId?: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  marketType?: string;
  mode?: string;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.modelId) search.set("modelId", input.modelId);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.pairSymbol) search.set("pairSymbol", input.pairSymbol);
  if (input.marketType) search.set("marketType", input.marketType);
  if (input.mode) search.set("mode", input.mode);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_COST_MODELS_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_COST_MODELS_PATH,
  });
}

export async function writeRuntimeExecutionCostModel(input: {
  env: Env;
  costModel: RuntimeExecutionCostModelRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_COST_MODELS_PATH,
    body: input.costModel,
  });
}

export async function readRuntimeExecutionCostObservations(input: {
  env: Env;
  observationId?: string;
  modelId?: string;
  deploymentId?: string;
  runId?: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  marketType?: string;
  mode?: string;
}): Promise<RuntimeInternalJsonResult> {
  const search = new URLSearchParams();
  if (input.observationId) search.set("observationId", input.observationId);
  if (input.modelId) search.set("modelId", input.modelId);
  if (input.deploymentId) search.set("deploymentId", input.deploymentId);
  if (input.runId) search.set("runId", input.runId);
  if (input.venueKey) search.set("venueKey", input.venueKey);
  if (input.assetKey) search.set("assetKey", input.assetKey);
  if (input.pairSymbol) search.set("pairSymbol", input.pairSymbol);
  if (input.marketType) search.set("marketType", input.marketType);
  if (input.mode) search.set("mode", input.mode);
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "GET",
    pathname: search.size
      ? `${INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH}?${search.toString()}`
      : INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH,
  });
}

export async function writeRuntimeExecutionCostObservation(input: {
  env: Env;
  costObservation: RuntimeExecutionCostObservationRecord;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH,
    body: input.costObservation,
  });
}

export async function readRuntimePositionSnapshot(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_PREFIX}/positions?deploymentId=${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function readRuntimePnlSummary(
  env: Env,
  deploymentId: string,
): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: `${INTERNAL_RUNTIME_PREFIX}/pnl?deploymentId=${encodeURIComponent(
      deploymentId,
    )}`,
  });
}

export async function applyRuntimeDeploymentControl(input: {
  env: Env;
  deploymentId: string;
  action: RuntimeControlAction;
}): Promise<RuntimeInternalJsonResult> {
  return await dispatchRuntimeInternalJson({
    env: input.env,
    method: "POST",
    pathname: `${INTERNAL_RUNTIME_DEPLOYMENTS_PATH}/${encodeURIComponent(
      input.deploymentId,
    )}/${input.action}`,
  });
}

export async function handleRuntimeInternalRoute(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response | null> {
  const isRuntimeRoute =
    url.pathname === INTERNAL_RUNTIME_HEALTH_PATH ||
    url.pathname === INTERNAL_RUNTIME_DEPLOYMENTS_PATH ||
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/positions` ||
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/pnl` ||
    url.pathname === INTERNAL_RUNTIME_SCORECARDS_PATH ||
    url.pathname === INTERNAL_RUNTIME_LEADERBOARDS_PATH ||
    url.pathname === INTERNAL_RUNTIME_ALLOCATOR_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_RERUN_PATH ||
    url.pathname === INTERNAL_RUNTIME_ASSETS_PATH ||
    url.pathname === INTERNAL_RUNTIME_DATASETS_PATH ||
    url.pathname === INTERNAL_RUNTIME_BACKTESTS_PATH ||
    url.pathname === INTERNAL_RUNTIME_DATASET_SNAPSHOTS_PATH ||
    url.pathname === INTERNAL_RUNTIME_REPLAY_CORPORA_PATH ||
    url.pathname === INTERNAL_RUNTIME_FEATURES_PATH ||
    url.pathname === INTERNAL_RUNTIME_FEATURE_DEFINITIONS_PATH ||
    url.pathname === INTERNAL_RUNTIME_REGIME_TAGS_PATH ||
    url.pathname === INTERNAL_RUNTIME_COST_MODELS_PATH ||
    url.pathname === INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH ||
    url.pathname === INTERNAL_RUNTIME_EXECUTION_PLANS_PATH ||
    url.pathname.startsWith(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX) ||
    url.pathname.startsWith(INTERNAL_RUNTIME_ASSETS_PREFIX) ||
    url.pathname.startsWith(INTERNAL_RUNTIME_RUNS_PREFIX);
  if (!isRuntimeRoute) return null;

  const auth = authorizeRuntimeServiceRoute(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_HEALTH_PATH
  ) {
    return json(buildRuntimeHealthPayload(env, auth.service));
  }

  if (!isRuntimeStubModeEnabled(env)) {
    if (
      request.method === "POST" &&
      url.pathname === INTERNAL_RUNTIME_EXECUTION_PLANS_PATH
    ) {
      let plan: RuntimeExecutionPlan;
      try {
        const payload = await readJsonBody(request);
        plan = parseRuntimeExecutionPlan(payload);
      } catch (error) {
        return json(
          {
            ok: false,
            error: "invalid-runtime-execution-plan",
            details: {
              reason: error instanceof Error ? error.message : "unknown-error",
            },
          },
          { status: 400 },
        );
      }
      try {
        const runtimeCanaryDeploymentId =
          String(env.RUNTIME_CANARY_DEPLOYMENT_ID ?? "").trim() ||
          "runtime_canary_live_dca";
        if (plan.deploymentId === runtimeCanaryDeploymentId) {
          const { submitRuntimeCanaryExecutionPlan } = await import(
            "./runtime_canary"
          );
          return json(await submitRuntimeCanaryExecutionPlan({ env, plan }), {
            status: 202,
          });
        }
        const { submitManagedRuntimeExecutionPlan } = await import(
          "./runtime_managed_execution"
        );
        return json(await submitManagedRuntimeExecutionPlan({ env, plan }), {
          status: 202,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "runtime-execution-failed";
        const code = normalizeExecutionErrorCode({
          error: message,
          fallback: "submission-failed",
        });
        return json(
          {
            ok: false,
            error: code,
            details: {
              reason: message,
            },
          },
          { status: executionErrorStatus(code) },
        );
      }
    }
    return runtimeInternalUnavailable(env);
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        strategyKey: url.searchParams.get("strategyKey"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        sourceId: url.searchParams.get("sourceId"),
      },
      registry: createRuntimeResearchRegistryFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_ASSETS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        assetKey: url.searchParams.get("assetKey"),
        venueKey: url.searchParams.get("venueKey"),
        listingState: url.searchParams.get("listingState"),
      },
      registry: createRuntimeAssetRegistryFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_DATASETS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        datasetId: url.searchParams.get("datasetId"),
        snapshotId: url.searchParams.get("snapshotId"),
        corpusId: url.searchParams.get("corpusId"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        datasetKind: url.searchParams.get("datasetKind"),
      },
      registry: createRuntimeHistoricalDataLakeFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_BACKTESTS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        reportId: url.searchParams.get("reportId"),
        experimentId: url.searchParams.get("experimentId"),
        strategyKey: url.searchParams.get("strategyKey"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        marketType: url.searchParams.get("marketType"),
        status: url.searchParams.get("status"),
        promotionEligible: url.searchParams.get("promotionEligible"),
      },
      reports: [createRuntimeBacktestFixture()],
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_FEATURES_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        featureId: url.searchParams.get("featureId"),
        featureKey: url.searchParams.get("featureKey"),
        regimeTagId: url.searchParams.get("regimeTagId"),
        regimeKey: url.searchParams.get("regimeKey"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        pairSymbol: url.searchParams.get("pairSymbol"),
        marketType: url.searchParams.get("marketType"),
        status: url.searchParams.get("status"),
      },
      registry: createRuntimeFeatureCatalogRegistryFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_COST_MODELS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        modelId: url.searchParams.get("modelId"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        pairSymbol: url.searchParams.get("pairSymbol"),
        marketType: url.searchParams.get("marketType"),
        mode: url.searchParams.get("mode"),
      },
      registry: createRuntimeCostModelRegistryFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      filters: {
        observationId: url.searchParams.get("observationId"),
        modelId: url.searchParams.get("modelId"),
        deploymentId: url.searchParams.get("deploymentId"),
        runId: url.searchParams.get("runId"),
        venueKey: url.searchParams.get("venueKey"),
        assetKey: url.searchParams.get("assetKey"),
        pairSymbol: url.searchParams.get("pairSymbol"),
        marketType: url.searchParams.get("marketType"),
        mode: url.searchParams.get("mode"),
      },
      registry: createRuntimeCostObservationRegistryFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_DEPLOYMENTS_PATH
  ) {
    const deploymentId =
      url.searchParams.get("deploymentId") ?? "deployment_shadow_fixture";
    return json({
      ok: true,
      source: "stub",
      deployments: [createRuntimeDeploymentFixture(deploymentId)],
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_DEPLOYMENTS_PATH
  ) {
    let deployment: RuntimeDeploymentRecord;
    try {
      const payload = await readJsonBody(request);
      deployment = parseRuntimeDeploymentRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-deployment",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        status: "accepted",
        source: "stub",
        deployment,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "GET" &&
    url.pathname.startsWith(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX)
  ) {
    const suffix = url.pathname.slice(
      INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX.length,
    );
    if (suffix && !suffix.includes("/")) {
      return json({
        ok: true,
        source: "stub",
        deployment: createRuntimeDeploymentFixture(suffix),
      });
    }
  }

  if (request.method === "POST") {
    const evaluateDeploymentId = runtimeEvaluateDeploymentIdFromPath(
      url.pathname,
    );
    if (evaluateDeploymentId) {
      return json(createRuntimeEvaluationFixture(evaluateDeploymentId));
    }

    const control = controlActionFromPath(url.pathname);
    if (control) {
      return json({
        ok: true,
        status: "accepted",
        source: "stub",
        action: control.action,
        deployment: createRuntimeDeploymentFixture(
          control.deploymentId,
          mapControlActionToState(control.action, control.deploymentId),
        ),
      });
    }
  }

  if (
    request.method === "GET" &&
    url.pathname.startsWith(INTERNAL_RUNTIME_RUNS_PREFIX)
  ) {
    const deploymentId = url.pathname.slice(
      INTERNAL_RUNTIME_RUNS_PREFIX.length,
    );
    if (!deploymentId) {
      return json({ ok: false, error: "not-found" }, { status: 404 });
    }
    return json({
      ok: true,
      source: "stub",
      deploymentId,
      runs: [createRuntimeRunFixture(deploymentId)],
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/positions`
  ) {
    const deploymentId =
      url.searchParams.get("deploymentId") ?? "deployment_fixture";
    return json({
      ok: true,
      source: "stub",
      deploymentId,
      snapshot: createRuntimeLedgerFixture(deploymentId),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/pnl`
  ) {
    const deploymentId =
      url.searchParams.get("deploymentId") ?? "deployment_fixture";
    const snapshot = createRuntimeLedgerFixture(deploymentId);
    return json({
      ok: true,
      source: "stub",
      deploymentId,
      asOf: snapshot.asOf,
      totals: snapshot.totals,
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_SCORECARDS_PATH
  ) {
    const deploymentId =
      url.searchParams.get("deploymentId") ?? "deployment_fixture";
    return json({
      ok: true,
      source: "stub",
      deploymentId,
      report: createRuntimeScorecardFixture(deploymentId),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_LEADERBOARDS_PATH
  ) {
    return json({
      ok: true,
      source: "stub",
      leaderboard: createRuntimeLeaderboardFixture(),
    });
  }

  if (
    request.method === "GET" &&
    url.pathname === INTERNAL_RUNTIME_ALLOCATOR_PATH
  ) {
    const deploymentId =
      url.searchParams.get("deploymentId") ?? "deployment_fixture";
    return json(createRuntimeAllocatorFixture(deploymentId));
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH
  ) {
    let hypothesis: RuntimeResearchHypothesisRecord;
    try {
      const payload = await readJsonBody(request);
      hypothesis = parseRuntimeResearchHypothesisRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-research-hypothesis",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        hypothesis,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH
  ) {
    let sourceRecord: RuntimeResearchSourceRecord;
    try {
      const payload = await readJsonBody(request);
      sourceRecord = parseRuntimeResearchSourceRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-research-source",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        sourceRecord,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH
  ) {
    let experiment: RuntimeResearchExperimentRecord;
    try {
      const payload = await readJsonBody(request);
      experiment = parseRuntimeResearchExperimentRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-research-experiment",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        experiment,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH
  ) {
    let evidenceBundle: RuntimeResearchEvidenceBundleRecord;
    try {
      const payload = await readJsonBody(request);
      evidenceBundle = parseRuntimeResearchEvidenceBundleRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-research-evidence-bundle",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        evidenceBundle,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_BUNDLES_PATH
  ) {
    let reproducibilityBundle: RuntimeResearchReproducibilityBundleRecord;
    try {
      const payload = await readJsonBody(request);
      reproducibilityBundle =
        parseRuntimeResearchReproducibilityBundleRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-research-reproducibility-bundle",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        reproducibilityBundle,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_RESEARCH_REPRODUCIBILITY_RERUN_PATH
  ) {
    return json(
      {
        ok: true,
        source: "stub",
        created: false,
        reproducibilityBundle:
          createRuntimeResearchReproducibilityBundleFixture(),
        rerunReport: createRuntimeBacktestFixture(),
        verification:
          createRuntimeResearchReproducibilityBundleFixture()
            .latestVerification,
      },
      { status: 200 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_ASSETS_PATH
  ) {
    let asset: RuntimeAssetRecord;
    try {
      const payload = await readJsonBody(request);
      asset = parseRuntimeAssetRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-asset",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        asset,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_DATASET_SNAPSHOTS_PATH
  ) {
    let datasetSnapshot: RuntimeHistoricalDatasetSnapshotRecord;
    try {
      const payload = await readJsonBody(request);
      datasetSnapshot = parseRuntimeHistoricalDatasetSnapshotRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-historical-dataset-snapshot",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        datasetSnapshot,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_REPLAY_CORPORA_PATH
  ) {
    let replayCorpus: RuntimeReplayCorpusRecord;
    try {
      const payload = await readJsonBody(request);
      replayCorpus = parseRuntimeReplayCorpusRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-replay-corpus",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        replayCorpus,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_BACKTESTS_PATH
  ) {
    let report: RuntimeBacktestReport;
    try {
      const payload = await readJsonBody(request);
      try {
        report = parseRuntimeBacktestReport(payload);
      } catch {
        report = buildRuntimeBacktestFixtureFromRunRequest(payload);
      }
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-backtest-report",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        report,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_COST_MODELS_PATH
  ) {
    let costModel: RuntimeExecutionCostModelRecord;
    try {
      const payload = await readJsonBody(request);
      costModel = parseRuntimeExecutionCostModelRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-execution-cost-model",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        costModel,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_COST_MODEL_OBSERVATIONS_PATH
  ) {
    let costObservation: RuntimeExecutionCostObservationRecord;
    try {
      const payload = await readJsonBody(request);
      costObservation = parseRuntimeExecutionCostObservationRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-execution-cost-observation",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        costObservation,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_FEATURE_DEFINITIONS_PATH
  ) {
    let featureDefinition: RuntimeFeatureDefinitionRecord;
    try {
      const payload = await readJsonBody(request);
      featureDefinition = parseRuntimeFeatureDefinitionRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-feature-definition",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        featureDefinition,
      },
      { status: 201 },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_REGIME_TAGS_PATH
  ) {
    let regimeTag: RuntimeRegimeTagRecord;
    try {
      const payload = await readJsonBody(request);
      regimeTag = parseRuntimeRegimeTagRecord(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-regime-tag",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        source: "stub",
        created: true,
        regimeTag,
      },
      { status: 201 },
    );
  }

  if (request.method === "POST") {
    const transitionAssetKey = runtimeAssetTransitionKeyFromPath(url.pathname);
    if (transitionAssetKey) {
      let payload: Record<string, unknown>;
      try {
        const body = await readJsonBody(request);
        payload =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
      } catch {
        payload = {};
      }
      const listingState =
        typeof payload.listingState === "string" &&
        [
          "candidate",
          "shadow",
          "paper",
          "live",
          "paused",
          "deprecated",
        ].includes(payload.listingState)
          ? (payload.listingState as RuntimeAssetListingState)
          : "live";
      return json({
        ok: true,
        source: "stub",
        asset: createRuntimeAssetFixture(transitionAssetKey, listingState),
      });
    }
  }

  if (
    request.method === "POST" &&
    url.pathname === INTERNAL_RUNTIME_EXECUTION_PLANS_PATH
  ) {
    let plan: RuntimeExecutionPlan;
    try {
      const payload = await readJsonBody(request);
      plan = parseRuntimeExecutionPlan(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          error: "invalid-runtime-execution-plan",
          details: {
            reason: error instanceof Error ? error.message : "unknown-error",
          },
        },
        { status: 400 },
      );
    }
    return json(
      {
        ok: true,
        accepted: true,
        source: "stub",
        submitRequestId: `submit_${plan.planId}`,
        coordination: {
          planId: plan.planId,
          deploymentId: plan.deploymentId,
          runId: plan.runId,
          mode: plan.mode,
          lane: plan.lane,
          sliceCount: plan.slices.length,
        },
      },
      { status: 202 },
    );
  }

  return json({ ok: false, error: "not-found" }, { status: 404 });
}
