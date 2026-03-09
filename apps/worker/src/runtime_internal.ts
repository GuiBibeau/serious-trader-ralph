import { json } from "./response";
import {
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeLedgerSnapshot,
  parseRuntimeRunRecord,
  RUNTIME_PROTOCOL_SCHEMA_VERSION,
  type RuntimeDeploymentRecord,
  type RuntimeExecutionPlan,
  type RuntimeLedgerSnapshot,
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
    return runtimeInternalUnavailable(env);
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
