import { NextResponse } from "next/server";
import {
  type RuntimeStrategyDeskExecutionRecipe,
  type RuntimeStrategyDeskPromotionHandoff,
  type RuntimeStrategyDeskPromotionHandoffEvent,
  type RuntimeStrategyDeskScenarioManifest,
  type RuntimeStrategyDeskScenarioReport,
  type RuntimeStrategyDeskScenarioRun,
  safeParseRuntimeStrategyDeskExecutionRecipe,
  safeParseRuntimeStrategyDeskPromotionHandoff,
  safeParseRuntimeStrategyDeskPromotionHandoffEvent,
  safeParseRuntimeStrategyDeskScenarioManifest,
  safeParseRuntimeStrategyDeskScenarioReport,
  safeParseRuntimeStrategyDeskScenarioRun,
} from "../../../../lib/runtime-strategy-desk";

const LOCAL_EDGE_API_BASE = "http://127.0.0.1:8888";
const BEARER_RE = /^bearer\s+/i;

type WorkerJsonResult = {
  status: number;
  payload: Record<string, unknown>;
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => Boolean(readString(entry)));
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

  let response: Response;
  try {
    response = await fetch(`${base}${input.path}`, {
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
  } catch {
    return {
      status: 502,
      payload: { ok: false, error: "worker-fetch-failed" },
    };
  }
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

function parseScenarios(value: unknown): RuntimeStrategyDeskScenarioManifest[] {
  if (!Array.isArray(value)) return [];
  const scenarios: RuntimeStrategyDeskScenarioManifest[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskScenarioManifest(entry);
    if (parsed.success) scenarios.push(parsed.data);
  }
  return scenarios;
}

function parseRuns(value: unknown): RuntimeStrategyDeskScenarioRun[] {
  if (!Array.isArray(value)) return [];
  const runs: RuntimeStrategyDeskScenarioRun[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskScenarioRun(entry);
    if (parsed.success) runs.push(parsed.data);
  }
  return runs;
}

function parseReports(value: unknown): RuntimeStrategyDeskScenarioReport[] {
  if (!Array.isArray(value)) return [];
  const reports: RuntimeStrategyDeskScenarioReport[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskScenarioReport(entry);
    if (parsed.success) reports.push(parsed.data);
  }
  return reports;
}

function parseHandoffs(value: unknown): RuntimeStrategyDeskPromotionHandoff[] {
  if (!Array.isArray(value)) return [];
  const handoffs: RuntimeStrategyDeskPromotionHandoff[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskPromotionHandoff(entry);
    if (parsed.success) handoffs.push(parsed.data);
  }
  return handoffs;
}

function parseHandoffEvents(
  value: unknown,
): RuntimeStrategyDeskPromotionHandoffEvent[] {
  if (!Array.isArray(value)) return [];
  const events: RuntimeStrategyDeskPromotionHandoffEvent[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskPromotionHandoffEvent(entry);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

function parseExecutionRecipes(
  value: unknown,
): RuntimeStrategyDeskExecutionRecipe[] {
  if (!Array.isArray(value)) return [];
  const recipes: RuntimeStrategyDeskExecutionRecipe[] = [];
  for (const entry of value) {
    const parsed = safeParseRuntimeStrategyDeskExecutionRecipe(entry);
    if (parsed.success) recipes.push(parsed.data);
  }
  return recipes;
}

function latestByTimestamp<
  T extends { generatedAt?: string; updatedAt?: string },
>(items: T[], timestampKey: "generatedAt" | "updatedAt"): T | null {
  return (
    [...items].sort((left, right) =>
      String(right[timestampKey] ?? "").localeCompare(
        String(left[timestampKey] ?? ""),
      ),
    )[0] ?? null
  );
}

async function ensureAuthorizedOperator(request: Request): Promise<
  | {
      ok: true;
      adminAuthHeader: string;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const userAuthHeader = normalizeAuthHeader(
    request.headers.get("authorization"),
  );
  if (!userAuthHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "auth-required" },
        { status: 401 },
      ),
    };
  }

  const session = await validateOperatorSession(userAuthHeader);
  if (session.status >= 500) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error:
            readString(session.payload.error) ??
            "operator-auth-upstream-failed",
        },
        { status: session.status || 502 },
      ),
    };
  }
  if (session.status !== 200 || session.payload.ok !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: readString(session.payload.error) ?? "operator-auth-failed",
        },
        { status: 401 },
      ),
    };
  }

  if (!isAuthorizedRuntimeOperator(session.payload)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "operator-access-required" },
        { status: 403 },
      ),
    };
  }

  const adminToken = resolveAdminToken();
  const adminAuthHeader = normalizeAuthHeader(adminToken);
  if (!adminAuthHeader) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "missing RUNTIME_OPERATOR_ADMIN_TOKEN" },
        { status: 503 },
      ),
    };
  }

  return {
    ok: true,
    adminAuthHeader,
  };
}

function parseExecutePayload(value: unknown): {
  scenarioId: string;
  runKind: "shadow" | "paper";
  requestedBy: string;
  walletAddress: string;
  trigger?: Record<string, unknown>;
  maxRetriesPerLeg?: number;
} | null {
  if (!isRecord(value)) return null;
  const scenarioId = readString(value.scenarioId);
  const runKind =
    value.runKind === "shadow" || value.runKind === "paper"
      ? value.runKind
      : null;
  const requestedBy = readString(value.requestedBy);
  const walletAddress = readString(value.walletAddress);
  const maxRetriesPerLeg = Number(value.maxRetriesPerLeg);
  if (!scenarioId || !runKind || !requestedBy || !walletAddress) return null;
  return {
    scenarioId,
    runKind,
    requestedBy,
    walletAddress,
    ...(isRecord(value.trigger) ? { trigger: value.trigger } : {}),
    ...(Number.isFinite(maxRetriesPerLeg) && maxRetriesPerLeg >= 0
      ? { maxRetriesPerLeg: Math.trunc(maxRetriesPerLeg) }
      : {}),
  };
}

function parseStudyPayload(value: unknown): {
  scenarioId: string;
  runKind: "replay" | "backtest";
  requestedBy: string;
  selectionMetric?: "net_return_bps" | "excess_vs_flat_cash_bps";
  variantIds?: string[];
  windowIds?: string[];
} | null {
  if (!isRecord(value)) return null;
  const scenarioId = readString(value.scenarioId);
  const runKind =
    value.runKind === "replay" || value.runKind === "backtest"
      ? value.runKind
      : null;
  const requestedBy = readString(value.requestedBy);
  const selectionMetric =
    value.selectionMetric === "net_return_bps" ||
    value.selectionMetric === "excess_vs_flat_cash_bps"
      ? value.selectionMetric
      : undefined;
  if (!scenarioId || !runKind || !requestedBy) return null;
  const variantIds = readStringArray(value.variantIds);
  const windowIds = readStringArray(value.windowIds);
  return {
    scenarioId,
    runKind,
    requestedBy,
    ...(selectionMetric ? { selectionMetric } : {}),
    ...(variantIds.length > 0 ? { variantIds } : {}),
    ...(windowIds.length > 0 ? { windowIds } : {}),
  };
}

function parsePrepareHandoffPayload(value: unknown): {
  scenarioId: string;
  requestedBy: string;
  targetMode?: "limited_live";
} | null {
  if (!isRecord(value)) return null;
  const scenarioId = readString(value.scenarioId);
  const requestedBy = readString(value.requestedBy);
  const targetMode =
    value.targetMode === "limited_live" ? "limited_live" : undefined;
  if (!scenarioId || !requestedBy) return null;
  return {
    scenarioId,
    requestedBy,
    ...(targetMode ? { targetMode } : {}),
  };
}

function parseTransitionHandoffPayload(value: unknown): {
  handoffId: string;
  actor: string;
  handoffAction:
    | "submit"
    | "approve"
    | "reject"
    | "apply"
    | "pause"
    | "kill"
    | "demote"
    | "archive";
  notes?: string;
} | null {
  if (!isRecord(value)) return null;
  const handoffId = readString(value.handoffId);
  const actor = readString(value.actor);
  const handoffAction =
    value.handoffAction === "submit" ||
    value.handoffAction === "approve" ||
    value.handoffAction === "reject" ||
    value.handoffAction === "apply" ||
    value.handoffAction === "pause" ||
    value.handoffAction === "kill" ||
    value.handoffAction === "demote" ||
    value.handoffAction === "archive"
      ? value.handoffAction
      : null;
  const notes = readString(value.notes);
  if (!handoffId || !actor || !handoffAction) return null;
  return {
    handoffId,
    actor,
    handoffAction,
    ...(notes ? { notes } : {}),
  };
}

export async function GET(request: Request) {
  const auth = await ensureAuthorizedOperator(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedScenarioId = readString(url.searchParams.get("scenarioId"));
  const listQuery = new URLSearchParams();
  listQuery.set("limit", "20");
  for (const key of [
    "ownerUserId",
    "strategyKey",
    "state",
    "venueKey",
    "intentFamily",
    "marketType",
  ] as const) {
    const value = readString(url.searchParams.get(key));
    if (value) listQuery.set(key, value);
  }

  const scenariosResult = await requestWorkerJson({
    path: `/api/admin/ops/runtime/strategy-desk/scenarios?${listQuery.toString()}`,
    authHeader: auth.adminAuthHeader,
  });
  if (scenariosResult.status !== 200 || scenariosResult.payload.ok !== true) {
    return NextResponse.json(
      {
        ok: false,
        error:
          readString(scenariosResult.payload.error) ??
          "strategy-desk-scenarios-load-failed",
      },
      { status: scenariosResult.status || 502 },
    );
  }

  const scenarios = parseScenarios(scenariosResult.payload.scenarios);
  let selectedScenario =
    (requestedScenarioId
      ? scenarios.find(
          (scenario) => scenario.scenarioId === requestedScenarioId,
        )
      : null) ?? null;

  if (!selectedScenario && requestedScenarioId) {
    const detailResult = await requestWorkerJson({
      path: `/api/admin/ops/runtime/strategy-desk/scenarios/${encodeURIComponent(
        requestedScenarioId,
      )}`,
      authHeader: auth.adminAuthHeader,
    });
    if (detailResult.status !== 200 || detailResult.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(detailResult.payload.error) ??
            "strategy-desk-scenario-load-failed",
        },
        { status: detailResult.status || 502 },
      );
    }
    const parsed = safeParseRuntimeStrategyDeskScenarioManifest(
      detailResult.payload.scenario,
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-scenario-parse-failed" },
        { status: 502 },
      );
    }
    selectedScenario = parsed.data;
  }

  selectedScenario ??= scenarios[0] ?? null;
  const selectedScenarioId = selectedScenario?.scenarioId ?? null;

  let runs: RuntimeStrategyDeskScenarioRun[] = [];
  let reports: RuntimeStrategyDeskScenarioReport[] = [];
  let handoffs: RuntimeStrategyDeskPromotionHandoff[] = [];
  let latestHandoff: RuntimeStrategyDeskPromotionHandoff | null = null;
  let activeHandoff: RuntimeStrategyDeskPromotionHandoff | null = null;
  let handoffEvents: RuntimeStrategyDeskPromotionHandoffEvent[] = [];
  let executionRecipes: RuntimeStrategyDeskExecutionRecipe[] = [];

  if (selectedScenarioId) {
    const [runsResult, reportsResult, handoffsResult] = await Promise.all([
      requestWorkerJson({
        path: `/api/admin/ops/runtime/strategy-desk/runs?scenarioId=${encodeURIComponent(
          selectedScenarioId,
        )}&limit=20`,
        authHeader: auth.adminAuthHeader,
      }),
      requestWorkerJson({
        path: `/api/admin/ops/runtime/strategy-desk/reports?scenarioId=${encodeURIComponent(
          selectedScenarioId,
        )}&limit=20`,
        authHeader: auth.adminAuthHeader,
      }),
      requestWorkerJson({
        path: `/api/admin/ops/runtime/strategy-desk/handoffs?scenarioId=${encodeURIComponent(
          selectedScenarioId,
        )}&limit=20`,
        authHeader: auth.adminAuthHeader,
      }),
    ]);

    if (runsResult.status !== 200 || runsResult.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(runsResult.payload.error) ??
            "strategy-desk-runs-load-failed",
        },
        { status: runsResult.status || 502 },
      );
    }
    if (reportsResult.status !== 200 || reportsResult.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(reportsResult.payload.error) ??
            "strategy-desk-reports-load-failed",
        },
        { status: reportsResult.status || 502 },
      );
    }
    runs = parseRuns(runsResult.payload.runs);
    reports = parseReports(reportsResult.payload.reports);
    if (handoffsResult.status === 200 && handoffsResult.payload.ok === true) {
      handoffs = parseHandoffs(handoffsResult.payload.handoffs);
    }
    const latestHandoffSummary = latestByTimestamp(handoffs, "updatedAt");
    const activeHandoffSummary = selectedScenario?.activeHandoffId
      ? (handoffs.find(
          (handoff) => handoff.handoffId === selectedScenario.activeHandoffId,
        ) ?? null)
      : null;
    latestHandoff = latestHandoffSummary;
    activeHandoff = activeHandoffSummary;

    const detailHandoff = activeHandoffSummary ?? latestHandoffSummary;
    if (detailHandoff) {
      const detailResult = await requestWorkerJson({
        path: `/api/admin/ops/runtime/strategy-desk/handoffs/${encodeURIComponent(
          detailHandoff.handoffId,
        )}`,
        authHeader: auth.adminAuthHeader,
      });
      if (detailResult.status === 200 && detailResult.payload.ok === true) {
        const parsed = safeParseRuntimeStrategyDeskPromotionHandoff(
          detailResult.payload.handoff,
        );
        if (parsed.success) {
          if (activeHandoffSummary?.handoffId === parsed.data.handoffId) {
            activeHandoff = parsed.data;
          }
          if (latestHandoffSummary?.handoffId === parsed.data.handoffId) {
            latestHandoff = parsed.data;
          }
        }
        handoffEvents = parseHandoffEvents(detailResult.payload.events);
        executionRecipes = parseExecutionRecipes(
          detailResult.payload.executionRecipes,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    snapshot: {
      scenarios,
      selectedScenarioId,
      selectedScenario,
      runs,
      reports,
      handoffs,
      activeHandoff,
      latestHandoff,
      handoffEvents,
      executionRecipes,
      latestRun: latestByTimestamp(runs, "updatedAt"),
      latestReport: latestByTimestamp(reports, "generatedAt"),
    },
  });
}

export async function POST(request: Request) {
  const auth = await ensureAuthorizedOperator(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as unknown;
  if (!isRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "strategy-desk-invalid-body" },
      { status: 400 },
    );
  }

  const action = readString(body.action);
  if (action === "upsert_scenario") {
    const parsed = safeParseRuntimeStrategyDeskScenarioManifest(body.scenario);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: "/api/admin/ops/runtime/strategy-desk/scenarios",
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: parsed.data,
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-upsert-scenario-failed",
        },
        { status: result.status || 502 },
      );
    }
    const scenario = safeParseRuntimeStrategyDeskScenarioManifest(
      result.payload.scenario,
    );
    if (!scenario.success) {
      return NextResponse.json(
        { ok: false, error: scenario.error },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      scenario: scenario.data,
    });
  }

  if (action === "execute_scenario") {
    const parsed = parseExecutePayload(body);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-execute-invalid" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/strategy-desk/scenarios/${encodeURIComponent(
        parsed.scenarioId,
      )}/execute`,
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: {
        runKind: parsed.runKind,
        requestedBy: parsed.requestedBy,
        walletAddress: parsed.walletAddress,
        ...(parsed.trigger ? { trigger: parsed.trigger } : {}),
        ...(parsed.maxRetriesPerLeg !== undefined
          ? { maxRetriesPerLeg: parsed.maxRetriesPerLeg }
          : {}),
      },
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-execute-scenario-failed",
        },
        { status: result.status || 502 },
      );
    }
    const scenario = safeParseRuntimeStrategyDeskScenarioManifest(
      result.payload.scenario,
    );
    const run = safeParseRuntimeStrategyDeskScenarioRun(result.payload.run);
    const report = safeParseRuntimeStrategyDeskScenarioReport(
      result.payload.report,
    );
    if (!scenario.success || !run.success || !report.success) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-execute-response-invalid" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      scenario: scenario.data,
      run: run.data,
      report: report.data,
    });
  }

  if (action === "study_scenario") {
    const parsed = parseStudyPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-study-invalid" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/strategy-desk/scenarios/${encodeURIComponent(
        parsed.scenarioId,
      )}/study`,
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: {
        runKind: parsed.runKind,
        requestedBy: parsed.requestedBy,
        ...(parsed.selectionMetric
          ? { selectionMetric: parsed.selectionMetric }
          : {}),
        ...(parsed.variantIds ? { variantIds: parsed.variantIds } : {}),
        ...(parsed.windowIds ? { windowIds: parsed.windowIds } : {}),
      },
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-study-scenario-failed",
        },
        { status: result.status || 502 },
      );
    }
    const scenario = safeParseRuntimeStrategyDeskScenarioManifest(
      result.payload.scenario,
    );
    const run = safeParseRuntimeStrategyDeskScenarioRun(result.payload.run);
    const report = safeParseRuntimeStrategyDeskScenarioReport(
      result.payload.report,
    );
    if (!scenario.success || !run.success || !report.success) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-study-response-invalid" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      scenario: scenario.data,
      run: run.data,
      report: report.data,
    });
  }

  if (action === "prepare_handoff") {
    const parsed = parsePrepareHandoffPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-handoff-prepare-invalid" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/strategy-desk/scenarios/${encodeURIComponent(
        parsed.scenarioId,
      )}/handoffs/prepare`,
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: {
        requestedBy: parsed.requestedBy,
        ...(parsed.targetMode ? { targetMode: parsed.targetMode } : {}),
      },
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-handoff-prepare-failed",
        },
        { status: result.status || 502 },
      );
    }
    const scenario = safeParseRuntimeStrategyDeskScenarioManifest(
      result.payload.scenario,
    );
    const handoff = safeParseRuntimeStrategyDeskPromotionHandoff(
      result.payload.handoff,
    );
    if (!scenario.success || !handoff.success) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-handoff-prepare-response-invalid" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      scenario: scenario.data,
      handoff: handoff.data,
      events: parseHandoffEvents(result.payload.events),
      executionRecipes: parseExecutionRecipes(result.payload.executionRecipes),
    });
  }

  if (action === "transition_handoff") {
    const parsed = parseTransitionHandoffPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "strategy-desk-handoff-transition-invalid" },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: `/api/admin/ops/runtime/strategy-desk/handoffs/${encodeURIComponent(
        parsed.handoffId,
      )}/transition`,
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: {
        action: parsed.handoffAction,
        actor: parsed.actor,
        ...(parsed.notes ? { notes: parsed.notes } : {}),
      },
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-handoff-transition-failed",
        },
        { status: result.status || 502 },
      );
    }
    const scenario = safeParseRuntimeStrategyDeskScenarioManifest(
      result.payload.scenario,
    );
    const handoff = safeParseRuntimeStrategyDeskPromotionHandoff(
      result.payload.handoff,
    );
    if (!scenario.success || !handoff.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "strategy-desk-handoff-transition-response-invalid",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      scenario: scenario.data,
      handoff: handoff.data,
      events: parseHandoffEvents(result.payload.events),
      executionRecipes: parseExecutionRecipes(result.payload.executionRecipes),
    });
  }

  if (action === "upsert_handoff") {
    const parsed = safeParseRuntimeStrategyDeskPromotionHandoff(body.handoff);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: 400 },
      );
    }
    const result = await requestWorkerJson({
      path: "/api/admin/ops/runtime/strategy-desk/handoffs",
      method: "POST",
      authHeader: auth.adminAuthHeader,
      body: parsed.data,
    });
    if (result.status !== 200 || result.payload.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            readString(result.payload.error) ??
            "strategy-desk-handoff-upsert-failed",
        },
        { status: result.status || 502 },
      );
    }
    const handoff = safeParseRuntimeStrategyDeskPromotionHandoff(
      result.payload.handoff,
    );
    if (!handoff.success) {
      return NextResponse.json(
        { ok: false, error: handoff.error },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      handoff: handoff.data,
    });
  }

  return NextResponse.json(
    { ok: false, error: "strategy-desk-action-unsupported" },
    { status: 400 },
  );
}
