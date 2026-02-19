import type { Env } from "../types";
import type {
  BacktestListItem,
  BacktestRunEvent,
  BacktestRunRequest,
  BacktestRunRow,
  BacktestRunStatus,
  BacktestRunSummary,
  StrategyJsonBacktestSpec,
} from "./types";

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseRequest(value: unknown): BacktestRunRequest {
  const parsed = parseJsonRecord(value);
  if (!parsed) {
    return {
      kind: "validation",
    };
  }
  if (parsed.kind === "strategy_json") {
    const spec =
      parsed.spec &&
      typeof parsed.spec === "object" &&
      !Array.isArray(parsed.spec)
        ? (parsed.spec as StrategyJsonBacktestSpec)
        : ({
            strategy: { type: "noop" },
            market: {
              baseMint: "",
              quoteMint: "",
            },
          } as StrategyJsonBacktestSpec);
    return {
      kind: "strategy_json",
      spec,
    };
  }
  const fixturePatternRaw = String(parsed.fixturePattern ?? "").trim();
  const fixturePattern =
    fixturePatternRaw === "uptrend" ||
    fixturePatternRaw === "downtrend" ||
    fixturePatternRaw === "whipsaw"
      ? fixturePatternRaw
      : undefined;
  return {
    kind: "validation",
    fixturePattern,
  };
}

function parseSummary(value: unknown): BacktestRunSummary | null {
  const parsed = parseJsonRecord(value);
  if (!parsed) return null;
  const strategyLabel = String(parsed.strategyLabel ?? "").trim();
  const netReturnPct = Number(parsed.netReturnPct);
  const maxDrawdownPct = Number(parsed.maxDrawdownPct);
  const tradeCount = Number(parsed.tradeCount);
  if (
    !strategyLabel ||
    !Number.isFinite(netReturnPct) ||
    !Number.isFinite(maxDrawdownPct)
  ) {
    return null;
  }
  return {
    strategyLabel,
    netReturnPct,
    maxDrawdownPct,
    tradeCount: Number.isFinite(tradeCount) ? tradeCount : 0,
    validationStatus:
      parsed.validationStatus === "passed" ||
      parsed.validationStatus === "failed"
        ? parsed.validationStatus
        : undefined,
  };
}

function mapRunRow(row: Record<string, unknown>): BacktestRunRow {
  const rawStatus = String(row.status ?? "failed");
  const status: BacktestRunStatus =
    rawStatus === "queued" ||
    rawStatus === "running" ||
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "canceled"
      ? rawStatus
      : "failed";

  return {
    id: Number(row.id ?? 0),
    runId: String(row.runId ?? ""),
    tenantId: String(row.tenantId ?? ""),
    status,
    kind: row.kind === "strategy_json" ? "strategy_json" : "validation",
    request: parseRequest(row.requestJson),
    summary: parseSummary(row.summaryJson),
    resultRef: row.resultRef ? String(row.resultRef) : null,
    errorCode: row.errorCode ? String(row.errorCode) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    queuedAt: String(row.queuedAt ?? ""),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    completedAt: row.completedAt ? String(row.completedAt) : null,
    createdAt: String(row.createdAt ?? ""),
  };
}

function mapEventRow(row: Record<string, unknown>): BacktestRunEvent {
  const levelRaw = String(row.level ?? "info");
  const level =
    levelRaw === "debug" ||
    levelRaw === "info" ||
    levelRaw === "warn" ||
    levelRaw === "error"
      ? levelRaw
      : "info";

  return {
    id: Number(row.id ?? 0),
    runId: String(row.runId ?? ""),
    tenantId: String(row.tenantId ?? ""),
    level,
    message: String(row.message ?? ""),
    meta: parseJsonRecord(row.metaJson),
    createdAt: String(row.createdAt ?? ""),
  };
}

export async function enqueueBacktestRun(
  env: Env,
  input: {
    runId: string;
    tenantId: string;
    kind: "validation" | "strategy_json";
    request: BacktestRunRequest;
    queuedAt?: string;
  },
): Promise<BacktestRunRow> {
  const queuedAt = input.queuedAt ?? new Date().toISOString();
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO backtest_runs (
      run_id,
      tenant_id,
      status,
      kind,
      request_json,
      queued_at,
      created_at
    ) VALUES (?1, ?2, 'queued', ?3, ?4, ?5, datetime('now'))
    `,
  )
    .bind(
      input.runId,
      input.tenantId,
      input.kind,
      JSON.stringify(input.request),
      queuedAt,
    )
    .run();

  const created = await getBacktestRun(env, input.tenantId, input.runId);
  if (!created) throw new Error("backtest-run-create-failed");
  return created;
}

export async function getBacktestRun(
  env: Env,
  tenantId: string,
  runId: string,
): Promise<BacktestRunRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      run_id as runId,
      tenant_id as tenantId,
      status,
      kind,
      request_json as requestJson,
      summary_json as summaryJson,
      result_ref as resultRef,
      error_code as errorCode,
      error_message as errorMessage,
      queued_at as queuedAt,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    FROM backtest_runs
    WHERE tenant_id = ?1 AND run_id = ?2
    LIMIT 1
    `,
  )
    .bind(tenantId, runId)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapRunRow(row as Record<string, unknown>);
}

export async function listBacktestRuns(
  env: Env,
  tenantId: string,
  opts?: {
    limit?: number;
    status?: BacktestRunStatus;
  },
): Promise<BacktestListItem[]> {
  const limit = Math.max(
    1,
    Math.min(200, Math.floor(Number(opts?.limit ?? 20) || 20)),
  );
  const status = opts?.status;
  const params: unknown[] = [tenantId, limit];
  let where = "tenant_id = ?1";

  if (status) {
    where += " AND status = ?3";
    params.push(status);
  }

  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      run_id as runId,
      tenant_id as tenantId,
      status,
      kind,
      request_json as requestJson,
      summary_json as summaryJson,
      result_ref as resultRef,
      error_code as errorCode,
      error_message as errorMessage,
      queued_at as queuedAt,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    FROM backtest_runs
    WHERE ${where}
    ORDER BY id DESC
    LIMIT ?2
    `,
  )
    .bind(...params)
    .all();

  const runs = (result.results ?? []).map((row) =>
    mapRunRow(row as Record<string, unknown>),
  );

  return runs.map((run) => ({
    runId: run.runId,
    status: run.status,
    kind: run.kind,
    strategyLabel: run.summary?.strategyLabel ?? strategyLabelFromRun(run),
    summary: run.summary
      ? {
          netReturnPct: run.summary.netReturnPct,
          maxDrawdownPct: run.summary.maxDrawdownPct,
          tradeCount: run.summary.tradeCount,
        }
      : null,
    validationStatus: run.summary?.validationStatus,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
  }));
}

function strategyLabelFromRun(run: BacktestRunRow): string {
  if (run.kind === "validation") return "validation";
  const strategy =
    run.request.kind === "strategy_json" && run.request.spec?.strategy
      ? run.request.spec.strategy
      : null;
  const strategyType =
    strategy && typeof strategy === "object" && !Array.isArray(strategy)
      ? String((strategy as Record<string, unknown>).type ?? "strategy_json")
      : "strategy_json";
  return strategyType || "strategy_json";
}

export async function listBacktestRunEvents(
  env: Env,
  tenantId: string,
  runId: string,
  limit = 100,
): Promise<BacktestRunEvent[]> {
  const capped = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      run_id as runId,
      tenant_id as tenantId,
      level,
      message,
      meta_json as metaJson,
      created_at as createdAt
    FROM backtest_run_events
    WHERE tenant_id = ?1 AND run_id = ?2
    ORDER BY id DESC
    LIMIT ?3
    `,
  )
    .bind(tenantId, runId, capped)
    .all();

  return (result.results ?? [])
    .map((row) => mapEventRow(row as Record<string, unknown>))
    .reverse();
}

export async function appendBacktestRunEvent(
  env: Env,
  input: {
    runId: string;
    tenantId: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO backtest_run_events (
      run_id,
      tenant_id,
      level,
      message,
      meta_json,
      created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
    `,
  )
    .bind(
      input.runId,
      input.tenantId,
      input.level,
      input.message,
      input.meta ? JSON.stringify(input.meta) : null,
    )
    .run();
}

export async function claimNextQueuedBacktestRun(
  env: Env,
  tenantId: string,
): Promise<BacktestRunRow | null> {
  const startedAt = new Date().toISOString();
  const row = (await env.WAITLIST_DB.prepare(
    `
    UPDATE backtest_runs
    SET status = 'running',
        started_at = ?2,
        error_code = NULL,
        error_message = NULL
    WHERE id = (
      SELECT id
      FROM backtest_runs
      WHERE tenant_id = ?1 AND status = 'queued'
      ORDER BY id ASC
      LIMIT 1
    )
    RETURNING
      id,
      run_id as runId,
      tenant_id as tenantId,
      status,
      kind,
      request_json as requestJson,
      summary_json as summaryJson,
      result_ref as resultRef,
      error_code as errorCode,
      error_message as errorMessage,
      queued_at as queuedAt,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    `,
  )
    .bind(tenantId, startedAt)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapRunRow(row as Record<string, unknown>);
}

export async function completeBacktestRun(
  env: Env,
  input: {
    tenantId: string;
    runId: string;
    summary: BacktestRunSummary;
    resultRef?: string | null;
    completedAt?: string;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    UPDATE backtest_runs
    SET status = 'completed',
        summary_json = ?3,
        result_ref = ?4,
        completed_at = ?5,
        error_code = NULL,
        error_message = NULL
    WHERE tenant_id = ?1 AND run_id = ?2
    `,
  )
    .bind(
      input.tenantId,
      input.runId,
      JSON.stringify(input.summary),
      input.resultRef ?? null,
      input.completedAt ?? new Date().toISOString(),
    )
    .run();
}

export async function failBacktestRun(
  env: Env,
  input: {
    tenantId: string;
    runId: string;
    errorCode: string;
    errorMessage: string;
    completedAt?: string;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    UPDATE backtest_runs
    SET status = 'failed',
        error_code = ?3,
        error_message = ?4,
        completed_at = ?5
    WHERE tenant_id = ?1 AND run_id = ?2
    `,
  )
    .bind(
      input.tenantId,
      input.runId,
      input.errorCode,
      input.errorMessage,
      input.completedAt ?? new Date().toISOString(),
    )
    .run();
}

export async function countBacktestRunsByStatus(
  env: Env,
  tenantId: string,
  statuses: BacktestRunStatus[],
): Promise<number> {
  const allowed = statuses.filter(
    (status) =>
      status === "queued" ||
      status === "running" ||
      status === "completed" ||
      status === "failed" ||
      status === "canceled",
  );
  if (allowed.length < 1) return 0;

  const placeholders = allowed.map((_, idx) => `?${idx + 2}`).join(",");
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT COUNT(*) as count
    FROM backtest_runs
    WHERE tenant_id = ?1 AND status IN (${placeholders})
    `,
  )
    .bind(tenantId, ...allowed)
    .first()) as unknown;

  if (!row || typeof row !== "object") return 0;
  const count = Number((row as Record<string, unknown>).count ?? 0);
  return Number.isFinite(count) ? count : 0;
}
