import type {
  Mark,
  ProtocolEvent,
} from "../../../../src/loops/contracts/loop_a";
import type { Env } from "../types";
import { type LoopAEventBatch, loopAEventBatchR2Key } from "./canonical_state";
import {
  isSlotCommitment,
  LOOP_A_SCHEMA_VERSION,
  type SlotCommitment,
} from "./types";

const DEFAULT_MARK_COMMITMENT: SlotCommitment = "confirmed";

export type LoopAMarkSet = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  generatedAt: string;
  commitment: SlotCommitment;
  latestSlot: number;
  count: number;
  marks: Mark[];
};

export type LoopAMarkEngineTickResult = {
  commitment: SlotCommitment;
  marksComputed: number;
  latestSlot: number | null;
  latestKey: string | null;
  pairKeysWritten: number;
};

function asPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1) {
    return value.toFixed(8).replace(/\.?0+$/, "");
  }
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.05;
  return Math.max(0.05, Math.min(0.99, value));
}

function extractPools(event: ProtocolEvent): string[] | undefined {
  const maybePool = event.meta?.pool;
  if (typeof maybePool === "string" && maybePool.length >= 32) {
    return [maybePool];
  }
  return undefined;
}

function scoreConfidence(input: {
  protocol: string;
  inAmount: number;
  outAmount: number;
  venue?: string;
}): number {
  let confidence = 0.35;

  if (input.protocol === "jupiter") confidence += 0.2;
  if (input.venue) confidence += 0.1;

  const minAmount = Math.min(input.inAmount, input.outAmount);
  if (minAmount >= 1) confidence += 0.1;
  if (minAmount >= 1_000) confidence += 0.1;

  return clampConfidence(confidence);
}

function markPairKey(
  commitment: SlotCommitment,
  baseMint: string,
  quoteMint: string,
): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:marks:${commitment}:pair:${baseMint}:${quoteMint}:latest`;
}

export function loopAMarksLatestKey(commitment: SlotCommitment): string {
  return `loopA:${LOOP_A_SCHEMA_VERSION}:marks:${commitment}:latest`;
}

function pickLatestMarkPerPair(marks: Mark[]): Mark[] {
  const byPair = new Map<string, Mark>();
  for (const mark of marks) {
    const key = `${mark.baseMint}:${mark.quoteMint}`;
    const previous = byPair.get(key);
    if (!previous || mark.slot >= previous.slot) {
      byPair.set(key, mark);
    }
  }
  return [...byPair.values()].sort((a, b) => b.slot - a.slot);
}

function buildMarkFromSwap(input: {
  event: Extract<ProtocolEvent, { kind: "swap" }>;
  commitment: SlotCommitment;
  generatedAt: string;
}): Mark | null {
  const inAmount = asPositiveNumber(input.event.inAmount);
  const outAmount = asPositiveNumber(input.event.outAmount);
  if (!inAmount || !outAmount) return null;

  const px = outAmount / inAmount;
  if (!Number.isFinite(px) || px <= 0) return null;

  const evidenceInput = `${loopAEventBatchR2Key(input.commitment, input.event.slot)}#sig=${input.event.sig}`;
  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    slot: input.event.slot,
    ts: input.event.ts,
    baseMint: input.event.inMint,
    quoteMint: input.event.outMint,
    px: formatDecimal(px),
    confidence: scoreConfidence({
      protocol: input.event.protocol,
      inAmount,
      outAmount,
      venue: input.event.venue,
    }),
    venue: input.event.venue ?? input.event.protocol,
    evidence: {
      sigs: [input.event.sig],
      pools: extractPools(input.event),
      inputs: [evidenceInput],
    },
    version: LOOP_A_SCHEMA_VERSION,
  };
}

function computeMarksFromBatches(input: {
  decodedBatches: LoopAEventBatch[];
  commitment: SlotCommitment;
  generatedAt: string;
}): Mark[] {
  const marks: Mark[] = [];
  for (const batch of input.decodedBatches) {
    if (batch.commitment !== input.commitment) continue;
    for (const event of batch.events) {
      if (event.kind !== "swap") continue;
      const mark = buildMarkFromSwap({
        event,
        commitment: input.commitment,
        generatedAt: input.generatedAt,
      });
      if (mark) marks.push(mark);
    }
  }
  return pickLatestMarkPerPair(marks);
}

export function resolveMarkCommitment(raw: string | undefined): SlotCommitment {
  const normalized = String(raw ?? "").trim();
  return isSlotCommitment(normalized) ? normalized : DEFAULT_MARK_COMMITMENT;
}

export async function runLoopAMarkEngineTick(
  env: Env,
  input: {
    decodedBatches: LoopAEventBatch[];
    commitment: SlotCommitment;
    observedAt?: string;
  },
): Promise<LoopAMarkEngineTickResult> {
  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const observedAt = input.observedAt ?? new Date().toISOString();
  const marks = computeMarksFromBatches({
    decodedBatches: input.decodedBatches,
    commitment: input.commitment,
    generatedAt: observedAt,
  });

  if (marks.length === 0) {
    return {
      commitment: input.commitment,
      marksComputed: 0,
      latestSlot: null,
      latestKey: null,
      pairKeysWritten: 0,
    };
  }

  for (const mark of marks) {
    await env.CONFIG_KV.put(
      markPairKey(input.commitment, mark.baseMint, mark.quoteMint),
      JSON.stringify(mark),
    );
  }

  const latestSlot = marks.reduce(
    (max, mark) => Math.max(max, mark.slot),
    marks[0]?.slot ?? 0,
  );
  const latestKey = loopAMarksLatestKey(input.commitment);
  const markSet: LoopAMarkSet = {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: observedAt,
    commitment: input.commitment,
    latestSlot,
    count: marks.length,
    marks,
  };
  await env.CONFIG_KV.put(latestKey, JSON.stringify(markSet));

  return {
    commitment: input.commitment,
    marksComputed: marks.length,
    latestSlot,
    latestKey,
    pairKeysWritten: marks.length,
  };
}
