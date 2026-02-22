import { SolanaRpc } from "../solana_rpc";
import type { Env } from "../types";
import { createDefaultDecoderRegistry } from "./adapters";
import type { BlockMissingTask } from "./block_fetcher";
import {
  createEmptyMarkerBatch,
  type LoopAEventBatch,
  writeLoopAEventBatchToKv,
} from "./canonical_state";
import { loopABackfillTaskKey } from "./cursor_store_kv";
import {
  type DecoderRegistry,
  decodeProtocolEventsFromBlock,
} from "./decoder_registry";
import type { BackfillTask, SlotCommitment } from "./types";

const BACKFILL_TASK_PREFIX = "loopA:v1:backfill:pending:";
const BLOCK_MISSING_TASK_PREFIX = "loopA:v1:block_missing:pending:";

const DEFAULT_MAX_TASKS_PER_TICK = 4;
const DEFAULT_MAX_SLOTS_PER_TASK = 64;
const DEFAULT_MAX_TOTAL_SLOTS_PER_TICK = 128;

type ResolverConfig = {
  maxTasksPerTick: number;
  maxSlotsPerTask: number;
  maxTotalSlotsPerTick: number;
};

export type BackfillResolverTickResult = {
  tasksScanned: number;
  tasksResolved: number;
  tasksRetained: number;
  slotsResolved: number;
  batchesWritten: number;
  hardFailures: number;
};

function parseInteger(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

function resolveConfig(env: Env): ResolverConfig {
  return {
    maxTasksPerTick: parseInteger(
      env.LOOP_A_BACKFILL_MAX_TASKS_PER_TICK,
      DEFAULT_MAX_TASKS_PER_TICK,
      1,
      256,
    ),
    maxSlotsPerTask: parseInteger(
      env.LOOP_A_BACKFILL_MAX_SLOTS_PER_TASK,
      DEFAULT_MAX_SLOTS_PER_TASK,
      1,
      10_000,
    ),
    maxTotalSlotsPerTick: parseInteger(
      env.LOOP_A_BACKFILL_MAX_TOTAL_SLOTS_PER_TICK,
      DEFAULT_MAX_TOTAL_SLOTS_PER_TICK,
      1,
      20_000,
    ),
  };
}

function isSlotCommitment(value: unknown): value is SlotCommitment {
  return (
    value === "processed" || value === "confirmed" || value === "finalized"
  );
}

function isMissingBlockError(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  return (
    message.includes("-32007") ||
    message.includes("was skipped") ||
    message.includes("missing in long-term storage")
  );
}

function parseBackfillTask(raw: string | null): BackfillTask | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.schemaVersion !== "v1") return null;
    if (!isSlotCommitment(parsed.commitment)) return null;
    if (
      typeof parsed.fromSlot !== "number" ||
      !Number.isInteger(parsed.fromSlot)
    ) {
      return null;
    }
    if (typeof parsed.toSlot !== "number" || !Number.isInteger(parsed.toSlot)) {
      return null;
    }
    if (parsed.fromSlot > parsed.toSlot || parsed.fromSlot < 0) return null;
    if (parsed.status !== "pending") return null;
    if (typeof parsed.detectedAt !== "string") return null;

    return {
      schemaVersion: "v1",
      commitment: parsed.commitment,
      fromSlot: parsed.fromSlot,
      toSlot: parsed.toSlot,
      detectedAt: parsed.detectedAt,
      status: "pending",
    };
  } catch {
    return null;
  }
}

function parseMissingTask(raw: string | null): BlockMissingTask | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.schemaVersion !== "v1") return null;
    if (!isSlotCommitment(parsed.commitment)) return null;
    if (
      typeof parsed.slot !== "number" ||
      !Number.isInteger(parsed.slot) ||
      parsed.slot < 0
    ) {
      return null;
    }
    if (typeof parsed.detectedAt !== "string") return null;
    if (parsed.status !== "pending") return null;
    if (
      parsed.reason !== "rpc-null" &&
      parsed.reason !== "rpc-missing" &&
      parsed.reason !== "fetch-failed"
    ) {
      return null;
    }

    return {
      schemaVersion: "v1",
      commitment: parsed.commitment,
      slot: parsed.slot,
      detectedAt: parsed.detectedAt,
      status: "pending",
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

async function listKeysByPrefix(
  env: Env,
  prefix: string,
  limit: number,
): Promise<string[]> {
  if (!env.CONFIG_KV) return [];
  const listed = await env.CONFIG_KV.list({ prefix, limit });
  return listed.keys.map((entry) => entry.name);
}

function resolveRpcEndpoint(env: Env): string {
  const endpoint = String(env.RPC_ENDPOINT ?? "").trim();
  if (!endpoint) throw new Error("rpc-endpoint-missing");
  return endpoint;
}

function markerReasonFromMissingTask(
  reason: BlockMissingTask["reason"],
): "skipped" | "missing_in_storage" | null {
  if (reason === "rpc-null") return "skipped";
  if (reason === "rpc-missing") return "missing_in_storage";
  return null;
}

async function fetchBatchForSlot(input: {
  rpc: Pick<SolanaRpc, "getBlock">;
  decoderRegistry: DecoderRegistry;
  commitment: SlotCommitment;
  slot: number;
  generatedAt: string;
}): Promise<LoopAEventBatch | null> {
  try {
    const block = await input.rpc.getBlock(input.slot, {
      commitment: input.commitment,
    });
    if (block === null) {
      return createEmptyMarkerBatch({
        commitment: input.commitment,
        slot: input.slot,
        generatedAt: input.generatedAt,
        reason: "skipped",
        source: "backfill_resolver",
      });
    }

    const events = decodeProtocolEventsFromBlock({
      slot: input.slot,
      commitment: input.commitment,
      block,
      registry: input.decoderRegistry,
    });

    return {
      schemaVersion: "v1",
      commitment: input.commitment,
      slot: input.slot,
      generatedAt: input.generatedAt,
      events,
    };
  } catch (error) {
    if (isMissingBlockError(error)) {
      return createEmptyMarkerBatch({
        commitment: input.commitment,
        slot: input.slot,
        generatedAt: input.generatedAt,
        reason: "missing_in_storage",
        source: "backfill_resolver",
      });
    }
    return null;
  }
}

async function resolveRangeTask(input: {
  env: Env;
  taskKey: string;
  task: BackfillTask;
  rpc: Pick<SolanaRpc, "getBlock">;
  decoderRegistry: DecoderRegistry;
  slotsBudget: number;
  maxSlotsPerTask: number;
  nowIso: string;
}): Promise<{
  slotsResolved: number;
  batchesWritten: number;
  resolved: boolean;
  hardFailure: boolean;
}> {
  if (!input.env.CONFIG_KV) {
    return {
      slotsResolved: 0,
      batchesWritten: 0,
      resolved: false,
      hardFailure: true,
    };
  }

  const retainRemainingRange = async (fromSlot: number): Promise<void> => {
    if (!input.env.CONFIG_KV) return;
    if (fromSlot <= input.task.fromSlot || fromSlot > input.task.toSlot) return;
    const nextTask: BackfillTask = {
      ...input.task,
      fromSlot,
    };
    const nextKey = loopABackfillTaskKey(nextTask);
    await input.env.CONFIG_KV.put(nextKey, JSON.stringify(nextTask));
    if (nextKey !== input.taskKey) {
      await input.env.CONFIG_KV.delete(input.taskKey);
    }
  };

  const cap = Math.min(
    input.task.toSlot,
    input.task.fromSlot + input.maxSlotsPerTask - 1,
    input.task.fromSlot + input.slotsBudget - 1,
  );

  let slotsResolved = 0;
  let batchesWritten = 0;
  let nextFromSlot = input.task.fromSlot;
  for (let slot = input.task.fromSlot; slot <= cap; slot += 1) {
    const batch = await fetchBatchForSlot({
      rpc: input.rpc,
      decoderRegistry: input.decoderRegistry,
      commitment: input.task.commitment,
      slot,
      generatedAt: input.nowIso,
    });
    if (!batch) {
      await retainRemainingRange(nextFromSlot);
      return {
        slotsResolved,
        batchesWritten,
        resolved: false,
        hardFailure: true,
      };
    }

    await writeLoopAEventBatchToKv(input.env, batch);
    slotsResolved += 1;
    batchesWritten += 1;
    nextFromSlot = slot + 1;
  }

  const fullyResolved = nextFromSlot > input.task.toSlot;
  if (fullyResolved) {
    await input.env.CONFIG_KV.delete(input.taskKey);
  } else {
    await retainRemainingRange(nextFromSlot);
  }

  return {
    slotsResolved,
    batchesWritten,
    resolved: fullyResolved,
    hardFailure: false,
  };
}

async function resolveSingleMissingTask(input: {
  env: Env;
  taskKey: string;
  task: BlockMissingTask;
  rpc: Pick<SolanaRpc, "getBlock">;
  decoderRegistry: DecoderRegistry;
  nowIso: string;
}): Promise<{
  slotsResolved: number;
  batchesWritten: number;
  resolved: boolean;
  hardFailure: boolean;
}> {
  if (!input.env.CONFIG_KV) {
    return {
      slotsResolved: 0,
      batchesWritten: 0,
      resolved: false,
      hardFailure: true,
    };
  }

  const markerReason = markerReasonFromMissingTask(input.task.reason);
  if (markerReason) {
    const batch = createEmptyMarkerBatch({
      commitment: input.task.commitment,
      slot: input.task.slot,
      generatedAt: input.nowIso,
      reason: markerReason,
      source: "backfill_resolver",
    });
    await writeLoopAEventBatchToKv(input.env, batch);
    await input.env.CONFIG_KV.delete(input.taskKey);
    return {
      slotsResolved: 1,
      batchesWritten: 1,
      resolved: true,
      hardFailure: false,
    };
  }

  const batch = await fetchBatchForSlot({
    rpc: input.rpc,
    decoderRegistry: input.decoderRegistry,
    commitment: input.task.commitment,
    slot: input.task.slot,
    generatedAt: input.nowIso,
  });

  if (!batch) {
    return {
      slotsResolved: 0,
      batchesWritten: 0,
      resolved: false,
      hardFailure: true,
    };
  }

  await writeLoopAEventBatchToKv(input.env, batch);
  await input.env.CONFIG_KV.delete(input.taskKey);
  return {
    slotsResolved: 1,
    batchesWritten: 1,
    resolved: true,
    hardFailure: false,
  };
}

export async function runLoopABackfillResolverTick(
  env: Env,
  options?: {
    config?: ResolverConfig;
    rpc?: Pick<SolanaRpc, "getBlock">;
  },
): Promise<BackfillResolverTickResult> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const config = options?.config ?? resolveConfig(env);
  const rpc = options?.rpc ?? new SolanaRpc(resolveRpcEndpoint(env));
  const decoderRegistry = createDefaultDecoderRegistry();
  const nowIso = new Date().toISOString();

  const [rangeKeys, missingKeys] = await Promise.all([
    listKeysByPrefix(env, BACKFILL_TASK_PREFIX, config.maxTasksPerTick * 4),
    listKeysByPrefix(
      env,
      BLOCK_MISSING_TASK_PREFIX,
      config.maxTasksPerTick * 4,
    ),
  ]);

  const allKeys = [...rangeKeys, ...missingKeys].slice(
    0,
    config.maxTasksPerTick,
  );
  let tasksResolved = 0;
  let tasksRetained = 0;
  let slotsResolved = 0;
  let batchesWritten = 0;
  let hardFailures = 0;
  let slotsBudget = config.maxTotalSlotsPerTick;

  for (const taskKey of allKeys) {
    if (slotsBudget <= 0) {
      tasksRetained += 1;
      continue;
    }

    if (taskKey.startsWith(BACKFILL_TASK_PREFIX)) {
      const parsed = parseBackfillTask(await env.CONFIG_KV.get(taskKey));
      if (!parsed) continue;

      const outcome = await resolveRangeTask({
        env,
        taskKey,
        task: parsed,
        rpc,
        decoderRegistry,
        slotsBudget,
        maxSlotsPerTask: config.maxSlotsPerTask,
        nowIso,
      });

      slotsBudget -= outcome.slotsResolved;
      slotsResolved += outcome.slotsResolved;
      batchesWritten += outcome.batchesWritten;
      if (outcome.hardFailure) hardFailures += 1;
      if (outcome.resolved) tasksResolved += 1;
      else tasksRetained += 1;
      continue;
    }

    if (taskKey.startsWith(BLOCK_MISSING_TASK_PREFIX)) {
      const parsed = parseMissingTask(await env.CONFIG_KV.get(taskKey));
      if (!parsed) continue;

      const outcome = await resolveSingleMissingTask({
        env,
        taskKey,
        task: parsed,
        rpc,
        decoderRegistry,
        nowIso,
      });

      slotsBudget -= outcome.slotsResolved;
      slotsResolved += outcome.slotsResolved;
      batchesWritten += outcome.batchesWritten;
      if (outcome.hardFailure) hardFailures += 1;
      if (outcome.resolved) tasksResolved += 1;
      else tasksRetained += 1;
    }
  }

  return {
    tasksScanned: allKeys.length,
    tasksResolved,
    tasksRetained,
    slotsResolved,
    batchesWritten,
    hardFailures,
  };
}
