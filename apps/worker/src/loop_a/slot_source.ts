import { SolanaRpc } from "../solana_rpc";
import type { Env } from "../types";
import {
  emitBackfillTasksToKv,
  readLoopACursorFromKv,
  writeLoopACursorToKv,
} from "./cursor_store_kv";
import {
  type BackfillTask,
  isSlotCommitment,
  LOOP_A_SCHEMA_VERSION,
  type LoopACursor,
  type SlotCommitment,
  type SlotHeads,
  type SlotSourceTickResult,
} from "./types";

const DEFAULT_BACKFILL_COMMITMENTS: SlotCommitment[] = [
  "confirmed",
  "finalized",
];

export function parseBackfillCommitments(
  raw: string | undefined,
): SlotCommitment[] {
  if (!raw || !raw.trim()) {
    return [...DEFAULT_BACKFILL_COMMITMENTS];
  }

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
    : [...DEFAULT_BACKFILL_COMMITMENTS];
}

function buildNextCursor(
  cursorBefore: LoopACursor | null,
  heads: SlotHeads,
  observedAt: string,
): LoopACursor {
  if (!cursorBefore) {
    return {
      schemaVersion: LOOP_A_SCHEMA_VERSION,
      processed: heads.processed,
      confirmed: heads.confirmed,
      finalized: heads.finalized,
      updatedAt: observedAt,
    };
  }

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    processed: Math.max(cursorBefore.processed, heads.processed),
    confirmed: Math.max(cursorBefore.confirmed, heads.confirmed),
    finalized: Math.max(cursorBefore.finalized, heads.finalized),
    updatedAt: observedAt,
  };
}

export function detectGapTasks(
  cursorBefore: LoopACursor | null,
  cursorAfter: LoopACursor,
  commitments: SlotCommitment[],
  detectedAt: string,
): BackfillTask[] {
  if (!cursorBefore || commitments.length === 0) return [];

  const tasks: BackfillTask[] = [];
  for (const commitment of commitments) {
    const before = cursorBefore[commitment];
    const after = cursorAfter[commitment];
    if (after > before + 1) {
      tasks.push({
        schemaVersion: LOOP_A_SCHEMA_VERSION,
        commitment,
        fromSlot: before + 1,
        toSlot: after - 1,
        detectedAt,
        status: "pending",
      });
    }
  }

  return tasks;
}

async function fetchSlotHeads(
  rpc: Pick<SolanaRpc, "getSlot">,
): Promise<SlotHeads> {
  const [processed, confirmed, finalized] = await Promise.all([
    rpc.getSlot("processed"),
    rpc.getSlot("confirmed"),
    rpc.getSlot("finalized"),
  ]);

  return {
    processed,
    confirmed,
    finalized,
  };
}

function resolveRpcEndpoint(env: Env): string {
  const endpoint = String(env.RPC_ENDPOINT ?? "").trim();
  if (!endpoint) throw new Error("rpc-endpoint-missing");
  return endpoint;
}

export async function runLoopASlotSourceTick(
  env: Env,
  options?: {
    observedAt?: string;
    backfillCommitments?: SlotCommitment[];
    rpc?: Pick<SolanaRpc, "getSlot">;
  },
): Promise<SlotSourceTickResult> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const cursorBefore = await readLoopACursorFromKv(env);
  const observedAt = options?.observedAt ?? new Date().toISOString();
  const rpc = options?.rpc ?? new SolanaRpc(resolveRpcEndpoint(env));
  const commitments =
    options?.backfillCommitments ??
    parseBackfillCommitments(env.LOOP_A_SLOT_SOURCE_BACKFILL_COMMITMENTS);

  const heads = await fetchSlotHeads(rpc);
  const cursorCandidate = buildNextCursor(cursorBefore, heads, observedAt);

  const tasks = detectGapTasks(
    cursorBefore,
    cursorCandidate,
    commitments,
    observedAt,
  );
  const tasksEmitted = await emitBackfillTasksToKv(env, tasks);

  const cursorLatest = await readLoopACursorFromKv(env);
  const cursorAfter = buildNextCursor(
    cursorLatest,
    {
      processed: cursorCandidate.processed,
      confirmed: cursorCandidate.confirmed,
      finalized: cursorCandidate.finalized,
    },
    observedAt,
  );
  await writeLoopACursorToKv(env, cursorAfter);

  return {
    cursorBefore,
    cursorAfter,
    tasksEmitted,
  };
}
