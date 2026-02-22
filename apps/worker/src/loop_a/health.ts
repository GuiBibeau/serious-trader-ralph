import {
  type Health,
  safeParseHealth,
} from "../../../../src/loops/contracts/loop_a";
import type { Env } from "../types";
import type { LoopAPipelineTickResult } from "./pipeline";
import {
  LOOP_A_SCHEMA_VERSION,
  type LoopACursorHeads,
  type LoopACursorState,
} from "./types";

export const LOOP_A_HEALTH_KEY = `loopA:${LOOP_A_SCHEMA_VERSION}:health`;
export const LOOP_A_LATENCY_LATEST_KEY = `loopA:${LOOP_A_SCHEMA_VERSION}:latency:latest`;

type LoopAHealthTickTrigger =
  | "scheduled"
  | "coordinator_fetch"
  | "coordinator_alarm";

export type LoopALatencyTelemetry = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  generatedAt: string;
  trigger: LoopAHealthTickTrigger;
  ok: boolean;
  tickDurationMs: number;
  stateCommitment?: "processed" | "confirmed" | "finalized";
  stateTargetSlot?: number;
  stateAppliedSlot?: number | null;
  error?: string;
};

type RecordLoopAHealthTickInput = {
  ok: boolean;
  trigger: LoopAHealthTickTrigger;
  startedAtMs: number;
  nowMs?: number;
  observedAt?: string;
  tickResult?: LoopAPipelineTickResult;
  cursorStateFallback?: LoopACursorState;
  error?: unknown;
};

const ZERO_HEADS: LoopACursorHeads = {
  processed: 0,
  confirmed: 0,
  finalized: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseLatencyTelemetry(input: unknown): LoopALatencyTelemetry | null {
  const record = asRecord(input);
  if (!record) return null;
  if (record.schemaVersion !== LOOP_A_SCHEMA_VERSION) return null;
  if (
    record.generatedAt === undefined ||
    typeof record.generatedAt !== "string" ||
    Number.isNaN(Date.parse(record.generatedAt))
  ) {
    return null;
  }
  if (
    record.trigger !== "scheduled" &&
    record.trigger !== "coordinator_fetch" &&
    record.trigger !== "coordinator_alarm"
  ) {
    return null;
  }
  if (typeof record.ok !== "boolean") return null;
  if (
    typeof record.tickDurationMs !== "number" ||
    !Number.isFinite(record.tickDurationMs) ||
    record.tickDurationMs < 0
  ) {
    return null;
  }

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: record.generatedAt,
    trigger: record.trigger,
    ok: record.ok,
    tickDurationMs: Math.floor(record.tickDurationMs),
    stateCommitment:
      record.stateCommitment === "processed" ||
      record.stateCommitment === "confirmed" ||
      record.stateCommitment === "finalized"
        ? record.stateCommitment
        : undefined,
    stateTargetSlot:
      typeof record.stateTargetSlot === "number" &&
      Number.isInteger(record.stateTargetSlot) &&
      record.stateTargetSlot >= 0
        ? record.stateTargetSlot
        : undefined,
    stateAppliedSlot:
      typeof record.stateAppliedSlot === "number" &&
      Number.isInteger(record.stateAppliedSlot) &&
      record.stateAppliedSlot >= 0
        ? record.stateAppliedSlot
        : record.stateAppliedSlot === null
          ? null
          : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

function sanitizeErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message.slice(0, 300);
  if (typeof error === "string") return error.slice(0, 300);
  return undefined;
}

function resolveHeadsFromState(
  cursorState: LoopACursorState | undefined,
  previous: Health | null,
): LoopACursorHeads {
  if (cursorState) return cursorState.headCursor;
  if (!previous) return ZERO_HEADS;

  return {
    processed: previous.cursors.processed + previous.lagSlots.processedLag,
    confirmed: previous.cursors.confirmed + previous.lagSlots.confirmedLag,
    finalized: previous.cursors.finalized + previous.lagSlots.finalizedLag,
  };
}

function resolveStateCursor(
  cursorState: LoopACursorState | undefined,
  previous: Health | null,
): LoopACursorHeads {
  if (cursorState) return cursorState.stateCursor;
  if (!previous) return ZERO_HEADS;
  return previous.cursors;
}

function resolveLagSlots(
  heads: LoopACursorHeads,
  cursors: LoopACursorHeads,
): Health["lagSlots"] {
  return {
    processedLag: Math.max(0, heads.processed - cursors.processed),
    confirmedLag: Math.max(0, heads.confirmed - cursors.confirmed),
    finalizedLag: Math.max(0, heads.finalized - cursors.finalized),
  };
}

function lagForCommitment(
  lagSlots: Health["lagSlots"],
  commitment: "processed" | "confirmed" | "finalized",
): number {
  if (commitment === "processed") return lagSlots.processedLag;
  if (commitment === "confirmed") return lagSlots.confirmedLag;
  return lagSlots.finalizedLag;
}

function resolveStatus(input: {
  ok: boolean;
  lagSlots: Health["lagSlots"];
  primaryCommitment: "processed" | "confirmed" | "finalized";
  warnings: string[];
}): Health["status"] {
  if (!input.ok) return "error";
  const primaryLag = lagForCommitment(input.lagSlots, input.primaryCommitment);
  if (primaryLag > 64 || input.warnings.length > 0) return "degraded";
  return "ok";
}

function minutePartition(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `date=${yyyy}-${mm}-${dd}/hour=${hh}/minute=${yyyy}-${mm}-${dd}T${hh}:${minute}:00Z`;
}

function safeR2Token(iso: string): string {
  return iso.replaceAll(":", "-");
}

export function loopAHealthR2Key(generatedAt: string): string {
  return `loopA/${LOOP_A_SCHEMA_VERSION}/health/${minutePartition(generatedAt)}/at=${safeR2Token(generatedAt)}.json`;
}

export function loopALatencyR2Key(generatedAt: string): string {
  return `loopA/${LOOP_A_SCHEMA_VERSION}/latency/${minutePartition(generatedAt)}/at=${safeR2Token(generatedAt)}.json`;
}

export async function readLoopAHealthFromKv(env: Env): Promise<Health | null> {
  if (!env.CONFIG_KV) return null;
  const raw = await env.CONFIG_KV.get(LOOP_A_HEALTH_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const result = safeParseHealth(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function readLoopALatencyFromKv(
  env: Env,
): Promise<LoopALatencyTelemetry | null> {
  if (!env.CONFIG_KV) return null;
  const raw = await env.CONFIG_KV.get(LOOP_A_LATENCY_LATEST_KEY);
  if (!raw) return null;
  try {
    return parseLatencyTelemetry(JSON.parse(raw));
  } catch {
    return null;
  }
}

function buildHealthArtifact(input: {
  previous: Health | null;
  cursorState: LoopACursorState | undefined;
  ok: boolean;
  observedAt: string;
  tickResult?: LoopAPipelineTickResult;
  errorMessage?: string;
}): Health {
  const heads = resolveHeadsFromState(input.cursorState, input.previous);
  const cursors = resolveStateCursor(input.cursorState, input.previous);
  const lagSlots = resolveLagSlots(heads, cursors);
  const primaryCommitment = input.tickResult?.stateCommitment ?? "confirmed";
  const primaryLag = lagForCommitment(lagSlots, primaryCommitment);

  const warnings: string[] = [];
  if (primaryLag > 0) {
    warnings.push(`state-lag-slots=${primaryLag}`);
  }
  if (input.tickResult?.stateAppliedSlot === null) {
    warnings.push("state-store-disabled-or-no-snapshot");
  }
  if (!input.ok && input.errorMessage) {
    warnings.push(`last-error=${input.errorMessage}`);
  }

  const lastSuccessfulSlot = input.ok
    ? (input.tickResult?.stateAppliedSlot ??
      cursors[input.tickResult?.stateCommitment ?? "confirmed"])
    : (input.previous?.lastSuccessfulSlot ?? cursors.confirmed);
  const lastSuccessfulAt = input.ok
    ? input.observedAt
    : (input.previous?.lastSuccessfulAt ?? input.observedAt);
  const errorCount = input.ok
    ? (input.previous?.errorCount ?? 0)
    : (input.previous?.errorCount ?? 0) + 1;

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    component: "loopA",
    status: resolveStatus({
      ok: input.ok,
      lagSlots,
      primaryCommitment,
      warnings:
        primaryLag > 64 ||
        !input.ok ||
        input.tickResult?.stateAppliedSlot === null
          ? warnings
          : [],
    }),
    updatedAt: input.observedAt,
    cursors,
    lagSlots,
    lastSuccessfulSlot,
    lastSuccessfulAt,
    errorCount,
    lastError: input.ok ? undefined : input.errorMessage,
    warnings,
    version: LOOP_A_SCHEMA_VERSION,
  };
}

function buildLatencyTelemetry(input: {
  observedAt: string;
  durationMs: number;
  trigger: LoopAHealthTickTrigger;
  ok: boolean;
  tickResult?: LoopAPipelineTickResult;
  errorMessage?: string;
}): LoopALatencyTelemetry {
  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    trigger: input.trigger,
    ok: input.ok,
    tickDurationMs: input.durationMs,
    stateCommitment: input.tickResult?.stateCommitment,
    stateTargetSlot: input.tickResult?.stateTargetSlot,
    stateAppliedSlot: input.tickResult?.stateAppliedSlot,
    error: input.ok ? undefined : input.errorMessage,
  };
}

export async function recordLoopAHealthTick(
  env: Env,
  input: RecordLoopAHealthTickInput,
): Promise<{ health: Health; latency: LoopALatencyTelemetry } | null> {
  if (!env.CONFIG_KV) return null;

  const nowMs = input.nowMs ?? Date.now();
  const observedAt = input.observedAt ?? new Date(nowMs).toISOString();
  const durationMs = Math.max(0, Math.floor(nowMs - input.startedAtMs));
  const previous = await readLoopAHealthFromKv(env);
  const errorMessage = sanitizeErrorMessage(input.error);
  const cursorState =
    input.tickResult?.cursorState ?? input.cursorStateFallback;
  const health = buildHealthArtifact({
    previous,
    cursorState,
    ok: input.ok,
    observedAt,
    tickResult: input.tickResult,
    errorMessage,
  });
  const latency = buildLatencyTelemetry({
    observedAt,
    durationMs,
    trigger: input.trigger,
    ok: input.ok,
    tickResult: input.tickResult,
    errorMessage,
  });

  await env.CONFIG_KV.put(LOOP_A_HEALTH_KEY, JSON.stringify(health));
  await env.CONFIG_KV.put(LOOP_A_LATENCY_LATEST_KEY, JSON.stringify(latency));

  if (env.LOGS_BUCKET) {
    await Promise.all([
      env.LOGS_BUCKET.put(loopAHealthR2Key(observedAt), JSON.stringify(health)),
      env.LOGS_BUCKET.put(
        loopALatencyR2Key(observedAt),
        JSON.stringify(latency),
      ),
    ]);
  }

  return { health, latency };
}
