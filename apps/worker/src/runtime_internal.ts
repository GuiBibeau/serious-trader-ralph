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
const INTERNAL_RUNTIME_DEPLOYMENTS_PREFIX = `${INTERNAL_RUNTIME_PREFIX}/deployments/`;
const INTERNAL_RUNTIME_RUNS_PREFIX = `${INTERNAL_RUNTIME_PREFIX}/runs/`;
const INTERNAL_RUNTIME_EXECUTION_PLANS_PATH = `${INTERNAL_RUNTIME_PREFIX}/execution-plans`;
const FIXTURE_TIMESTAMP = "2026-03-07T00:00:00.000Z";
const FIXTURE_BASE_MINT = "So11111111111111111111111111111111111111112";
const FIXTURE_QUOTE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_RUNTIME_SERVICE = "runtime-rs";

type RuntimeControlAction = "pause" | "resume" | "kill";

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

function readRuntimeServiceBaseUrl(env: Env): string | null {
  const raw = String(env.RUNTIME_INTERNAL_BASE_URL ?? "").trim();
  return raw || null;
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

function createRuntimeDeploymentFixture(
  deploymentId: string,
  state: RuntimeDeploymentRecord["state"] = "shadow",
): RuntimeDeploymentRecord {
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
    mode: state === "live" ? "live" : state === "paper" ? "paper" : "shadow",
    state,
    lane: "safe",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    ...(state === "paused" ? { pausedAt: FIXTURE_TIMESTAMP } : {}),
    ...(state === "killed" ? { killedAt: FIXTURE_TIMESTAMP } : {}),
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
      deployments: `${INTERNAL_RUNTIME_PREFIX}/deployments`,
      runs: `${INTERNAL_RUNTIME_PREFIX}/runs/:deploymentId`,
      positions: `${INTERNAL_RUNTIME_PREFIX}/positions`,
      pnl: `${INTERNAL_RUNTIME_PREFIX}/pnl`,
      executionPlans: INTERNAL_RUNTIME_EXECUTION_PLANS_PATH,
      health: `${INTERNAL_RUNTIME_PREFIX}/health`,
    },
  };
}

function mapControlActionToState(
  action: RuntimeControlAction,
): RuntimeDeploymentRecord["state"] {
  if (action === "pause") return "paused";
  if (action === "resume") return "shadow";
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

export async function handleRuntimeInternalRoute(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response | null> {
  const isRuntimeRoute =
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/health` ||
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/deployments` ||
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/positions` ||
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/pnl` ||
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
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/health`
  ) {
    return json(buildRuntimeHealthPayload(env, auth.service));
  }

  if (!isRuntimeStubModeEnabled(env)) {
    return runtimeInternalUnavailable(env);
  }

  if (
    request.method === "POST" &&
    url.pathname === `${INTERNAL_RUNTIME_PREFIX}/deployments`
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
          mapControlActionToState(control.action),
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
