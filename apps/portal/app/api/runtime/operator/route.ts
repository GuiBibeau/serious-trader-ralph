import { NextResponse } from "next/server";
import {
  type RuntimeDeploymentRecord,
  type RuntimeLedgerSnapshot,
  type RuntimeRunRecord,
  safeParseRuntimeDeploymentRecord,
  safeParseRuntimeLedgerSnapshot,
  safeParseRuntimeRunRecord,
} from "../../../../lib/runtime-contracts";
import {
  listRuntimeVenueProgramMatrix,
  RUNTIME_VENUE_PROGRAM_NEXT_ISSUES,
} from "../../../terminal/runtime/program-matrix";

const LOCAL_EDGE_API_BASE = "http://127.0.0.1:8888";
const BEARER_RE = /^bearer\s+/i;

type WorkerJsonResult = {
  status: number;
  payload: Record<string, unknown>;
};

type RuntimeControls = {
  enabled: boolean;
  disabledReason: string | null;
  shadowOnly: boolean;
  shadowOnlyReason: string | null;
};

type StrategyLabResearchSnapshot = {
  hypotheses: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  experiments: Record<string, unknown>[];
  evidenceBundles: Record<string, unknown>[];
  reproducibilityBundles: Record<string, unknown>[];
  error: string | null;
};

type StrategyLabPromotionSnapshot = {
  strategy: Record<string, unknown>[];
  venue: Record<string, unknown>[];
  asset: Record<string, unknown>[];
  error: string | null;
};

type StrategyLabSubjectSnapshot = {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  artifacts: Record<string, unknown>[];
  controls: Record<string, unknown>[];
  canaryRuns: Record<string, unknown>[];
  canaryState: Record<string, unknown> | null;
  error: string | null;
};

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> =>
    isRecord(entry),
  );
}

function workerPayload(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return record;
}

function normalizeAuthHeader(value: string | null): string | null {
  const token = String(value ?? "").trim();
  if (!token) return null;
  return BEARER_RE.test(token) ? token : `Bearer ${token}`;
}

function resolveEdgeApiBase(): string {
  const configured = String(process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : LOCAL_EDGE_API_BASE;
}

function resolveAdminToken(): string {
  return String(
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? "",
  ).trim();
}

function isAuthorizedRuntimeOperator(
  payload: Record<string, unknown>,
): boolean {
  const user = isRecord(payload.user) ? payload.user : null;
  if (!user) return false;

  const allowedUserIds = parseCsvSet(
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST,
  );
  const allowedPrivyUserIds = parseCsvSet(
    process.env.RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST,
  );
  if (allowedUserIds.size === 0 && allowedPrivyUserIds.size === 0) {
    return false;
  }

  const userId = readString(user.id);
  if (userId && allowedUserIds.has(userId)) return true;

  const privyUserId = readString(user.privyUserId);
  if (privyUserId && allowedPrivyUserIds.has(privyUserId)) return true;

  return false;
}

async function requestWorkerJson(input: {
  path: string;
  method?: "GET" | "POST";
  authHeader: string;
  body?: unknown;
}): Promise<WorkerJsonResult> {
  const base = resolveEdgeApiBase();
  if (!base) {
    return {
      status: 503,
      payload: { ok: false, error: "missing NEXT_PUBLIC_EDGE_API_BASE" },
    };
  }

  const response = await fetch(`${base}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      authorization: input.authHeader,
      ...(input.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    payload:
      isRecord(payload) && Object.keys(payload).length > 0
        ? payload
        : { ok: false, error: `http-${response.status}` },
  };
}

async function validateOperatorSession(
  userAuthHeader: string,
): Promise<WorkerJsonResult> {
  return await requestWorkerJson({
    path: "/api/me",
    authHeader: userAuthHeader,
  });
}

function parseDeployments(value: unknown): RuntimeDeploymentRecord[] {
  if (!Array.isArray(value)) return [];
  const deployments: RuntimeDeploymentRecord[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeDeploymentRecord(entry);
    if (parsed.success) deployments.push(parsed.data);
  }
  return deployments;
}

function parseRuns(value: unknown): RuntimeRunRecord[] {
  if (!Array.isArray(value)) return [];
  const runs: RuntimeRunRecord[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeRunRecord(entry);
    if (parsed.success) runs.push(parsed.data);
  }
  return runs;
}

function parseLedgerSnapshot(value: unknown): RuntimeLedgerSnapshot | null {
  const parsed = safeParseRuntimeLedgerSnapshot(value);
  return parsed.success ? parsed.data : null;
}

function normalizeControls(value: unknown): RuntimeControls {
  const controls = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(controls.enabled, true),
    disabledReason: readString(controls.disabledReason),
    shadowOnly: readBoolean(controls.shadowOnly, true),
    shadowOnlyReason:
      readString(controls.shadowOnlyReason) ?? "live-rollout-pending",
  };
}

function parsePnl(value: unknown): {
  asOf: string | null;
  totals: RuntimeLedgerSnapshot["totals"];
} | null {
  const payload = isRecord(value) ? value : {};
  const totals = isRecord(payload.totals) ? payload.totals : null;
  if (!totals) return null;
  return {
    asOf: readString(payload.asOf),
    totals: {
      equityUsd: readString(totals.equityUsd) ?? "0.00",
      reservedUsd: readString(totals.reservedUsd) ?? "0.00",
      availableUsd: readString(totals.availableUsd) ?? "0.00",
      realizedPnlUsd: readString(totals.realizedPnlUsd) ?? "0.00",
      unrealizedPnlUsd: readString(totals.unrealizedPnlUsd) ?? "0.00",
    },
  };
}

function normalizeRuntimeSnapshot(payload: Record<string, unknown>) {
  const runtime = isRecord(payload.runtime) ? payload.runtime : {};
  return {
    ok: readBoolean(runtime.ok, false),
    source: readString(runtime.source) ?? "worker",
    integration: isRecord(runtime.integration) ? runtime.integration : {},
    health: isRecord(runtime.health) ? runtime.health : null,
    routes: isRecord(runtime.routes) ? runtime.routes : null,
    deployments: parseDeployments(runtime.deployments),
    controls: normalizeControls(runtime.controls),
    canary: isRecord(runtime.canary) ? runtime.canary : null,
    leaderboard: isRecord(runtime.leaderboard) ? runtime.leaderboard : null,
    error: readString(runtime.error),
  };
}

function buildQueryPath(
  path: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    search.set(key, normalized);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function inferAssetKey(
  deployment: RuntimeDeploymentRecord | null,
): string | null {
  if (!deployment) return null;
  const [baseSymbol] = deployment.pair.symbol.split("/");
  return readString(baseSymbol) ?? null;
}

function resolveOperatorActor(payload: Record<string, unknown>): string {
  const user = isRecord(payload.user) ? payload.user : {};
  return (
    readString(user.email) ??
    readString(user.id) ??
    readString(user.privyUserId) ??
    "runtime-operator"
  );
}

async function loadStrategyLabResearch(
  deployment: RuntimeDeploymentRecord,
  adminAuthHeader: string,
): Promise<StrategyLabResearchSnapshot> {
  const assetKey = inferAssetKey(deployment);
  const result = await requestWorkerJson({
    path: buildQueryPath("/api/admin/ops/runtime/research", {
      strategyKey: deployment.strategyKey,
      venueKey: deployment.venueKey,
      assetKey,
    }),
    authHeader: adminAuthHeader,
  });
  if (result.status < 200 || result.status >= 300) {
    return {
      hypotheses: [],
      sources: [],
      experiments: [],
      evidenceBundles: [],
      reproducibilityBundles: [],
      error: readString(result.payload.error) ?? `http-${result.status}`,
    };
  }
  const registry = isRecord(result.payload.registry)
    ? result.payload.registry
    : {};
  return {
    hypotheses: readRecordArray(registry.hypotheses),
    sources: readRecordArray(registry.sources),
    experiments: readRecordArray(registry.experiments),
    evidenceBundles: readRecordArray(registry.evidenceBundles),
    reproducibilityBundles: readRecordArray(registry.reproducibilityBundles),
    error: null,
  };
}

async function loadStrategyLabPromotions(
  deployment: RuntimeDeploymentRecord,
  adminAuthHeader: string,
): Promise<StrategyLabPromotionSnapshot> {
  const assetKey = inferAssetKey(deployment);
  const [strategyResult, venueResult, assetResult] = await Promise.all([
    requestWorkerJson({
      path: buildQueryPath("/api/admin/ops/runtime/research/promotions", {
        subjectKind: "strategy",
        subjectKey: deployment.strategyKey,
        limit: 5,
      }),
      authHeader: adminAuthHeader,
    }),
    requestWorkerJson({
      path: buildQueryPath("/api/admin/ops/runtime/research/promotions", {
        subjectKind: "venue",
        subjectKey: deployment.venueKey,
        limit: 5,
      }),
      authHeader: adminAuthHeader,
    }),
    assetKey
      ? requestWorkerJson({
          path: buildQueryPath("/api/admin/ops/runtime/research/promotions", {
            subjectKind: "asset",
            subjectKey: assetKey,
            limit: 5,
          }),
          authHeader: adminAuthHeader,
        })
      : Promise.resolve({
          status: 200,
          payload: workerPayload({ ok: true, promotions: [] }),
        }),
  ]);

  const errors = [strategyResult, venueResult, assetResult]
    .filter((result) => result.status < 200 || result.status >= 300)
    .map(
      (result) => readString(result.payload.error) ?? `http-${result.status}`,
    )
    .filter(Boolean);

  return {
    strategy:
      strategyResult.status >= 200 && strategyResult.status < 300
        ? readRecordArray(strategyResult.payload.promotions)
        : [],
    venue:
      venueResult.status >= 200 && venueResult.status < 300
        ? readRecordArray(venueResult.payload.promotions)
        : [],
    asset:
      assetResult.status >= 200 && assetResult.status < 300
        ? readRecordArray(assetResult.payload.promotions)
        : [],
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

async function loadStrategyLabSubject(
  subjectKind: "venue" | "asset",
  subjectKey: string | null,
  adminAuthHeader: string,
): Promise<StrategyLabSubjectSnapshot | null> {
  if (!subjectKey) return null;

  const [readinessResult, controlsResult, canaryResult] = await Promise.all([
    requestWorkerJson({
      path: buildQueryPath("/api/admin/ops/runtime/research/readiness", {
        subjectKind,
        subjectKey,
        limit: 5,
      }),
      authHeader: adminAuthHeader,
    }),
    requestWorkerJson({
      path: buildQueryPath("/api/admin/ops/runtime/research/subject-controls", {
        subjectKind,
        subjectKey,
        limit: 5,
      }),
      authHeader: adminAuthHeader,
    }),
    requestWorkerJson({
      path: buildQueryPath("/api/admin/ops/runtime/research/readiness/canary", {
        subjectKind,
        subjectKey,
        limit: 5,
      }),
      authHeader: adminAuthHeader,
    }),
  ]);

  const errors = [readinessResult, controlsResult, canaryResult]
    .filter((result) => result.status < 200 || result.status >= 300)
    .map(
      (result) => readString(result.payload.error) ?? `http-${result.status}`,
    )
    .filter(Boolean);

  return {
    subjectKind,
    subjectKey,
    artifacts:
      readinessResult.status >= 200 && readinessResult.status < 300
        ? readRecordArray(readinessResult.payload.readinessArtifacts)
        : [],
    controls:
      controlsResult.status >= 200 && controlsResult.status < 300
        ? readRecordArray(controlsResult.payload.controls)
        : [],
    canaryRuns:
      canaryResult.status >= 200 && canaryResult.status < 300
        ? readRecordArray(canaryResult.payload.runs)
        : [],
    canaryState:
      canaryResult.status >= 200 &&
      canaryResult.status < 300 &&
      isRecord(canaryResult.payload.state)
        ? canaryResult.payload.state
        : null,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

function firstDeploymentId(
  deployments: RuntimeDeploymentRecord[],
): string | null {
  return deployments[0]?.deploymentId ?? null;
}

async function loadRuntimeDetail(
  deploymentId: string,
  adminAuthHeader: string,
): Promise<{
  detail: {
    deploymentId: string;
    deployment: RuntimeDeploymentRecord | null;
    runs: RuntimeRunRecord[];
    allocator: Record<string, unknown> | null;
    positions: RuntimeLedgerSnapshot | null;
    pnl: {
      asOf: string | null;
      totals: RuntimeLedgerSnapshot["totals"];
    } | null;
    scorecard: Record<string, unknown> | null;
    lab: {
      research: StrategyLabResearchSnapshot;
      promotions: StrategyLabPromotionSnapshot;
      readiness: {
        venue: StrategyLabSubjectSnapshot | null;
        asset: StrategyLabSubjectSnapshot | null;
      };
    } | null;
  } | null;
  error: string | null;
}> {
  const result = await requestWorkerJson({
    path: `/api/admin/ops/runtime/deployments/${encodeURIComponent(deploymentId)}`,
    authHeader: adminAuthHeader,
  });
  if (result.status < 200 || result.status >= 300) {
    return {
      detail: null,
      error: readString(result.payload.error) ?? `http-${result.status}`,
    };
  }
  const parsedDeployment = isRecord(result.payload.deployment)
    ? safeParseRuntimeDeploymentRecord(result.payload.deployment)
    : null;
  const deployment = parsedDeployment?.success ? parsedDeployment.data : null;
  const [research, promotions, venueReadiness, assetReadiness] = deployment
    ? await Promise.all([
        loadStrategyLabResearch(deployment, adminAuthHeader),
        loadStrategyLabPromotions(deployment, adminAuthHeader),
        loadStrategyLabSubject("venue", deployment.venueKey, adminAuthHeader),
        loadStrategyLabSubject(
          "asset",
          inferAssetKey(deployment),
          adminAuthHeader,
        ),
      ])
    : await Promise.all([
        Promise.resolve({
          hypotheses: [],
          sources: [],
          experiments: [],
          evidenceBundles: [],
          reproducibilityBundles: [],
          error: "missing-selected-deployment",
        }),
        Promise.resolve({
          strategy: [],
          venue: [],
          asset: [],
          error: "missing-selected-deployment",
        }),
        Promise.resolve(null),
        Promise.resolve(null),
      ]);

  return {
    detail: {
      deploymentId,
      deployment,
      runs: parseRuns(result.payload.runs),
      allocator: isRecord(result.payload.allocator)
        ? result.payload.allocator
        : null,
      positions: parseLedgerSnapshot(result.payload.positions),
      pnl: parsePnl(result.payload.pnl),
      scorecard: isRecord(result.payload.scorecard)
        ? result.payload.scorecard
        : null,
      lab: {
        research,
        promotions,
        readiness: {
          venue: venueReadiness,
          asset: assetReadiness,
        },
      },
    },
    error: null,
  };
}

export async function GET(request: Request) {
  const userAuthHeader = normalizeAuthHeader(
    request.headers.get("authorization"),
  );
  if (!userAuthHeader) {
    return NextResponse.json(
      { ok: false, error: "auth-required" },
      { status: 401 },
    );
  }

  const sessionResult = await validateOperatorSession(userAuthHeader);
  if (sessionResult.status < 200 || sessionResult.status >= 300) {
    return NextResponse.json(sessionResult.payload, {
      status: sessionResult.status,
    });
  }
  if (!isAuthorizedRuntimeOperator(sessionResult.payload)) {
    return NextResponse.json(
      { ok: false, error: "operator-access-required" },
      { status: 403 },
    );
  }

  const adminToken = resolveAdminToken();
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "missing RUNTIME_OPERATOR_ADMIN_TOKEN" },
      { status: 503 },
    );
  }

  const snapshotResult = await requestWorkerJson({
    path: "/api/admin/ops/runtime",
    authHeader: `Bearer ${adminToken}`,
  });
  if (snapshotResult.status < 200 || snapshotResult.status >= 300) {
    return NextResponse.json(snapshotResult.payload, {
      status: snapshotResult.status,
    });
  }

  const runtime = normalizeRuntimeSnapshot(snapshotResult.payload);
  const url = new URL(request.url);
  const selectedDeploymentId =
    readString(url.searchParams.get("deploymentId")) ??
    firstDeploymentId(runtime.deployments);

  let detail: Awaited<ReturnType<typeof loadRuntimeDetail>>["detail"] = null;
  let detailError: string | null = null;
  if (selectedDeploymentId) {
    const detailResult = await loadRuntimeDetail(
      selectedDeploymentId,
      `Bearer ${adminToken}`,
    );
    detail = detailResult.detail;
    detailError = detailResult.error;
  }

  return NextResponse.json({
    ok: true,
    runtime,
    program: {
      matrix: listRuntimeVenueProgramMatrix(),
      nextIssueOrder: [...RUNTIME_VENUE_PROGRAM_NEXT_ISSUES],
    },
    selectedDeploymentId,
    detail,
    detailError,
  });
}

export async function POST(request: Request) {
  const userAuthHeader = normalizeAuthHeader(
    request.headers.get("authorization"),
  );
  if (!userAuthHeader) {
    return NextResponse.json(
      { ok: false, error: "auth-required" },
      { status: 401 },
    );
  }

  const sessionResult = await validateOperatorSession(userAuthHeader);
  if (sessionResult.status < 200 || sessionResult.status >= 300) {
    return NextResponse.json(sessionResult.payload, {
      status: sessionResult.status,
    });
  }
  if (!isAuthorizedRuntimeOperator(sessionResult.payload)) {
    return NextResponse.json(
      { ok: false, error: "operator-access-required" },
      { status: 403 },
    );
  }

  const operatorActor = resolveOperatorActor(sessionResult.payload);

  const adminToken = resolveAdminToken();
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "missing RUNTIME_OPERATOR_ADMIN_TOKEN" },
      { status: 503 },
    );
  }

  const payloadRaw = (await request.json().catch(() => null)) as unknown;
  const payload = isRecord(payloadRaw) ? payloadRaw : {};
  const deploymentId = readString(payload.deploymentId);
  const action = readString(payload.action);
  if (action === "pause" || action === "resume" || action === "kill") {
    if (!deploymentId) {
      return NextResponse.json(
        { ok: false, error: "invalid-runtime-operator-action" },
        { status: 400 },
      );
    }

    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/deployments/${encodeURIComponent(
        deploymentId,
      )}/${action}`,
      method: "POST",
      authHeader: `Bearer ${adminToken}`,
    });
    return NextResponse.json(result.payload, { status: result.status });
  }

  if (action === "evaluate_deployment") {
    if (!deploymentId) {
      return NextResponse.json(
        { ok: false, error: "invalid-runtime-operator-action" },
        { status: 400 },
      );
    }

    const evaluationBody = isRecord(payload.body) ? payload.body : {};
    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/deployments/${encodeURIComponent(
        deploymentId,
      )}/evaluate`,
      method: "POST",
      authHeader: `Bearer ${adminToken}`,
      body: evaluationBody,
    });
    return NextResponse.json(result.payload, { status: result.status });
  }

  if (action === "update_subject_control") {
    const subjectKind =
      payload.subjectKind === "venue" || payload.subjectKind === "asset"
        ? payload.subjectKind
        : null;
    const subjectKey = readString(payload.subjectKey);
    if (!subjectKind || !subjectKey) {
      return NextResponse.json(
        { ok: false, error: "invalid-runtime-operator-action" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: "/api/admin/ops/runtime/research/subject-controls",
      method: "POST",
      authHeader: `Bearer ${adminToken}`,
      body: {
        subjectKind,
        subjectKey,
        ...(typeof payload.liveAllowed === "boolean"
          ? { liveAllowed: payload.liveAllowed }
          : {}),
        ...(typeof payload.killSwitchEnabled === "boolean"
          ? { killSwitchEnabled: payload.killSwitchEnabled }
          : {}),
        ...(payload.disabledReason === null ||
        typeof payload.disabledReason === "string"
          ? { disabledReason: payload.disabledReason ?? null }
          : {}),
        updatedBy: operatorActor,
      },
    });
    return NextResponse.json(result.payload, { status: result.status });
  }

  if (action === "run_readiness_canary") {
    const subjectKind =
      payload.subjectKind === "venue" || payload.subjectKind === "asset"
        ? payload.subjectKind
        : null;
    const subjectKey = readString(payload.subjectKey);
    if (!subjectKind || !subjectKey) {
      return NextResponse.json(
        { ok: false, error: "invalid-runtime-operator-action" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: "/api/admin/ops/runtime/research/readiness/canary",
      method: "POST",
      authHeader: `Bearer ${adminToken}`,
      body: {
        subjectKind,
        subjectKey,
        requestedBy: operatorActor,
        triggerSource: "manual",
        ...(readString(payload.venueKey)
          ? { venueKey: readString(payload.venueKey) }
          : {}),
        ...(readString(payload.assetKey)
          ? { assetKey: readString(payload.assetKey) }
          : {}),
        ...(readString(payload.pairSymbol)
          ? { pairSymbol: readString(payload.pairSymbol) }
          : {}),
        ...(readString(payload.adapterKey)
          ? { adapterKey: readString(payload.adapterKey) }
          : {}),
        ...(readString(payload.targetNotionalUsd)
          ? { targetNotionalUsd: readString(payload.targetNotionalUsd) }
          : {}),
      },
    });
    return NextResponse.json(result.payload, { status: result.status });
  }

  if (action === "run_venue_tx_smoke") {
    const subjectKind = payload.subjectKind === "venue" ? "venue" : null;
    const subjectKey = readString(payload.subjectKey);
    if (!subjectKind || !subjectKey) {
      return NextResponse.json(
        { ok: false, error: "invalid-runtime-operator-action" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: "/api/admin/ops/runtime/research/readiness/smoke",
      method: "POST",
      authHeader: `Bearer ${adminToken}`,
      body: {
        subjectKind,
        subjectKey,
        requestedBy: operatorActor,
        triggerSource: "manual",
        proofMode: "venue_tx_smoke",
        ...(readString(payload.venueKey)
          ? { venueKey: readString(payload.venueKey) }
          : {}),
        ...(readString(payload.assetKey)
          ? { assetKey: readString(payload.assetKey) }
          : {}),
        ...(readString(payload.pairSymbol)
          ? { pairSymbol: readString(payload.pairSymbol) }
          : {}),
        ...(readString(payload.adapterKey)
          ? { adapterKey: readString(payload.adapterKey) }
          : {}),
        ...(readString(payload.targetNotionalUsd)
          ? { targetNotionalUsd: readString(payload.targetNotionalUsd) }
          : {}),
        ...(payload.smokeIntentFamily === "spot_swap" ||
        payload.smokeIntentFamily === "conditional_spot_order" ||
        payload.smokeIntentFamily === "clob_order" ||
        payload.smokeIntentFamily === "prediction_order"
          ? { smokeIntentFamily: payload.smokeIntentFamily }
          : {}),
        ...(payload.smokeOrderSide === "buy" ||
        payload.smokeOrderSide === "sell"
          ? { smokeOrderSide: payload.smokeOrderSide }
          : {}),
        ...(typeof payload.tightenOnFailure === "boolean"
          ? { tightenOnFailure: payload.tightenOnFailure }
          : {}),
        ...(payload.failureControlMode === "disable_live" ||
        payload.failureControlMode === "engage_kill_switch"
          ? { failureControlMode: payload.failureControlMode }
          : {}),
        ...(Array.isArray(payload.killDrillNotes)
          ? {
              killDrillNotes: payload.killDrillNotes
                .map((entry) => readString(entry))
                .filter((entry): entry is string => Boolean(entry)),
            }
          : {}),
        ...(isRecord(payload.metadata) ? { metadata: payload.metadata } : {}),
      },
    });
    return NextResponse.json(result.payload, { status: result.status });
  }

  return NextResponse.json(
    { ok: false, error: "invalid-runtime-operator-action" },
    { status: 400 },
  );
}
