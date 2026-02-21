import type { ProtocolEvent } from "../../../../src/loops/contracts/loop_a";
import type { Env } from "../types";
import {
  isSlotCommitment,
  LOOP_A_SCHEMA_VERSION,
  type LoopACursor,
  type SlotCommitment,
} from "./types";

type JsonRecord = Record<string, unknown>;

type LastSwapState = {
  slot: number;
  sig: string;
  inMint: string;
  outMint: string;
  inAmount: string;
  outAmount: string;
};

export type CanonicalTrackedState = {
  totalEvents: number;
  byKind: Record<string, number>;
  byProtocol: Record<string, number>;
  lastSwapByPair: Record<string, LastSwapState>;
};

export type LoopAEventBatch = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  commitment: SlotCommitment;
  slot: number;
  generatedAt: string;
  events: ProtocolEvent[];
  marker?: {
    kind: "empty_batch";
    reason: "skipped" | "missing_in_storage";
    source?: "block_fetcher" | "backfill_resolver";
  };
};

export type LoopAStateSnapshot = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  generatedAt: string;
  slot: number;
  commitment: SlotCommitment;
  cursor: {
    processed: number;
    confirmed: number;
    finalized: number;
  };
  stateHash: string;
  trackedState: CanonicalTrackedState;
  parentSlot?: number;
  appliedEventCount: number;
  inputs: {
    eventRefs: string[];
    snapshotRef?: string;
  };
  version: typeof LOOP_A_SCHEMA_VERSION;
};

export type CanonicalStateTickResult = {
  commitment: SlotCommitment;
  cursorTargetSlot: number;
  snapshotBeforeSlot: number | null;
  snapshotAfterSlot: number;
  persistedBatches: number;
  replayedSlots: number;
  replayMissingSlots: number[];
  appliedEvents: number;
  checkpointsWritten: number;
};

type LoopAEventBatchRead = {
  batch: LoopAEventBatch;
  ref: string;
};

const DEFAULT_STATE_COMMITMENT: SlotCommitment = "confirmed";
const DEFAULT_SNAPSHOT_EVERY_SLOTS = 100;
const LOOP_A_EVENT_BATCH_R2_PREFIX = `loopA/${LOOP_A_SCHEMA_VERSION}/events`;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function toIso(value: unknown): string | null {
  const maybe = asString(value);
  if (!maybe || Number.isNaN(Date.parse(maybe))) return null;
  return maybe;
}

function parseCountRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};

  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      output[key] = Math.floor(raw);
    }
  }
  return output;
}

function parseLastSwapByPair(value: unknown): Record<string, LastSwapState> {
  const record = asRecord(value);
  if (!record) return {};

  const output: Record<string, LastSwapState> = {};
  for (const [pairKey, rawEntry] of Object.entries(record)) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;

    const slot = asInteger(entry.slot);
    const sig = asString(entry.sig);
    const inMint = asString(entry.inMint);
    const outMint = asString(entry.outMint);
    const inAmount = asString(entry.inAmount);
    const outAmount = asString(entry.outAmount);

    if (
      slot === null ||
      !sig ||
      !inMint ||
      !outMint ||
      !inAmount ||
      !outAmount
    ) {
      continue;
    }

    output[pairKey] = {
      slot,
      sig,
      inMint,
      outMint,
      inAmount,
      outAmount,
    };
  }

  return output;
}

function createEmptyTrackedState(): CanonicalTrackedState {
  return {
    totalEvents: 0,
    byKind: {},
    byProtocol: {},
    lastSwapByPair: {},
  };
}

function cloneTrackedState(
  state: CanonicalTrackedState,
): CanonicalTrackedState {
  return {
    totalEvents: state.totalEvents,
    byKind: { ...state.byKind },
    byProtocol: { ...state.byProtocol },
    lastSwapByPair: { ...state.lastSwapByPair },
  };
}

function parseTrackedState(value: unknown): CanonicalTrackedState {
  const record = asRecord(value);
  if (!record) return createEmptyTrackedState();

  const totalEvents = asInteger(record.totalEvents) ?? 0;
  return {
    totalEvents,
    byKind: parseCountRecord(record.byKind),
    byProtocol: parseCountRecord(record.byProtocol),
    lastSwapByPair: parseLastSwapByPair(record.lastSwapByPair),
  };
}

function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildStateHash(
  trackedState: CanonicalTrackedState,
  commitment: SlotCommitment,
  slot: number,
): string {
  const serialized = JSON.stringify({ commitment, slot, trackedState });
  return hashStringFNV1a(serialized.slice(0, 400_000));
}

function incrementCounter(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] ?? 0) + 1;
}

function applyProtocolEvent(
  trackedState: CanonicalTrackedState,
  event: ProtocolEvent,
): void {
  trackedState.totalEvents += 1;
  incrementCounter(trackedState.byKind, event.kind);
  incrementCounter(trackedState.byProtocol, event.protocol);

  if (event.kind === "swap") {
    const pairKey = `${event.inMint}/${event.outMint}`;
    trackedState.lastSwapByPair[pairKey] = {
      slot: event.slot,
      sig: event.sig,
      inMint: event.inMint,
      outMint: event.outMint,
      inAmount: event.inAmount,
      outAmount: event.outAmount,
    };
  }
}

function applyBatch(
  trackedState: CanonicalTrackedState,
  batch: LoopAEventBatch,
): CanonicalTrackedState {
  const next = cloneTrackedState(trackedState);
  for (const event of batch.events) {
    applyProtocolEvent(next, event);
  }
  return next;
}

function dedupeByKey<T>(entries: T[], keyFn: (entry: T) => string): T[] {
  const map = new Map<string, T>();
  for (const entry of entries) {
    map.set(keyFn(entry), entry);
  }
  return [...map.values()];
}

function parseProtocolEventArray(value: unknown): ProtocolEvent[] {
  if (!Array.isArray(value)) return [];

  const events: ProtocolEvent[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;

    const kind = asString(record.kind);
    const protocol = asString(record.protocol);
    const sig = asString(record.sig);
    const ts = asString(record.ts);
    const generatedAt = asString(record.generatedAt);
    const schemaVersion = asString(record.schemaVersion);
    const slot = asInteger(record.slot);
    if (!kind || !protocol || !sig || !ts || !generatedAt || !schemaVersion) {
      continue;
    }
    if (schemaVersion !== LOOP_A_SCHEMA_VERSION || slot === null) continue;

    events.push(record as unknown as ProtocolEvent);
  }

  return events;
}

export function loopAEventBatchKey(
  commitment: SlotCommitment,
  slot: number,
): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:events:${commitment}:slot:${slot}`;
}

export function loopAEventBatchR2Key(
  commitment: SlotCommitment,
  slot: number,
): string {
  return `${LOOP_A_EVENT_BATCH_R2_PREFIX}/commitment=${commitment}/slot=${slot}.json`;
}

export function loopAStateLatestKey(commitment: SlotCommitment): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:state:latest:${commitment}`;
}

export function loopAStateSnapshotKey(
  commitment: SlotCommitment,
  slot: number,
): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:state:snapshot:${commitment}:${slot}`;
}

export function resolveStateCommitment(
  raw: string | undefined,
): SlotCommitment {
  const normalized = String(raw ?? "").trim();
  return isSlotCommitment(normalized) ? normalized : DEFAULT_STATE_COMMITMENT;
}

function parseBoundedInteger(
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

export function resolveSnapshotEverySlots(raw: string | undefined): number {
  return parseBoundedInteger(raw, DEFAULT_SNAPSHOT_EVERY_SLOTS, 1, 50_000);
}

export function parseLoopAEventBatch(input: unknown): LoopAEventBatch | null {
  const record = asRecord(input);
  if (!record) return null;

  const schemaVersion = asString(record.schemaVersion);
  const commitment = asString(record.commitment);
  const slot = asInteger(record.slot);
  const generatedAt = toIso(record.generatedAt);

  if (
    schemaVersion !== LOOP_A_SCHEMA_VERSION ||
    !commitment ||
    !isSlotCommitment(commitment) ||
    slot === null ||
    !generatedAt
  ) {
    return null;
  }

  let marker: LoopAEventBatch["marker"];
  const markerRecord = asRecord(record.marker);
  if (markerRecord) {
    const markerKind = asString(markerRecord.kind);
    const markerReason = asString(markerRecord.reason);
    const markerSource = asString(markerRecord.source);
    if (
      markerKind === "empty_batch" &&
      (markerReason === "skipped" || markerReason === "missing_in_storage")
    ) {
      marker = {
        kind: markerKind,
        reason: markerReason,
        source:
          markerSource === "block_fetcher" ||
          markerSource === "backfill_resolver"
            ? markerSource
            : undefined,
      };
    }
  }

  return {
    schemaVersion,
    commitment,
    slot,
    generatedAt,
    events: parseProtocolEventArray(record.events),
    marker,
  };
}

export function parseLoopAStateSnapshot(
  input: unknown,
): LoopAStateSnapshot | null {
  const record = asRecord(input);
  if (!record) return null;

  const schemaVersion = asString(record.schemaVersion);
  const generatedAt = toIso(record.generatedAt);
  const slot = asInteger(record.slot);
  const commitment = asString(record.commitment);
  const version = asString(record.version);
  const stateHash = asString(record.stateHash);

  const cursor = asRecord(record.cursor);
  const processed = asInteger(cursor?.processed);
  const confirmed = asInteger(cursor?.confirmed);
  const finalized = asInteger(cursor?.finalized);

  const appliedEventCount = asInteger(record.appliedEventCount);
  const inputs = asRecord(record.inputs);
  const eventRefs = Array.isArray(inputs?.eventRefs)
    ? inputs.eventRefs
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  const snapshotRef = asString(inputs?.snapshotRef) ?? undefined;
  const parentSlot = asInteger(record.parentSlot) ?? undefined;

  if (
    schemaVersion !== LOOP_A_SCHEMA_VERSION ||
    version !== LOOP_A_SCHEMA_VERSION ||
    !generatedAt ||
    slot === null ||
    !commitment ||
    !isSlotCommitment(commitment) ||
    processed === null ||
    confirmed === null ||
    finalized === null ||
    !stateHash ||
    appliedEventCount === null
  ) {
    return null;
  }

  return {
    schemaVersion,
    generatedAt,
    slot,
    commitment,
    cursor: {
      processed,
      confirmed,
      finalized,
    },
    stateHash,
    trackedState: parseTrackedState(record.trackedState),
    parentSlot,
    appliedEventCount,
    inputs: {
      eventRefs,
      snapshotRef,
    },
    version,
  };
}

async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }
  await env.CONFIG_KV.put(key, JSON.stringify(value));
}

async function readJson(env: Env, key: string): Promise<unknown | null> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }
  const raw = await env.CONFIG_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonToR2(
  env: Env,
  key: string,
  value: unknown,
): Promise<boolean> {
  if (!env.LOGS_BUCKET) return false;
  await env.LOGS_BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
  return true;
}

async function readJsonFromR2(env: Env, key: string): Promise<unknown | null> {
  if (!env.LOGS_BUCKET) return null;
  const object = await env.LOGS_BUCKET.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

export async function writeLoopAEventBatchToKv(
  env: Env,
  batch: LoopAEventBatch,
): Promise<string> {
  const r2Key = loopAEventBatchR2Key(batch.commitment, batch.slot);
  const wroteToR2 = await writeJsonToR2(env, r2Key, batch);
  if (!wroteToR2) {
    // Legacy fallback when R2 binding is unavailable.
    const kvKey = loopAEventBatchKey(batch.commitment, batch.slot);
    await writeJson(env, kvKey, batch);
    return kvKey;
  }
  return r2Key;
}

export function createEmptyMarkerBatch(input: {
  commitment: SlotCommitment;
  slot: number;
  generatedAt: string;
  reason: "skipped" | "missing_in_storage";
  source?: "block_fetcher" | "backfill_resolver";
}): LoopAEventBatch {
  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    commitment: input.commitment,
    slot: input.slot,
    generatedAt: input.generatedAt,
    events: [],
    marker: {
      kind: "empty_batch",
      reason: input.reason,
      source: input.source,
    },
  };
}

export async function readLoopAStateSnapshotFromKv(
  env: Env,
  commitment: SlotCommitment,
): Promise<LoopAStateSnapshot | null> {
  const parsed = await readJson(env, loopAStateLatestKey(commitment));
  return parseLoopAStateSnapshot(parsed);
}

async function readLoopAEventBatchWithRef(
  env: Env,
  commitment: SlotCommitment,
  slot: number,
): Promise<LoopAEventBatchRead | null> {
  const r2Key = loopAEventBatchR2Key(commitment, slot);
  const parsedFromR2 = await readJsonFromR2(env, r2Key);
  const batchFromR2 = parseLoopAEventBatch(parsedFromR2);
  if (batchFromR2) {
    return {
      batch: batchFromR2,
      ref: r2Key,
    };
  }

  const kvKey = loopAEventBatchKey(commitment, slot);
  const parsedFromKv = await readJson(env, kvKey);
  const batchFromKv = parseLoopAEventBatch(parsedFromKv);
  if (!batchFromKv) return null;

  // Opportunistic migration path so old KV-only rows become available in R2.
  try {
    const migrated = await writeJsonToR2(env, r2Key, batchFromKv);
    if (migrated) {
      return {
        batch: batchFromKv,
        ref: r2Key,
      };
    }
  } catch {
    // Best-effort migration should never block loop progression.
  }

  return {
    batch: batchFromKv,
    ref: kvKey,
  };
}

export async function readLoopAEventBatchFromKv(
  env: Env,
  commitment: SlotCommitment,
  slot: number,
): Promise<LoopAEventBatch | null> {
  const read = await readLoopAEventBatchWithRef(env, commitment, slot);
  return read?.batch ?? null;
}

export async function resolveContiguousIngestionSlot(input: {
  env: Env;
  commitment: SlotCommitment;
  fromSlot: number;
  targetSlot: number;
}): Promise<{ ingestionSlot: number; missingSlot: number | null }> {
  let ingestionSlot = Math.min(input.fromSlot, input.targetSlot);
  for (let slot = ingestionSlot + 1; slot <= input.targetSlot; slot += 1) {
    const batch = await readLoopAEventBatchFromKv(
      input.env,
      input.commitment,
      slot,
    );
    if (!batch) {
      return {
        ingestionSlot,
        missingSlot: slot,
      };
    }
    ingestionSlot = slot;
  }

  return {
    ingestionSlot,
    missingSlot: null,
  };
}

export async function persistLoopAEventBatchesToKv(
  env: Env,
  batches: LoopAEventBatch[],
): Promise<{ count: number; refsBySlot: Map<string, string> }> {
  const deduped = dedupeByKey(
    batches,
    (entry) => `${entry.commitment}:${entry.slot}`,
  );
  const refsBySlot = new Map<string, string>();

  for (const batch of deduped) {
    const ref = await writeLoopAEventBatchToKv(env, batch);
    refsBySlot.set(`${batch.commitment}:${batch.slot}`, ref);
  }

  return {
    count: deduped.length,
    refsBySlot,
  };
}

function determineBootstrapSlot(
  batches: LoopAEventBatch[],
  commitment: SlotCommitment,
  targetSlot: number,
): number {
  const slots = batches
    .filter((batch) => batch.commitment === commitment)
    .map((batch) => batch.slot)
    .sort((a, b) => a - b);

  if (slots.length === 0) return targetSlot;

  const earliest = slots[0];
  return earliest > 0 ? earliest - 1 : 0;
}

function buildSnapshot(input: {
  commitment: SlotCommitment;
  slot: number;
  cursorAfter: LoopACursor;
  trackedState: CanonicalTrackedState;
  observedAt: string;
  parentSlot: number | null;
  eventRefs: string[];
}): LoopAStateSnapshot {
  const snapshotRef =
    input.parentSlot !== null
      ? loopAStateSnapshotKey(input.commitment, input.parentSlot)
      : undefined;

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    slot: input.slot,
    commitment: input.commitment,
    cursor: {
      processed: input.cursorAfter.processed,
      confirmed: input.cursorAfter.confirmed,
      finalized: input.cursorAfter.finalized,
    },
    stateHash: buildStateHash(input.trackedState, input.commitment, input.slot),
    trackedState: input.trackedState,
    parentSlot: input.parentSlot ?? undefined,
    appliedEventCount: input.trackedState.totalEvents,
    inputs: {
      eventRefs: input.eventRefs.slice(-64),
      snapshotRef,
    },
    version: LOOP_A_SCHEMA_VERSION,
  };
}

export async function runLoopACanonicalStateTick(
  env: Env,
  input: {
    cursorAfter: LoopACursor;
    targetSlot?: number;
    decodedBatches: LoopAEventBatch[];
    commitment: SlotCommitment;
    snapshotEverySlots: number;
    observedAt?: string;
  },
): Promise<CanonicalStateTickResult> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const observedAt = input.observedAt ?? new Date().toISOString();
  const targetSlot =
    input.targetSlot === undefined
      ? input.cursorAfter[input.commitment]
      : Math.min(input.targetSlot, input.cursorAfter[input.commitment]);

  const persisted = await persistLoopAEventBatchesToKv(
    env,
    input.decodedBatches,
  );
  const persistedBatches = persisted.count;

  const snapshotBefore = await readLoopAStateSnapshotFromKv(
    env,
    input.commitment,
  );
  let trackedState = snapshotBefore
    ? cloneTrackedState(snapshotBefore.trackedState)
    : createEmptyTrackedState();

  let currentSlot =
    snapshotBefore?.slot ??
    determineBootstrapSlot(input.decodedBatches, input.commitment, targetSlot);
  currentSlot = Math.min(currentSlot, targetSlot);

  const replayMissingSlots: number[] = [];
  const eventRefs: string[] = [];
  let replayedSlots = 0;
  let appliedEvents = 0;

  const decodedBySlot = new Map<number, LoopAEventBatch>();
  for (const batch of input.decodedBatches) {
    if (batch.commitment === input.commitment) {
      decodedBySlot.set(batch.slot, batch);
    }
  }

  for (let slot = currentSlot + 1; slot <= targetSlot; slot += 1) {
    let batch = decodedBySlot.get(slot) ?? null;
    let eventRef = persisted.refsBySlot.get(`${input.commitment}:${slot}`);
    if (!batch) {
      const read = await readLoopAEventBatchWithRef(
        env,
        input.commitment,
        slot,
      );
      batch = read?.batch ?? null;
      eventRef = read?.ref;
    }

    if (!batch) {
      replayMissingSlots.push(slot);
      break;
    }

    trackedState = applyBatch(trackedState, batch);
    appliedEvents += batch.events.length;
    replayedSlots += 1;
    currentSlot = slot;
    if (eventRef) {
      eventRefs.push(eventRef);
    }
  }

  const snapshotAfter = buildSnapshot({
    commitment: input.commitment,
    slot: currentSlot,
    cursorAfter: input.cursorAfter,
    trackedState,
    observedAt,
    parentSlot: snapshotBefore?.slot ?? null,
    eventRefs,
  });

  await writeJson(env, loopAStateLatestKey(input.commitment), snapshotAfter);

  let checkpointsWritten = 0;
  if (
    currentSlot > 0 &&
    currentSlot % input.snapshotEverySlots === 0 &&
    currentSlot !== snapshotBefore?.slot
  ) {
    await writeJson(
      env,
      loopAStateSnapshotKey(input.commitment, currentSlot),
      snapshotAfter,
    );
    checkpointsWritten = 1;
  }

  return {
    commitment: input.commitment,
    cursorTargetSlot: targetSlot,
    snapshotBeforeSlot: snapshotBefore?.slot ?? null,
    snapshotAfterSlot: currentSlot,
    persistedBatches,
    replayedSlots,
    replayMissingSlots,
    appliedEvents,
    checkpointsWritten,
  };
}
