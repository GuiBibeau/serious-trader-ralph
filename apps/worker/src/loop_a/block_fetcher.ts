import { SolanaRpc } from "../solana_rpc";
import type { Env } from "../types";
import type { LoopACursor, SlotCommitment } from "./types";

const DEFAULT_BLOCK_FETCH_COMMITMENTS: SlotCommitment[] = [
  "confirmed",
  "finalized",
];
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 200;
const DEFAULT_MAX_SLOTS_PER_TICK = 256;

type BlockFetchStatus = "fetched" | "missing" | "failed";

type BlockFetchTarget = {
  slot: number;
  commitment: SlotCommitment;
};

export type FetchedBlock = {
  slot: number;
  commitment: SlotCommitment;
  block: Record<string, unknown>;
};

export type BlockMissingTask = {
  schemaVersion: "v1";
  commitment: SlotCommitment;
  slot: number;
  detectedAt: string;
  status: "pending";
  reason: "rpc-null" | "rpc-missing" | "fetch-failed";
};

export type BlockFetcherConfig = {
  commitments: SlotCommitment[];
  maxConcurrency: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxSlotsPerTick: number;
};

export type BlockFetcherTickResult = {
  targetsTotal: number;
  fetched: number;
  missing: number;
  failed: number;
  missingTasksEmitted: number;
  maxObservedConcurrency: number;
  onFetchedBlockErrors: number;
};

function isSlotCommitment(value: string): value is SlotCommitment {
  return (
    value === "processed" || value === "confirmed" || value === "finalized"
  );
}

function parseInteger(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

export function parseBlockFetchCommitments(
  raw: string | undefined,
): SlotCommitment[] {
  if (!raw || !raw.trim()) return [...DEFAULT_BLOCK_FETCH_COMMITMENTS];

  const commitments: SlotCommitment[] = [];
  for (const item of raw.split(",")) {
    const normalized = item.trim();
    if (!normalized || !isSlotCommitment(normalized)) continue;
    if (!commitments.includes(normalized)) {
      commitments.push(normalized);
    }
  }

  return commitments.length > 0
    ? commitments
    : [...DEFAULT_BLOCK_FETCH_COMMITMENTS];
}

export function resolveBlockFetcherConfig(env: Env): BlockFetcherConfig {
  return {
    commitments: parseBlockFetchCommitments(env.LOOP_A_BLOCK_FETCH_COMMITMENTS),
    maxConcurrency: parseInteger(
      env.LOOP_A_BLOCK_FETCH_MAX_CONCURRENCY,
      DEFAULT_MAX_CONCURRENCY,
      1,
      32,
    ),
    maxRetries: parseInteger(
      env.LOOP_A_BLOCK_FETCH_MAX_RETRIES,
      DEFAULT_MAX_RETRIES,
      0,
      8,
    ),
    baseBackoffMs: parseInteger(
      env.LOOP_A_BLOCK_FETCH_BASE_BACKOFF_MS,
      DEFAULT_BASE_BACKOFF_MS,
      0,
      10_000,
    ),
    maxSlotsPerTick: parseInteger(
      env.LOOP_A_BLOCK_FETCH_MAX_SLOTS_PER_TICK,
      DEFAULT_MAX_SLOTS_PER_TICK,
      1,
      10_000,
    ),
  };
}

export function buildBlockFetchTargets(
  cursorBefore: LoopACursor | null,
  cursorAfter: LoopACursor,
  commitments: SlotCommitment[],
  maxSlotsPerTick: number,
): BlockFetchTarget[] {
  if (!cursorBefore || commitments.length === 0) return [];

  const targets: BlockFetchTarget[] = [];
  for (const commitment of commitments) {
    const start = cursorBefore[commitment] + 1;
    const end = cursorAfter[commitment];
    if (end < start) continue;

    for (let slot = start; slot <= end; slot += 1) {
      targets.push({ slot, commitment });
      if (targets.length >= maxSlotsPerTick) {
        return targets;
      }
    }
  }

  return targets;
}

function getBlockMissingTaskKey(
  task: Pick<BlockMissingTask, "commitment" | "slot">,
): string {
  return `loopA:v1:block_missing:pending:${task.commitment}:${task.slot}`;
}

async function emitBlockMissingTasksToKv(
  env: Env,
  tasks: BlockMissingTask[],
): Promise<number> {
  if (!env.CONFIG_KV || tasks.length === 0) return 0;

  for (const task of tasks) {
    await env.CONFIG_KV.put(getBlockMissingTaskKey(task), JSON.stringify(task));
  }

  return tasks.length;
}

function isRetryableBlockError(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  return (
    message.includes("rpc-http-error: 429") ||
    message.includes("rpc-http-error: 500") ||
    message.includes("rpc-http-error: 502") ||
    message.includes("rpc-http-error: 503") ||
    message.includes("rpc-http-error: 504") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("temporar") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTargetWithRetry(
  rpc: Pick<SolanaRpc, "getBlock">,
  target: BlockFetchTarget,
  options: {
    maxRetries: number;
    baseBackoffMs: number;
  },
): Promise<{
  status: BlockFetchStatus;
  reason?: BlockMissingTask["reason"];
  block?: Record<string, unknown>;
}> {
  let attempt = 0;
  while (attempt <= options.maxRetries) {
    attempt += 1;

    try {
      const block = await rpc.getBlock(target.slot, {
        commitment: target.commitment,
      });
      if (block === null) {
        return { status: "missing", reason: "rpc-null" };
      }
      return { status: "fetched", block };
    } catch (error) {
      if (isMissingBlockError(error)) {
        return { status: "missing", reason: "rpc-missing" };
      }

      const canRetry =
        attempt <= options.maxRetries && isRetryableBlockError(error);
      if (canRetry) {
        const delayMs = options.baseBackoffMs * 2 ** (attempt - 1);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        continue;
      }

      return { status: "failed", reason: "fetch-failed" };
    }
  }

  return { status: "failed", reason: "fetch-failed" };
}

function resolveRpcEndpoint(env: Env): string {
  const endpoint = String(env.RPC_ENDPOINT ?? "").trim();
  if (!endpoint) throw new Error("rpc-endpoint-missing");
  return endpoint;
}

async function processTargetsWithConcurrency(
  targets: BlockFetchTarget[],
  concurrency: number,
  processor: (target: BlockFetchTarget) => Promise<{
    status: BlockFetchStatus;
    reason?: BlockMissingTask["reason"];
    block?: Record<string, unknown>;
  }>,
  options?: {
    onFetchedBlock?: (input: FetchedBlock) => Promise<void> | void;
  },
): Promise<{
  fetched: number;
  missingTasks: BlockMissingTask[];
  failed: number;
  maxObservedConcurrency: number;
  onFetchedBlockErrors: number;
}> {
  let index = 0;
  let active = 0;
  let maxObservedConcurrency = 0;
  let fetched = 0;
  let failed = 0;
  let onFetchedBlockErrors = 0;
  const missingTasks: BlockMissingTask[] = [];

  async function workerLoop(): Promise<void> {
    while (true) {
      const currentIndex = index;
      if (currentIndex >= targets.length) return;
      index += 1;
      const target = targets[currentIndex];
      if (!target) return;

      active += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
      try {
        const result = await processor(target);
        if (result.status === "fetched") {
          fetched += 1;
          if (result.block && options?.onFetchedBlock) {
            try {
              await options.onFetchedBlock({
                slot: target.slot,
                commitment: target.commitment,
                block: result.block,
              });
            } catch {
              onFetchedBlockErrors += 1;
            }
          }
        } else if (result.reason) {
          if (result.status === "failed") failed += 1;
          missingTasks.push({
            schemaVersion: "v1",
            commitment: target.commitment,
            slot: target.slot,
            detectedAt: new Date().toISOString(),
            status: "pending",
            reason: result.reason,
          });
        }
      } finally {
        active -= 1;
      }
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(Math.max(1, concurrency), targets.length || 1);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(workerLoop());
  }
  await Promise.all(workers);

  return {
    fetched,
    missingTasks,
    failed,
    maxObservedConcurrency,
    onFetchedBlockErrors,
  };
}

export async function runLoopABlockFetcherTick(
  env: Env,
  input: {
    cursorBefore: LoopACursor | null;
    cursorAfter: LoopACursor;
  },
  options?: {
    config?: BlockFetcherConfig;
    rpc?: Pick<SolanaRpc, "getBlock">;
    onFetchedBlock?: (input: FetchedBlock) => Promise<void> | void;
  },
): Promise<BlockFetcherTickResult> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const config = options?.config ?? resolveBlockFetcherConfig(env);
  const targets = buildBlockFetchTargets(
    input.cursorBefore,
    input.cursorAfter,
    config.commitments,
    config.maxSlotsPerTick,
  );

  if (targets.length === 0) {
    return {
      targetsTotal: 0,
      fetched: 0,
      missing: 0,
      failed: 0,
      missingTasksEmitted: 0,
      maxObservedConcurrency: 0,
      onFetchedBlockErrors: 0,
    };
  }

  const rpc = options?.rpc ?? new SolanaRpc(resolveRpcEndpoint(env));
  const runResult = await processTargetsWithConcurrency(
    targets,
    config.maxConcurrency,
    async (target) =>
      await runTargetWithRetry(rpc, target, {
        maxRetries: config.maxRetries,
        baseBackoffMs: config.baseBackoffMs,
      }),
    {
      onFetchedBlock: options?.onFetchedBlock,
    },
  );

  const missingTasksEmitted = await emitBlockMissingTasksToKv(
    env,
    runResult.missingTasks,
  );

  return {
    targetsTotal: targets.length,
    fetched: runResult.fetched,
    missing: runResult.missingTasks.length,
    failed: runResult.failed,
    missingTasksEmitted,
    maxObservedConcurrency: runResult.maxObservedConcurrency,
    onFetchedBlockErrors: runResult.onFetchedBlockErrors,
  };
}
