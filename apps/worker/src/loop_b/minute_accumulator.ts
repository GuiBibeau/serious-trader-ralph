import {
  type Mark,
  safeParseMark,
} from "../../../../src/loops/contracts/loop_a";
import type { Env } from "../types";

export const LOOP_B_SCHEMA_VERSION = "v1" as const;
const STATE_KEY = "loop_b:minute_accumulator_state:v1";
const DEFAULT_TOP_LIMIT = 20;
const MAX_MINUTES_TRACKED = 180;

export const LOOP_B_MINUTE_ACCUMULATOR_NAME = "loop-b-minute-accumulator-v1";
export const LOOP_B_TOP_MOVERS_KEY = "loopB:v1:views:top_movers:latest";
export const LOOP_B_LIQUIDITY_STRESS_KEY =
  "loopB:v1:views:liquidity_stress:latest";
export const LOOP_B_HEALTH_KEY = "loopB:v1:health";

type MinuteId = `${string}T${string}:00Z`;

type PairAggregate = {
  pairId: string;
  baseMint: string;
  quoteMint: string;
  firstPx: string;
  lastPx: string;
  pctChange: number;
  volatility: number;
  avgConfidence: number;
  markCount: number;
  firstSlot: number;
  lastSlot: number;
  lastTs: string;
  revision: number;
  explain: string[];
};

type LoopBTopMoversView = {
  schemaVersion: typeof LOOP_B_SCHEMA_VERSION;
  generatedAt: string;
  minute: MinuteId;
  count: number;
  movers: PairAggregate[];
};

type LoopBLiquidityStressView = {
  schemaVersion: typeof LOOP_B_SCHEMA_VERSION;
  generatedAt: string;
  minute: MinuteId;
  count: number;
  pairs: Array<
    PairAggregate & {
      stressScore: number;
    }
  >;
};

type LoopBPairScoreRow = PairAggregate & {
  schemaVersion: typeof LOOP_B_SCHEMA_VERSION;
  generatedAt: string;
  minute: MinuteId;
};

type LoopBHealth = {
  schemaVersion: typeof LOOP_B_SCHEMA_VERSION;
  generatedAt: string;
  component: "loopB";
  status: "ok" | "degraded" | "error";
  currentMinute: MinuteId | null;
  lastFinalizedMinute: MinuteId | null;
  activeMinutes: number;
  pendingMinutes: number;
};

type MinuteRecord = {
  minute: MinuteId;
  revision: number;
  finalizedRevision: number;
  marksById: Record<string, Mark>;
  updatedAt: string;
};

type MinuteAccumulatorState = {
  schemaVersion: typeof LOOP_B_SCHEMA_VERSION;
  updatedAt: string;
  currentMinute: MinuteId | null;
  lastFinalizedMinute: MinuteId | null;
  minutes: Record<string, MinuteRecord>;
};

type IngestRequest = {
  marks: unknown[];
  observedAt?: string;
};

type FinalizeRequest = {
  upToMinute?: string;
  observedAt?: string;
};

export type MinuteAccumulatorIngestResult = {
  marksReceived: number;
  marksAccepted: number;
  minutesTouched: number;
  finalizedMinutes: number;
};

export type MinuteAccumulatorFinalizeResult = {
  finalizedMinutes: number;
  minutesConsidered: number;
  lastFinalizedMinute: MinuteId | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toMinuteId(input: string): MinuteId | null {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCSeconds(0, 0);
  return parsed.toISOString() as MinuteId;
}

function previousMinute(input: string): MinuteId {
  const parsed = new Date(input);
  parsed.setUTCSeconds(0, 0);
  parsed.setUTCMinutes(parsed.getUTCMinutes() - 1);
  return parsed.toISOString() as MinuteId;
}

function pairId(mark: Mark): string {
  return `${mark.baseMint}:${mark.quoteMint}`;
}

function markEventId(mark: Mark): string {
  const sig = mark.evidence?.sigs?.[0] ?? "no_sig";
  return `${pairId(mark)}:${mark.slot}:${sig}`;
}

function asFiniteNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadState(input: unknown): MinuteAccumulatorState {
  const record = asRecord(input);
  if (!record || record.schemaVersion !== LOOP_B_SCHEMA_VERSION) {
    return {
      schemaVersion: LOOP_B_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      currentMinute: null,
      lastFinalizedMinute: null,
      minutes: {},
    };
  }

  const minutes = asRecord(record.minutes);
  const outMinutes: Record<string, MinuteRecord> = {};
  if (minutes) {
    for (const [key, raw] of Object.entries(minutes)) {
      const minute = toMinuteId(key);
      const rawRecord = asRecord(raw);
      if (!minute || !rawRecord) continue;

      const revision =
        typeof rawRecord.revision === "number" &&
        Number.isInteger(rawRecord.revision) &&
        rawRecord.revision >= 0
          ? rawRecord.revision
          : 0;
      const finalizedRevision =
        typeof rawRecord.finalizedRevision === "number" &&
        Number.isInteger(rawRecord.finalizedRevision) &&
        rawRecord.finalizedRevision >= 0
          ? rawRecord.finalizedRevision
          : 0;
      const marksByIdRecord = asRecord(rawRecord.marksById);
      const marksById: Record<string, Mark> = {};
      if (marksByIdRecord) {
        for (const [markKey, rawMark] of Object.entries(marksByIdRecord)) {
          const parsed = safeParseMark(rawMark);
          if (!parsed.success) continue;
          marksById[markKey] = parsed.data;
        }
      }

      outMinutes[minute] = {
        minute,
        revision,
        finalizedRevision,
        marksById,
        updatedAt:
          typeof rawRecord.updatedAt === "string"
            ? rawRecord.updatedAt
            : new Date().toISOString(),
      };
    }
  }

  return {
    schemaVersion: LOOP_B_SCHEMA_VERSION,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
    currentMinute:
      typeof record.currentMinute === "string"
        ? (toMinuteId(record.currentMinute) ?? null)
        : null,
    lastFinalizedMinute:
      typeof record.lastFinalizedMinute === "string"
        ? (toMinuteId(record.lastFinalizedMinute) ?? null)
        : null,
    minutes: outMinutes,
  };
}

function createMinuteRecord(
  minute: MinuteId,
  observedAt: string,
): MinuteRecord {
  return {
    minute,
    revision: 0,
    finalizedRevision: 0,
    marksById: {},
    updatedAt: observedAt,
  };
}

function compareMinutes(a: MinuteId, b: MinuteId): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function capTrackedMinutes(state: MinuteAccumulatorState): void {
  const minuteIds = Object.keys(state.minutes)
    .map((id) => toMinuteId(id))
    .filter((id): id is MinuteId => id !== null)
    .sort(compareMinutes);

  const overflow = minuteIds.length - MAX_MINUTES_TRACKED;
  if (overflow <= 0) return;

  for (let i = 0; i < overflow; i += 1) {
    const minute = minuteIds[i];
    if (!minute) continue;
    delete state.minutes[minute];
  }
}

function aggregateMinutePairs(minuteRecord: MinuteRecord): PairAggregate[] {
  const grouped = new Map<string, Mark[]>();
  for (const mark of Object.values(minuteRecord.marksById)) {
    const key = pairId(mark);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(mark);
    } else {
      grouped.set(key, [mark]);
    }
  }

  const pairs: PairAggregate[] = [];
  for (const marks of grouped.values()) {
    if (marks.length === 0) continue;
    marks.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return 0;
    });

    const first = marks[0];
    const last = marks[marks.length - 1];
    if (!first || !last) continue;

    const firstPx = asFiniteNumber(first.px);
    const lastPx = asFiniteNumber(last.px);
    if (!firstPx || !lastPx) continue;

    let minPx = firstPx;
    let maxPx = firstPx;
    let confidenceSum = 0;
    for (const mark of marks) {
      const px = asFiniteNumber(mark.px);
      if (px !== null) {
        if (px < minPx) minPx = px;
        if (px > maxPx) maxPx = px;
      }
      confidenceSum += mark.confidence;
    }
    const pctChange = ((lastPx - firstPx) / firstPx) * 100;
    const volatility = ((maxPx - minPx) / firstPx) * 100;
    const avgConfidence = confidenceSum / marks.length;

    pairs.push({
      pairId: pairId(first),
      baseMint: first.baseMint,
      quoteMint: first.quoteMint,
      firstPx: first.px,
      lastPx: last.px,
      pctChange,
      volatility,
      avgConfidence,
      markCount: marks.length,
      firstSlot: first.slot,
      lastSlot: last.slot,
      lastTs: last.ts,
      revision: minuteRecord.revision,
      explain: [
        `minute=${minuteRecord.minute}`,
        `mark_count=${marks.length}`,
        `avg_confidence=${avgConfidence.toFixed(4)}`,
      ],
    });
  }

  pairs.sort((a, b) => {
    const absA = Math.abs(a.pctChange);
    const absB = Math.abs(b.pctChange);
    if (absA !== absB) return absB - absA;
    return b.lastSlot - a.lastSlot;
  });

  return pairs;
}

function buildTopMoversView(input: {
  minute: MinuteId;
  generatedAt: string;
  pairs: PairAggregate[];
  limit: number;
}): LoopBTopMoversView {
  return {
    schemaVersion: LOOP_B_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    minute: input.minute,
    count: Math.min(input.limit, input.pairs.length),
    movers: input.pairs.slice(0, input.limit),
  };
}

function buildLiquidityStressView(input: {
  minute: MinuteId;
  generatedAt: string;
  pairs: PairAggregate[];
  limit: number;
}): LoopBLiquidityStressView {
  const stressed = input.pairs
    .map((pair) => ({
      ...pair,
      stressScore:
        Math.abs(pair.volatility) * (1 + (1 - pair.avgConfidence)) +
        (1 / Math.max(1, pair.markCount)) * 10,
    }))
    .sort((a, b) => b.stressScore - a.stressScore);

  return {
    schemaVersion: LOOP_B_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    minute: input.minute,
    count: Math.min(input.limit, stressed.length),
    pairs: stressed.slice(0, input.limit),
  };
}

function buildHealthArtifact(input: {
  state: MinuteAccumulatorState;
  generatedAt: string;
}): LoopBHealth {
  const pendingMinutes = Object.values(input.state.minutes).filter(
    (minute) => minute.revision > minute.finalizedRevision,
  ).length;

  return {
    schemaVersion: LOOP_B_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    component: "loopB",
    status: pendingMinutes > 5 ? "degraded" : "ok",
    currentMinute: input.state.currentMinute,
    lastFinalizedMinute: input.state.lastFinalizedMinute,
    activeMinutes: Object.keys(input.state.minutes).length,
    pendingMinutes,
  };
}

function minuteSnapshotR2Key(input: {
  minute: MinuteId;
  generatedAt: string;
  revision: number;
}): string {
  const date = new Date(input.minute);
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const token = input.generatedAt.replaceAll(":", "-");
  return `loopB/${LOOP_B_SCHEMA_VERSION}/minutes/date=${yyyy}-${mm}-${dd}/hour=${hh}/minute=${yyyy}-${mm}-${dd}T${hh}:${minute}:00Z/revision=${input.revision}/at=${token}.json`;
}

async function putKvJson(
  env: Env,
  key: string,
  payload: unknown,
): Promise<void> {
  if (!env.CONFIG_KV) return;
  await env.CONFIG_KV.put(key, JSON.stringify(payload));
}

function pairScoreKey(pair: PairAggregate): string {
  return `loopB:v1:scores:latest:pair:${pair.pairId}`;
}

async function publishFinalizedMinute(input: {
  env: Env;
  minute: MinuteId;
  minuteRecord: MinuteRecord;
  generatedAt: string;
  topLimit: number;
}): Promise<void> {
  const pairs = aggregateMinutePairs(input.minuteRecord);
  const topMovers = buildTopMoversView({
    minute: input.minute,
    generatedAt: input.generatedAt,
    pairs,
    limit: input.topLimit,
  });
  const liquidityStress = buildLiquidityStressView({
    minute: input.minute,
    generatedAt: input.generatedAt,
    pairs,
    limit: input.topLimit,
  });

  await putKvJson(input.env, LOOP_B_TOP_MOVERS_KEY, topMovers);
  await putKvJson(input.env, LOOP_B_LIQUIDITY_STRESS_KEY, liquidityStress);

  for (const pair of pairs) {
    const row: LoopBPairScoreRow = {
      schemaVersion: LOOP_B_SCHEMA_VERSION,
      generatedAt: input.generatedAt,
      minute: input.minute,
      ...pair,
    };
    await putKvJson(input.env, pairScoreKey(pair), row);
  }

  if (input.env.LOGS_BUCKET) {
    await input.env.LOGS_BUCKET.put(
      minuteSnapshotR2Key({
        minute: input.minute,
        generatedAt: input.generatedAt,
        revision: input.minuteRecord.revision,
      }),
      JSON.stringify({
        schemaVersion: LOOP_B_SCHEMA_VERSION,
        generatedAt: input.generatedAt,
        minute: input.minute,
        revision: input.minuteRecord.revision,
        pairCount: pairs.length,
        pairs,
      }),
    );
  }
}

function parseTopLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) return parsed;
  return DEFAULT_TOP_LIMIT;
}

type MinuteAccumulatorDeps = {
  now?: () => string;
};

export class MinuteAccumulator {
  private readonly now: () => string;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: MinuteAccumulatorDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private async readState(): Promise<MinuteAccumulatorState> {
    const raw = await this.state.storage.get(STATE_KEY);
    return loadState(raw);
  }

  private async writeState(next: MinuteAccumulatorState): Promise<void> {
    await this.state.storage.put(STATE_KEY, next);
  }

  private applyMarks(input: {
    state: MinuteAccumulatorState;
    marks: Mark[];
    observedAt: string;
  }): { marksAccepted: number; minutesTouched: Set<MinuteId> } {
    const minutesTouched = new Set<MinuteId>();
    let marksAccepted = 0;

    for (const mark of input.marks) {
      const minute = toMinuteId(mark.ts);
      if (!minute) continue;

      let minuteRecord = input.state.minutes[minute];
      if (!minuteRecord) {
        minuteRecord = createMinuteRecord(minute, input.observedAt);
        input.state.minutes[minute] = minuteRecord;
      }

      const eventId = markEventId(mark);
      const prev = minuteRecord.marksById[eventId];
      const changed = !prev || JSON.stringify(prev) !== JSON.stringify(mark);
      if (!changed) continue;

      minuteRecord.marksById[eventId] = mark;
      minuteRecord.revision += 1;
      minuteRecord.updatedAt = input.observedAt;
      marksAccepted += 1;
      minutesTouched.add(minute);
    }

    if (minutesTouched.size > 0) {
      const latest = [...minutesTouched].sort(compareMinutes).at(-1) ?? null;
      input.state.currentMinute = latest;
      input.state.updatedAt = input.observedAt;
    }

    capTrackedMinutes(input.state);
    return { marksAccepted, minutesTouched };
  }

  private async finalizeMinutes(input: {
    state: MinuteAccumulatorState;
    upToMinute: MinuteId;
    observedAt: string;
  }): Promise<MinuteAccumulatorFinalizeResult> {
    const minuteIds = Object.keys(input.state.minutes)
      .map((minute) => toMinuteId(minute))
      .filter((minute): minute is MinuteId => minute !== null)
      .sort(compareMinutes);
    const topLimit = parseTopLimit(this.env.LOOP_B_TOP_MOVERS_LIMIT);

    let finalizedMinutes = 0;
    let lastFinalized: MinuteId | null = input.state.lastFinalizedMinute;

    for (const minuteId of minuteIds) {
      if (compareMinutes(minuteId, input.upToMinute) > 0) break;

      const minuteRecord = input.state.minutes[minuteId];
      if (!minuteRecord) continue;
      if (minuteRecord.revision === minuteRecord.finalizedRevision) continue;

      await publishFinalizedMinute({
        env: this.env,
        minute: minuteId,
        minuteRecord,
        generatedAt: input.observedAt,
        topLimit,
      });
      minuteRecord.finalizedRevision = minuteRecord.revision;
      minuteRecord.updatedAt = input.observedAt;
      finalizedMinutes += 1;
      lastFinalized = minuteId;
    }

    input.state.lastFinalizedMinute = lastFinalized;
    input.state.updatedAt = input.observedAt;
    await putKvJson(
      this.env,
      LOOP_B_HEALTH_KEY,
      buildHealthArtifact({
        state: input.state,
        generatedAt: input.observedAt,
      }),
    );

    return {
      finalizedMinutes,
      minutesConsidered: minuteIds.length,
      lastFinalizedMinute: input.state.lastFinalizedMinute,
    };
  }

  private async setNextMinuteAlarm(observedAt: string): Promise<void> {
    const next = new Date(observedAt);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(next.getUTCMinutes() + 1);
    await this.state.storage.setAlarm(next.getTime() + 1000);
  }

  private async handleIngest(request: Request): Promise<Response> {
    const body = (await request.json()) as IngestRequest;
    const rawMarks = Array.isArray(body.marks) ? body.marks : [];
    const observedAt = body.observedAt ?? this.now();

    const marks: Mark[] = [];
    for (const rawMark of rawMarks) {
      const parsed = safeParseMark(rawMark);
      if (!parsed.success) continue;
      marks.push(parsed.data);
    }

    const state = await this.readState();
    const applied = this.applyMarks({
      state,
      marks,
      observedAt,
    });
    const finalizeResult = await this.finalizeMinutes({
      state,
      upToMinute: previousMinute(observedAt),
      observedAt,
    });
    await this.writeState(state);
    await this.setNextMinuteAlarm(observedAt);

    const result: MinuteAccumulatorIngestResult = {
      marksReceived: rawMarks.length,
      marksAccepted: applied.marksAccepted,
      minutesTouched: applied.minutesTouched.size,
      finalizedMinutes: finalizeResult.finalizedMinutes,
    };

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  private async handleFinalize(request: Request): Promise<Response> {
    const body = (await request.json()) as FinalizeRequest;
    const observedAt = body.observedAt ?? this.now();
    const upToMinute =
      toMinuteId(body.upToMinute ?? "") ?? previousMinute(observedAt);

    const state = await this.readState();
    const result = await this.finalizeMinutes({
      state,
      upToMinute,
      observedAt,
    });
    await this.writeState(state);

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      (url.pathname === "/loop-b/ingest" ||
        url.pathname === "/internal/loop-b/ingest")
    ) {
      return await this.handleIngest(request);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/loop-b/finalize" ||
        url.pathname === "/internal/loop-b/finalize")
    ) {
      return await this.handleFinalize(request);
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/loop-b/state" ||
        url.pathname === "/internal/loop-b/state")
    ) {
      const state = await this.readState();
      return new Response(JSON.stringify({ ok: true, state }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "not-found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  async alarm(): Promise<void> {
    const observedAt = this.now();
    const state = await this.readState();
    await this.finalizeMinutes({
      state,
      upToMinute: previousMinute(observedAt),
      observedAt,
    });
    await this.writeState(state);
  }
}

export async function publishMarksToMinuteAccumulator(
  env: Env,
  input: {
    marks: Mark[];
    observedAt?: string;
  },
): Promise<MinuteAccumulatorIngestResult | null> {
  if (!env.LOOP_B_MINUTE_ACCUMULATOR_DO || input.marks.length === 0)
    return null;
  const enabled =
    String(env.LOOP_B_MINUTE_ACCUMULATOR_ENABLED ?? "0").trim() === "1";
  if (!enabled) return null;

  const id = env.LOOP_B_MINUTE_ACCUMULATOR_DO.idFromName(
    LOOP_B_MINUTE_ACCUMULATOR_NAME,
  );
  const stub = env.LOOP_B_MINUTE_ACCUMULATOR_DO.get(id);
  const response = await stub.fetch("https://internal/loop-b/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      marks: input.marks,
      observedAt: input.observedAt,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `loop-b-minute-accumulator-ingest-failed:${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    ok: boolean;
    result?: MinuteAccumulatorIngestResult;
  };
  return payload.ok && payload.result ? payload.result : null;
}
