import type { Env } from "../types";

export type BotRunLifecycleState =
  | "idle"
  | "starting"
  | "running"
  | "blocked_inference"
  | "stopped"
  | "error";

export type BotRunStateRow = {
  botId: string;
  state: BotRunLifecycleState;
  blockedReason: string | null;
  currentRunId: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  providerBaseUrlHash: string | null;
  providerModel: string | null;
  providerPingAgeMs: number | null;
  resolutionSource: "bot_config" | null;
  steeringLastAppliedId: number | null;
  compactedAt: string | null;
  compactedCount: number;
  messageWindowCount: number;
  updatedAt: string;
};

export type SteeringMessageRow = {
  id: number;
  botId: string;
  message: string;
  status: "pending" | "applied" | "canceled";
  queuedAt: string;
  appliedAt: string | null;
  appliedRunId: string | null;
};

function toIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function toTextOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mapRunStateRow(row: unknown): BotRunStateRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const rawState = String(r.state ?? "").trim();
  const state: BotRunLifecycleState =
    rawState === "idle" ||
    rawState === "starting" ||
    rawState === "running" ||
    rawState === "blocked_inference" ||
    rawState === "stopped" ||
    rawState === "error"
      ? rawState
      : "idle";
  return {
    botId: String(r.botId ?? ""),
    state,
    blockedReason: toTextOrNull(r.blockedReason),
    currentRunId: toTextOrNull(r.currentRunId),
    lastTickAt: toTextOrNull(r.lastTickAt),
    nextTickAt: toTextOrNull(r.nextTickAt),
    providerBaseUrlHash: toTextOrNull(r.providerBaseUrlHash),
    providerModel: toTextOrNull(r.providerModel),
    providerPingAgeMs: toIntOrNull(r.providerPingAgeMs),
    resolutionSource:
      String(r.resolutionSource ?? "").trim() === "bot_config"
        ? "bot_config"
        : null,
    steeringLastAppliedId: toIntOrNull(r.steeringLastAppliedId),
    compactedAt: toTextOrNull(r.compactedAt),
    compactedCount: Math.max(0, toIntOrNull(r.compactedCount) ?? 0),
    messageWindowCount: Math.max(0, toIntOrNull(r.messageWindowCount) ?? 0),
    updatedAt: String(r.updatedAt ?? ""),
  };
}

function mapSteeringRow(row: unknown): SteeringMessageRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const rawStatus = String(r.status ?? "").trim();
  const status =
    rawStatus === "pending" ||
    rawStatus === "applied" ||
    rawStatus === "canceled"
      ? rawStatus
      : "pending";
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;
  return {
    id: Math.trunc(id),
    botId: String(r.botId ?? ""),
    message: String(r.message ?? ""),
    status,
    queuedAt: String(r.queuedAt ?? ""),
    appliedAt: toTextOrNull(r.appliedAt),
    appliedRunId: toTextOrNull(r.appliedRunId),
  };
}

export async function upsertBotRunState(
  env: Env,
  input: {
    botId: string;
    state: BotRunLifecycleState;
    blockedReason?: string | null;
    currentRunId?: string | null;
    lastTickAt?: string | null;
    nextTickAt?: string | null;
    providerBaseUrlHash?: string | null;
    providerModel?: string | null;
    providerPingAgeMs?: number | null;
    resolutionSource?: "bot_config" | null;
    steeringLastAppliedId?: number | null;
    compactedAt?: string | null;
    compactedCount?: number | null;
    messageWindowCount?: number | null;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bot_run_state (
      bot_id,
      state,
      blocked_reason,
      current_run_id,
      last_tick_at,
      next_tick_at,
      provider_base_url_hash,
      provider_model,
      provider_ping_age_ms,
      resolution_source,
      steering_last_applied_id,
      compacted_at,
      compacted_count,
      message_window_count,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, datetime('now'))
    ON CONFLICT(bot_id) DO UPDATE SET
      state = excluded.state,
      blocked_reason = excluded.blocked_reason,
      current_run_id = excluded.current_run_id,
      last_tick_at = COALESCE(excluded.last_tick_at, bot_run_state.last_tick_at),
      next_tick_at = excluded.next_tick_at,
      provider_base_url_hash = excluded.provider_base_url_hash,
      provider_model = excluded.provider_model,
      provider_ping_age_ms = excluded.provider_ping_age_ms,
      resolution_source = excluded.resolution_source,
      steering_last_applied_id = COALESCE(excluded.steering_last_applied_id, bot_run_state.steering_last_applied_id),
      compacted_at = COALESCE(excluded.compacted_at, bot_run_state.compacted_at),
      compacted_count = COALESCE(excluded.compacted_count, bot_run_state.compacted_count),
      message_window_count = COALESCE(excluded.message_window_count, bot_run_state.message_window_count),
      updated_at = datetime('now')
    `,
  )
    .bind(
      input.botId,
      input.state,
      input.blockedReason ?? null,
      input.currentRunId ?? null,
      input.lastTickAt ?? null,
      input.nextTickAt ?? null,
      input.providerBaseUrlHash ?? null,
      input.providerModel ?? null,
      Number.isFinite(input.providerPingAgeMs ?? Number.NaN)
        ? Math.max(0, Math.trunc(input.providerPingAgeMs ?? 0))
        : null,
      input.resolutionSource ?? null,
      Number.isFinite(input.steeringLastAppliedId ?? Number.NaN)
        ? Math.max(0, Math.trunc(input.steeringLastAppliedId ?? 0))
        : null,
      input.compactedAt ?? null,
      Number.isFinite(input.compactedCount ?? Number.NaN)
        ? Math.max(0, Math.trunc(input.compactedCount ?? 0))
        : null,
      Number.isFinite(input.messageWindowCount ?? Number.NaN)
        ? Math.max(0, Math.trunc(input.messageWindowCount ?? 0))
        : null,
    )
    .run();
}

export async function getBotRunState(
  env: Env,
  botId: string,
): Promise<BotRunStateRow | null> {
  const row = await env.WAITLIST_DB.prepare(
    `
    SELECT
      bot_id as botId,
      state,
      blocked_reason as blockedReason,
      current_run_id as currentRunId,
      last_tick_at as lastTickAt,
      next_tick_at as nextTickAt,
      provider_base_url_hash as providerBaseUrlHash,
      provider_model as providerModel,
      provider_ping_age_ms as providerPingAgeMs,
      resolution_source as resolutionSource,
      steering_last_applied_id as steeringLastAppliedId,
      compacted_at as compactedAt,
      compacted_count as compactedCount,
      message_window_count as messageWindowCount,
      updated_at as updatedAt
    FROM bot_run_state
    WHERE bot_id = ?1
    `,
  )
    .bind(botId)
    .first();
  return mapRunStateRow(row);
}

export async function enqueueSteeringMessage(
  env: Env,
  input: {
    botId: string;
    message: string;
  },
): Promise<{ queueId: number; queuePosition: number }> {
  const message = input.message.trim();
  if (!message) throw new Error("invalid-steering-message");
  if (message.length > 2000) throw new Error("invalid-steering-message");

  const result = await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bot_steering_messages (
      bot_id,
      message,
      status,
      queued_at
    )
    VALUES (?1, ?2, 'pending', datetime('now'))
    `,
  )
    .bind(input.botId, message)
    .run();

  const queueIdRaw = (result.meta as { last_row_id?: unknown } | undefined)
    ?.last_row_id;
  const queueId = Number(queueIdRaw);
  const safeQueueId = Number.isFinite(queueId) ? Math.trunc(queueId) : 0;

  const row = await env.WAITLIST_DB.prepare(
    `
    SELECT COUNT(*) as pendingCount
    FROM bot_steering_messages
    WHERE bot_id = ?1 AND status = 'pending'
    `,
  )
    .bind(input.botId)
    .first();

  const pendingCount = Number(
    (row as Record<string, unknown> | null)?.pendingCount ?? 0,
  );
  return {
    queueId: safeQueueId,
    queuePosition: Number.isFinite(pendingCount)
      ? Math.max(1, Math.trunc(pendingCount))
      : 1,
  };
}

export async function listSteeringMessages(
  env: Env,
  botId: string,
  limit = 50,
): Promise<SteeringMessageRow[]> {
  const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      bot_id as botId,
      message,
      status,
      queued_at as queuedAt,
      applied_at as appliedAt,
      applied_run_id as appliedRunId
    FROM bot_steering_messages
    WHERE bot_id = ?1
    ORDER BY id DESC
    LIMIT ?2
    `,
  )
    .bind(botId, bounded)
    .all();

  const out: SteeringMessageRow[] = [];
  for (const row of rows.results ?? []) {
    const mapped = mapSteeringRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function listPendingSteeringMessages(
  env: Env,
  botId: string,
  limit = 20,
): Promise<SteeringMessageRow[]> {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      bot_id as botId,
      message,
      status,
      queued_at as queuedAt,
      applied_at as appliedAt,
      applied_run_id as appliedRunId
    FROM bot_steering_messages
    WHERE bot_id = ?1
      AND status = 'pending'
    ORDER BY id ASC
    LIMIT ?2
    `,
  )
    .bind(botId, bounded)
    .all();
  const out: SteeringMessageRow[] = [];
  for (const row of rows.results ?? []) {
    const mapped = mapSteeringRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function markSteeringMessagesApplied(
  env: Env,
  input: {
    botId: string;
    ids: number[];
    runId: string;
    appliedAt?: string;
  },
): Promise<number | null> {
  const ids = input.ids
    .map((id) => Math.trunc(Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return null;
  const appliedAt = input.appliedAt ?? new Date().toISOString();

  const placeholders = ids.map((_, i) => `?${i + 4}`).join(", ");
  await env.WAITLIST_DB.prepare(
    `
    UPDATE bot_steering_messages
    SET
      status = 'applied',
      applied_at = ?1,
      applied_run_id = ?2
    WHERE bot_id = ?3
      AND id IN (${placeholders})
      AND status = 'pending'
    `,
  )
    .bind(appliedAt, input.runId, input.botId, ...ids)
    .run();

  return ids[ids.length - 1] ?? null;
}

export async function countPendingSteeringMessages(
  env: Env,
  botId: string,
): Promise<number> {
  const row = await env.WAITLIST_DB.prepare(
    `
    SELECT COUNT(*) as pendingCount
    FROM bot_steering_messages
    WHERE bot_id = ?1 AND status = 'pending'
    `,
  )
    .bind(botId)
    .first();
  const value = Number(
    (row as Record<string, unknown> | null)?.pendingCount ?? 0,
  );
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
