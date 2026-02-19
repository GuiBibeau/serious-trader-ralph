import type { Env, LoopConfig, StrategyRuntimeStateRow } from "../types";
import { runtimeDefault } from "./state_machine";

export type ValidationRunStatus = "running" | "passed" | "failed";

export type StrategyValidationRun = {
  id: number;
  tenantId: string;
  strategyHash: string;
  strategyType: string;
  lookbackDays: number;
  profile: string;
  status: ValidationRunStatus;
  metrics: Record<string, unknown> | null;
  thresholds: Record<string, unknown> | null;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type StrategyEventRow = {
  id: number;
  tenantId: string;
  eventType: string;
  actor: string;
  reason: string | null;
  beforeConfig: Record<string, unknown> | null;
  afterConfig: Record<string, unknown> | null;
  validationId: number | null;
  createdAt: string;
};

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
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

function mapValidationRun(row: Record<string, unknown>): StrategyValidationRun {
  return {
    id: Number(row.id),
    tenantId: String(row.tenantId ?? ""),
    strategyHash: String(row.strategyHash ?? ""),
    strategyType: String(row.strategyType ?? ""),
    lookbackDays: Number(row.lookbackDays ?? 0),
    profile: String(row.profile ?? ""),
    status: String(row.status ?? "failed") as ValidationRunStatus,
    metrics: parseJsonRecord(row.metricsJson),
    thresholds: parseJsonRecord(row.thresholdsJson),
    summary: row.summary ? String(row.summary) : null,
    startedAt: String(row.startedAt ?? ""),
    completedAt: row.completedAt ? String(row.completedAt) : null,
    createdAt: String(row.createdAt ?? ""),
  };
}

export async function createValidationRun(
  env: Env,
  input: {
    tenantId: string;
    strategyHash: string;
    strategyType: string;
    lookbackDays: number;
    profile: string;
    startedAt?: string;
  },
): Promise<number> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const inserted = (await env.WAITLIST_DB.prepare(
    `
    INSERT INTO strategy_validations (
      tenant_id,
      strategy_hash,
      strategy_type,
      lookback_days,
      profile,
      status,
      started_at,
      created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, datetime('now'))
    RETURNING id
    `,
  )
    .bind(
      input.tenantId,
      input.strategyHash,
      input.strategyType,
      input.lookbackDays,
      input.profile,
      startedAt,
    )
    .first()) as unknown;

  const idFromReturning =
    inserted &&
    typeof inserted === "object" &&
    Number.isFinite(Number((inserted as Record<string, unknown>).id))
      ? Number((inserted as Record<string, unknown>).id)
      : 0;
  if (idFromReturning > 0) return idFromReturning;

  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT id
    FROM strategy_validations
    WHERE tenant_id = ?1
    ORDER BY id DESC
    LIMIT 1
    `,
  )
    .bind(input.tenantId)
    .first();

  const fallback = Number((result as { id?: unknown } | null)?.id ?? 0);
  if (fallback > 0) return fallback;
  throw new Error("validation-run-create-failed");
}

export async function completeValidationRun(
  env: Env,
  input: {
    id: number;
    status: Extract<ValidationRunStatus, "passed" | "failed">;
    metrics: Record<string, unknown>;
    thresholds: Record<string, unknown>;
    summary: string;
    completedAt?: string;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    UPDATE strategy_validations
    SET status = ?1,
        metrics_json = ?2,
        thresholds_json = ?3,
        summary = ?4,
        completed_at = ?5
    WHERE id = ?6
    `,
  )
    .bind(
      input.status,
      JSON.stringify(input.metrics ?? {}),
      JSON.stringify(input.thresholds ?? {}),
      input.summary,
      input.completedAt ?? new Date().toISOString(),
      input.id,
    )
    .run();
}

export async function getLatestValidationForHash(
  env: Env,
  tenantId: string,
  strategyHash: string,
): Promise<StrategyValidationRun | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      tenant_id as tenantId,
      strategy_hash as strategyHash,
      strategy_type as strategyType,
      lookback_days as lookbackDays,
      profile,
      status,
      metrics_json as metricsJson,
      thresholds_json as thresholdsJson,
      summary,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    FROM strategy_validations
    WHERE tenant_id = ?1 AND strategy_hash = ?2
    ORDER BY id DESC
    LIMIT 1
    `,
  )
    .bind(tenantId, strategyHash)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapValidationRun(row as Record<string, unknown>);
}

export async function getLatestValidation(
  env: Env,
  tenantId: string,
): Promise<StrategyValidationRun | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      tenant_id as tenantId,
      strategy_hash as strategyHash,
      strategy_type as strategyType,
      lookback_days as lookbackDays,
      profile,
      status,
      metrics_json as metricsJson,
      thresholds_json as thresholdsJson,
      summary,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    FROM strategy_validations
    WHERE tenant_id = ?1
    ORDER BY id DESC
    LIMIT 1
    `,
  )
    .bind(tenantId)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapValidationRun(row as Record<string, unknown>);
}

export async function listValidationRuns(
  env: Env,
  tenantId: string,
  limit = 20,
): Promise<StrategyValidationRun[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      tenant_id as tenantId,
      strategy_hash as strategyHash,
      strategy_type as strategyType,
      lookback_days as lookbackDays,
      profile,
      status,
      metrics_json as metricsJson,
      thresholds_json as thresholdsJson,
      summary,
      started_at as startedAt,
      completed_at as completedAt,
      created_at as createdAt
    FROM strategy_validations
    WHERE tenant_id = ?1
    ORDER BY id DESC
    LIMIT ?2
    `,
  )
    .bind(tenantId, capped)
    .all();

  return (result.results ?? []).map((row) =>
    mapValidationRun(row as Record<string, unknown>),
  );
}

export async function getRuntimeState(
  env: Env,
  tenantId: string,
): Promise<StrategyRuntimeStateRow> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      tenant_id as tenantId,
      lifecycle_state as lifecycleState,
      active_strategy_hash as activeStrategyHash,
      last_validation_id as lastValidationId,
      consecutive_failures as consecutiveFailures,
      last_tuned_at as lastTunedAt,
      next_revalidate_at as nextRevalidateAt,
      updated_at as updatedAt
    FROM strategy_runtime_state
    WHERE tenant_id = ?1
    `,
  )
    .bind(tenantId)
    .first()) as unknown;

  if (!row || typeof row !== "object") {
    const def = runtimeDefault(tenantId);
    await upsertRuntimeState(env, tenantId, def);
    return def;
  }

  const r = row as Record<string, unknown>;
  const rawLastValidationId = r.lastValidationId;
  return {
    tenantId,
    lifecycleState: String(
      r.lifecycleState ?? "candidate",
    ) as StrategyRuntimeStateRow["lifecycleState"],
    activeStrategyHash: r.activeStrategyHash
      ? String(r.activeStrategyHash)
      : null,
    lastValidationId:
      rawLastValidationId === null || rawLastValidationId === undefined
        ? null
        : Number.isFinite(Number(rawLastValidationId))
          ? Number(rawLastValidationId)
          : null,
    consecutiveFailures: Number(r.consecutiveFailures ?? 0),
    lastTunedAt: r.lastTunedAt ? String(r.lastTunedAt) : null,
    nextRevalidateAt: r.nextRevalidateAt ? String(r.nextRevalidateAt) : null,
    updatedAt: String(r.updatedAt ?? new Date().toISOString()),
  };
}

async function upsertRuntimeState(
  env: Env,
  tenantId: string,
  state: StrategyRuntimeStateRow,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO strategy_runtime_state (
      tenant_id,
      lifecycle_state,
      active_strategy_hash,
      last_validation_id,
      consecutive_failures,
      last_tuned_at,
      next_revalidate_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(tenant_id) DO UPDATE SET
      lifecycle_state = excluded.lifecycle_state,
      active_strategy_hash = excluded.active_strategy_hash,
      last_validation_id = excluded.last_validation_id,
      consecutive_failures = excluded.consecutive_failures,
      last_tuned_at = excluded.last_tuned_at,
      next_revalidate_at = excluded.next_revalidate_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      tenantId,
      state.lifecycleState,
      state.activeStrategyHash,
      state.lastValidationId,
      state.consecutiveFailures,
      state.lastTunedAt,
      state.nextRevalidateAt,
      state.updatedAt,
    )
    .run();
}

export async function updateRuntimeState(
  env: Env,
  tenantId: string,
  patch: Partial<StrategyRuntimeStateRow>,
): Promise<StrategyRuntimeStateRow> {
  const current = await getRuntimeState(env, tenantId);
  const next: StrategyRuntimeStateRow = {
    ...current,
    ...patch,
    tenantId,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await upsertRuntimeState(env, tenantId, next);
  return next;
}

export async function recordStrategyEvent(
  env: Env,
  input: {
    tenantId: string;
    eventType: string;
    actor: string;
    reason?: string;
    beforeConfig?: LoopConfig | null;
    afterConfig?: LoopConfig | null;
    validationId?: number | null;
  },
): Promise<number> {
  const result = await env.WAITLIST_DB.prepare(
    `
    INSERT INTO strategy_events (
      tenant_id,
      event_type,
      actor,
      reason,
      before_config_json,
      after_config_json,
      validation_id,
      created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
    `,
  )
    .bind(
      input.tenantId,
      input.eventType,
      input.actor,
      input.reason ?? null,
      input.beforeConfig ? JSON.stringify(input.beforeConfig) : null,
      input.afterConfig ? JSON.stringify(input.afterConfig) : null,
      input.validationId ?? null,
    )
    .run();
  return Number(result.meta?.last_row_id ?? 0);
}

export async function listStrategyEvents(
  env: Env,
  tenantId: string,
  limit = 40,
): Promise<StrategyEventRow[]> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      tenant_id as tenantId,
      event_type as eventType,
      actor,
      reason,
      before_config_json as beforeConfigJson,
      after_config_json as afterConfigJson,
      validation_id as validationId,
      created_at as createdAt
    FROM strategy_events
    WHERE tenant_id = ?1
    ORDER BY id DESC
    LIMIT ?2
    `,
  )
    .bind(tenantId, capped)
    .all();

  return (result.results ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const rawValidationId = r.validationId;
    return {
      id: Number(r.id),
      tenantId: String(r.tenantId ?? ""),
      eventType: String(r.eventType ?? ""),
      actor: String(r.actor ?? ""),
      reason: r.reason ? String(r.reason) : null,
      beforeConfig: parseJsonRecord(r.beforeConfigJson),
      afterConfig: parseJsonRecord(r.afterConfigJson),
      validationId:
        rawValidationId === null || rawValidationId === undefined
          ? null
          : Number.isFinite(Number(rawValidationId))
            ? Number(rawValidationId)
            : null,
      createdAt: String(r.createdAt ?? ""),
    };
  });
}
