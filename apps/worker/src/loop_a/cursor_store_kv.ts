import type { Env } from "../types";
import {
  type BackfillTask,
  LOOP_A_CURSOR_KEY,
  LOOP_A_SCHEMA_VERSION,
  type LoopACursor,
} from "./types";

function isFiniteSlot(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function loopABackfillTaskKey(
  task: Pick<BackfillTask, "commitment" | "fromSlot" | "toSlot">,
): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:backfill:pending:${task.commitment}:${task.fromSlot}-${task.toSlot}`;
}

export function parseLoopACursor(input: unknown): LoopACursor | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  const processed = record.processed;
  const confirmed = record.confirmed;
  const finalized = record.finalized;
  const updatedAt = record.updatedAt;

  if (schemaVersion !== LOOP_A_SCHEMA_VERSION) return null;
  if (
    !isFiniteSlot(processed) ||
    !isFiniteSlot(confirmed) ||
    !isFiniteSlot(finalized)
  ) {
    return null;
  }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    return null;
  }

  return {
    schemaVersion,
    processed,
    confirmed,
    finalized,
    updatedAt,
  };
}

export async function readLoopACursorFromKv(
  env: Env,
): Promise<LoopACursor | null> {
  if (!env.CONFIG_KV) return null;
  const raw = await env.CONFIG_KV.get(LOOP_A_CURSOR_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parseLoopACursor(parsed);
  } catch {
    return null;
  }
}

export async function writeLoopACursorToKv(
  env: Env,
  cursor: LoopACursor,
): Promise<boolean> {
  if (!env.CONFIG_KV) return false;
  await env.CONFIG_KV.put(LOOP_A_CURSOR_KEY, JSON.stringify(cursor));
  return true;
}

export async function emitBackfillTasksToKv(
  env: Env,
  tasks: BackfillTask[],
): Promise<number> {
  if (!env.CONFIG_KV || tasks.length === 0) return 0;

  for (const task of tasks) {
    await env.CONFIG_KV.put(loopABackfillTaskKey(task), JSON.stringify(task));
  }

  return tasks.length;
}
