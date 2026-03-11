import {
  executionErrorStatus,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
import { json } from "./response";
import {
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeLedgerSnapshot,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchExperimentRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchSourceRecord,
  parseRuntimeRunRecord,
  RUNTIME_PROTOCOL_SCHEMA_VERSION,
  type RuntimeDeploymentRecord,
  type RuntimeExecutionPlan,
  type RuntimeLedgerSnapshot,
  type RuntimeResearchEvidenceBundleRecord,
  type RuntimeResearchExperimentRecord,
  type RuntimeResearchHypothesisRecord,
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
const INTERNAL_RUNTIME_ALLOCATOR_PATH = `${INTERNAL_RUNTIME_PREFIX}/allocator`;
const INTERNAL_RUNTIME_RESEARCH_PATH = `${INTERNAL_RUNTIME_PREFIX}/research`;
const INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/hypotheses`;
const INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/sources`;
const INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/experiments`;
const INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH = `${INTERNAL_RUNTIME_RESEARCH_PATH}/evidence-bundles`;
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
      allocator: {
        decisionCount: 3,
        fullGrantCount: 3,
        constrainedCount: 0,
        zeroGrantCount: 0,
        fullGrantRateBps: 10000,
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
    authors: ["Ada Researcher"],
    publishedAt: "2026-02-01T00:00:00.000Z",
    retrievedAt: FIXTURE_TIMESTAMP,
    contentDigest: "sha256:paper",
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

function createRuntimeResearchRegistryFixture() {
  return {
    hypotheses: [createRuntimeResearchHypothesisFixture()],
    sources: [createRuntimeResearchSourceFixture()],
    experiments: [createRuntimeResearchExperimentFixture()],
    evidenceBundles: [createRuntimeResearchEvidenceBundleFixture()],
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
      allocator: INTERNAL_RUNTIME_ALLOCATOR_PATH,
      research: INTERNAL_RUNTIME_RESEARCH_PATH,
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
  const healthResult = await dispatchRuntimeInternalJson({
    env,
    method: "GET",
    pathname: INTERNAL_RUNTIME_HEALTH_PATH,
  });
  if (!healthResult.ok) {
    return {
      ok: false,
      source: "worker",
      integration,
      health: null,
      deployments: [],
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
    url.pathname === INTERNAL_RUNTIME_ALLOCATOR_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_HYPOTHESES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_SOURCES_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EXPERIMENTS_PATH ||
    url.pathname === INTERNAL_RUNTIME_RESEARCH_EVIDENCE_BUNDLES_PATH ||
    url.pathname === INTERNAL_RUNTIME_EXECUTION_PLANS_PATH ||
    url.pathname.startsWith(INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX) ||
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
