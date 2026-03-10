import { NextResponse } from "next/server";
import {
  type RuntimeDeploymentRecord,
  type RuntimeLedgerSnapshot,
  type RuntimeRunRecord,
  safeParseRuntimeDeploymentRecord,
  safeParseRuntimeLedgerSnapshot,
  safeParseRuntimeRunRecord,
} from "../../../../lib/runtime-contracts";

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
    deployments: parseDeployments(runtime.deployments),
    controls: normalizeControls(runtime.controls),
    canary: isRecord(runtime.canary) ? runtime.canary : null,
    error: readString(runtime.error),
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
    positions: RuntimeLedgerSnapshot | null;
    pnl: {
      asOf: string | null;
      totals: RuntimeLedgerSnapshot["totals"];
    } | null;
    scorecard: Record<string, unknown> | null;
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

  return {
    detail: {
      deploymentId,
      deployment: parsedDeployment?.success ? parsedDeployment.data : null,
      runs: parseRuns(result.payload.runs),
      positions: parseLedgerSnapshot(result.payload.positions),
      pnl: parsePnl(result.payload.pnl),
      scorecard: isRecord(result.payload.scorecard)
        ? result.payload.scorecard
        : null,
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
  if (!deploymentId || !action) {
    return NextResponse.json(
      { ok: false, error: "invalid-runtime-operator-action" },
      { status: 400 },
    );
  }
  if (action !== "pause" && action !== "resume" && action !== "kill") {
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
