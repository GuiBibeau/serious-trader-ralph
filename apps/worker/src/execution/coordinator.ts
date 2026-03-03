import type { Env } from "../types";
import {
  createExecutionDecision,
  type ExecutionDecision,
  type ExecutionIntent,
} from "./contracts";

const STATE_KEY = "execution:coordinator_state:v1";
const SCHEMA_VERSION = "v1" as const;
const DEFAULT_AUCTION_WINDOW_MS = 250;
const DEFAULT_DECISION_LEASE_MS = 15_000;
const MIN_DECISION_LEASE_MS = 1_000;
const MAX_DECISION_LEASE_MS = 300_000;
const MAX_QUEUE_SIZE = 1_024;

export const EXECUTION_COORDINATOR_NAME = "execution-coordinator-v1";

const ALLOWED_ROUTES = new Set([
  "jupiter",
  "jito_bundle",
  "magicblock_ephemeral_rollup",
]);

type ExecutionLane = "fast" | "protected" | "safe";

type PendingIntent = {
  intent: ExecutionIntent;
  enqueuedAt: string;
};

type InflightDecision = {
  intent: ExecutionIntent;
  decision: ExecutionDecision;
  leasedAt: string;
  leaseExpiresAt: string;
};

type ExecutionCoordinatorState = {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: string;
  decisionCount: number;
  rejectionCount: number;
  queue: PendingIntent[];
  inflight: InflightDecision | null;
};

type SubmitRequest = {
  intent?: unknown;
  mode?: "inline" | "enqueue";
  auctionWindowMs?: unknown;
};

type TickRequest = {
  auctionWindowMs?: unknown;
};

type AckRequest = {
  decisionId?: unknown;
  intentId?: unknown;
};

export type ExecutionCoordinatorDecisionResult = {
  accepted: boolean;
  reason: string | null;
  queueDepth: number;
  queuePosition: number;
  decision?: ExecutionDecision;
  inflightIntentId?: string | null;
  leaseExpiresAt?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseNonNegativeInt(raw: unknown): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function parseAuctionWindowMs(raw: unknown): number {
  const parsed = parseNonNegativeInt(raw);
  if (parsed === null) return DEFAULT_AUCTION_WINDOW_MS;
  return parsed;
}

function parseDecisionLeaseMs(raw: unknown): number {
  const parsed = parseNonNegativeInt(raw);
  if (parsed === null) return DEFAULT_DECISION_LEASE_MS;
  if (parsed < MIN_DECISION_LEASE_MS) return MIN_DECISION_LEASE_MS;
  if (parsed > MAX_DECISION_LEASE_MS) return MAX_DECISION_LEASE_MS;
  return parsed;
}

function parseIso(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseCommitment(
  raw: unknown,
): "processed" | "confirmed" | "finalized" | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "processed" || value === "confirmed" || value === "finalized") {
    return value;
  }
  return null;
}

function parseLane(raw: unknown): ExecutionLane | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "fast" || value === "protected" || value === "safe") {
    return value;
  }
  return null;
}

function parseExecutionDecision(input: unknown): ExecutionDecision | null {
  const record = asRecord(input);
  if (!record || record.schemaVersion !== SCHEMA_VERSION) return null;
  const decisionId = String(record.decisionId ?? "").trim();
  const intentId = String(record.intentId ?? "").trim();
  const decidedAt = parseIso(record.decidedAt);
  const route = String(record.route ?? "").trim();
  const commitment = parseCommitment(record.commitment);
  if (!decisionId || !intentId || !decidedAt || !route || !commitment) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    decisionId,
    intentId,
    decidedAt,
    route,
    simulateOnly: record.simulateOnly === true,
    dryRun: record.dryRun === true,
    commitment,
  };
}

function parseExecutionIntent(input: unknown): ExecutionIntent | null {
  const record = asRecord(input);
  if (!record || record.schemaVersion !== SCHEMA_VERSION) return null;

  const receivedAt = parseIso(record.receivedAt);
  if (!receivedAt) return null;

  const execution = asRecord(record.execution);
  if (!execution) return null;
  const policy = asRecord(record.policy);
  if (!policy) return null;
  const commitment = parseCommitment(policy.commitment);
  if (!commitment) return null;

  const intentId = String(record.intentId ?? "").trim();
  const userId = String(record.userId ?? "").trim();
  const wallet = String(record.wallet ?? "").trim();
  const inputMint = String(record.inputMint ?? "").trim();
  const outputMint = String(record.outputMint ?? "").trim();
  const amountAtomic = String(record.amountAtomic ?? "").trim();
  const source = String(record.source ?? "").trim();
  const adapter = String(execution.adapter ?? "").trim();
  const slippageBps = Number(record.slippageBps);
  const simulateOnly = policy.simulateOnly === true;
  const dryRun = policy.dryRun === true;

  if (
    !intentId ||
    !userId ||
    !wallet ||
    !inputMint ||
    !outputMint ||
    !amountAtomic ||
    !source ||
    !adapter ||
    !Number.isFinite(slippageBps)
  ) {
    return null;
  }

  const params = asRecord(execution.params);
  const normalizedParams: Record<string, unknown> = params ? { ...params } : {};
  const explicitLane = parseLane(record.lane);
  if (explicitLane && parseLane(normalizedParams.lane) === null) {
    normalizedParams.lane = explicitLane;
  }
  const reasonRaw = record.reason;
  return {
    schemaVersion: SCHEMA_VERSION,
    intentId,
    receivedAt,
    userId,
    wallet,
    inputMint,
    outputMint,
    amountAtomic,
    slippageBps,
    source,
    reason:
      typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw : null,
    execution: {
      adapter,
      params:
        Object.keys(normalizedParams).length > 0
          ? { ...normalizedParams }
          : null,
    },
    policy: {
      simulateOnly,
      dryRun,
      commitment,
    },
  };
}

function parseState(input: unknown, now: string): ExecutionCoordinatorState {
  const record = asRecord(input);
  if (!record || record.schemaVersion !== SCHEMA_VERSION) {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: now,
      decisionCount: 0,
      rejectionCount: 0,
      queue: [],
      inflight: null,
    };
  }

  const queueRaw = Array.isArray(record.queue) ? record.queue : [];
  const queue: PendingIntent[] = [];
  for (const item of queueRaw) {
    const parsed = asRecord(item);
    if (!parsed) continue;
    const intent = parseExecutionIntent(parsed.intent);
    const enqueuedAt = parseIso(parsed.enqueuedAt);
    if (!intent || !enqueuedAt) continue;
    queue.push({ intent, enqueuedAt });
  }

  let inflight: InflightDecision | null = null;
  const inflightRaw = asRecord(record.inflight);
  if (inflightRaw) {
    const intent = parseExecutionIntent(inflightRaw.intent);
    const decision = parseExecutionDecision(inflightRaw.decision);
    const leasedAt = parseIso(inflightRaw.leasedAt);
    const leaseExpiresAt = parseIso(inflightRaw.leaseExpiresAt);
    if (intent && decision && leasedAt && leaseExpiresAt) {
      inflight = {
        intent,
        decision,
        leasedAt,
        leaseExpiresAt,
      };
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: parseIso(record.updatedAt) ?? now,
    decisionCount:
      typeof record.decisionCount === "number" && record.decisionCount >= 0
        ? Math.floor(record.decisionCount)
        : 0,
    rejectionCount:
      typeof record.rejectionCount === "number" && record.rejectionCount >= 0
        ? Math.floor(record.rejectionCount)
        : 0,
    queue,
    inflight,
  };
}

function sortQueue(queue: PendingIntent[]): void {
  queue.sort((a, b) => {
    const aTs = Date.parse(a.intent.receivedAt);
    const bTs = Date.parse(b.intent.receivedAt);
    if (aTs !== bTs) return aTs - bTs;
    return a.intent.intentId.localeCompare(b.intent.intentId);
  });
}

function resolveRoute(adapterRaw: string): string {
  const normalized = adapterRaw.trim().toLowerCase();
  return normalized || "jupiter";
}

function resolveIntentLane(intent: ExecutionIntent): ExecutionLane {
  const params = asRecord(intent.execution.params);
  const laneFromParams = parseLane(params?.lane);
  if (laneFromParams) return laneFromParams;

  const route = resolveRoute(intent.execution.adapter);
  if (route === "jito_bundle") return "protected";
  if (route === "jupiter") return "safe";
  return "fast";
}

function resolveAuctionWindowMs(input: {
  env: Env;
  lane: ExecutionLane;
  overrideRaw: unknown;
}): number {
  const explicit = parseNonNegativeInt(input.overrideRaw);
  if (explicit !== null) return explicit;
  const laneRaw =
    input.lane === "safe"
      ? input.env.EXECUTION_AUCTION_WINDOW_SAFE_MS
      : input.lane === "protected"
        ? input.env.EXECUTION_AUCTION_WINDOW_PROTECTED_MS
        : input.env.EXECUTION_AUCTION_WINDOW_FAST_MS;
  const laneWindow = parseNonNegativeInt(laneRaw);
  if (laneWindow !== null) return laneWindow;
  return parseAuctionWindowMs(input.env.EXECUTION_AUCTION_WINDOW_MS);
}

function resolveStateLane(state: ExecutionCoordinatorState): ExecutionLane {
  if (state.inflight) return resolveIntentLane(state.inflight.intent);
  if (state.queue.length > 0) return resolveIntentLane(state.queue[0].intent);
  return "fast";
}

function recoverExpiredInflight(
  state: ExecutionCoordinatorState,
  nowIso: string,
): boolean {
  if (!state.inflight) return false;
  const nowMs = Date.parse(nowIso);
  const expiryMs = Date.parse(state.inflight.leaseExpiresAt);
  if (Number.isNaN(nowMs) || Number.isNaN(expiryMs)) return false;
  if (nowMs < expiryMs) return false;
  state.queue.push({
    intent: state.inflight.intent,
    enqueuedAt: state.inflight.leasedAt,
  });
  state.inflight = null;
  state.rejectionCount += 1;
  sortQueue(state.queue);
  return true;
}

type EnqueueIntentResult =
  | {
      position: number;
      duplicate: "queue" | "inflight" | null;
    }
  | {
      error: "queue-full";
    };

function enqueueIntent(
  state: ExecutionCoordinatorState,
  intent: ExecutionIntent,
  now: string,
): EnqueueIntentResult {
  if (state.inflight?.intent.intentId === intent.intentId) {
    return {
      position: 0,
      duplicate: "inflight",
    };
  }

  const existingIndex = state.queue.findIndex(
    (item) => item.intent.intentId === intent.intentId,
  );
  if (existingIndex >= 0) {
    sortQueue(state.queue);
    const queuePosition =
      state.queue.findIndex(
        (item) => item.intent.intentId === intent.intentId,
      ) + 1;
    return {
      position: queuePosition,
      duplicate: "queue",
    };
  }

  if (state.queue.length >= MAX_QUEUE_SIZE) {
    return { error: "queue-full" };
  }
  state.queue.push({ intent, enqueuedAt: now });
  sortQueue(state.queue);
  const queuePosition =
    state.queue.findIndex((item) => item.intent.intentId === intent.intentId) +
    1;
  return {
    position: queuePosition,
    duplicate: null,
  };
}

function dispatchFromHead(input: {
  state: ExecutionCoordinatorState;
  now: string;
  decisionLeaseMs: number;
}): ExecutionCoordinatorDecisionResult {
  if (input.state.inflight) {
    return {
      accepted: false,
      reason: "inflight-active",
      queueDepth: input.state.queue.length,
      queuePosition: 0,
      inflightIntentId: input.state.inflight.intent.intentId,
      leaseExpiresAt: input.state.inflight.leaseExpiresAt,
    };
  }

  if (input.state.queue.length === 0) {
    return {
      accepted: false,
      reason: "queue-empty",
      queueDepth: 0,
      queuePosition: 0,
    };
  }

  const [head] = input.state.queue.splice(0, 1);
  const route = resolveRoute(head.intent.execution.adapter);
  if (!ALLOWED_ROUTES.has(route)) {
    input.state.rejectionCount += 1;
    return {
      accepted: false,
      reason: `unsupported-route:${route}`,
      queueDepth: input.state.queue.length,
      queuePosition: 0,
    };
  }

  const decision = createExecutionDecision({
    intentId: head.intent.intentId,
    decidedAt: input.now,
    route,
    simulateOnly: head.intent.policy.simulateOnly,
    dryRun: head.intent.policy.dryRun,
    commitment: head.intent.policy.commitment,
  });
  const leaseExpiresAt = new Date(
    Date.parse(input.now) +
      Math.max(MIN_DECISION_LEASE_MS, input.decisionLeaseMs),
  ).toISOString();
  input.state.inflight = {
    intent: head.intent,
    decision,
    leasedAt: input.now,
    leaseExpiresAt,
  };
  input.state.decisionCount += 1;
  return {
    accepted: true,
    reason: null,
    queueDepth: input.state.queue.length,
    queuePosition: 0,
    decision,
    inflightIntentId: head.intent.intentId,
    leaseExpiresAt,
  };
}

function maybeSetAlarm(
  state: DurableObjectState,
  input: {
    queueDepth: number;
    hasInflight: boolean;
    auctionWindowMs: number;
  },
): Promise<void> {
  if (input.queueDepth > 0 || input.hasInflight) {
    return state.storage.setAlarm(
      Date.now() + Math.max(250, input.auctionWindowMs),
    );
  }
  return state.storage.deleteAlarm();
}

type CoordinatorDeps = {
  now?: () => string;
};

function parseAckRequest(
  input: unknown,
): { decisionId: string | null; intentId: string | null } | null {
  const record = asRecord(input);
  if (!record) return null;
  const decisionId = String(record.decisionId ?? "").trim() || null;
  const intentId = String(record.intentId ?? "").trim() || null;
  if (!decisionId && !intentId) return null;
  return { decisionId, intentId };
}

export class ExecutionCoordinator {
  private readonly now: () => string;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: CoordinatorDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private async loadState(): Promise<ExecutionCoordinatorState> {
    const now = this.now();
    const raw = await this.state.storage.get(STATE_KEY);
    return parseState(raw, now);
  }

  private async persistState(next: ExecutionCoordinatorState): Promise<void> {
    await this.state.storage.put(STATE_KEY, next);
  }

  private async handleSubmit(request: Request): Promise<Response> {
    const payload = (await request.json()) as SubmitRequest;
    const now = this.now();
    const mode = payload.mode === "enqueue" ? "enqueue" : "inline";
    const intent = parseExecutionIntent(payload.intent);
    if (!intent) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid-intent" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const state = await this.loadState();
    const recoveredExpiredInflight = recoverExpiredInflight(state, now);
    const enqueue = enqueueIntent(state, intent, now);
    const lane = resolveIntentLane(intent);
    const auctionWindowMs = resolveAuctionWindowMs({
      env: this.env,
      lane,
      overrideRaw: payload.auctionWindowMs,
    });
    if ("error" in enqueue) {
      state.updatedAt = now;
      await this.persistState(state);
      await maybeSetAlarm(this.state, {
        queueDepth: state.queue.length,
        hasInflight: state.inflight !== null,
        auctionWindowMs,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: enqueue.error,
          recoveredExpiredInflight,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const decisionLeaseMs = parseDecisionLeaseMs(
      this.env.EXECUTION_COORDINATOR_LEASE_MS,
    );
    let result: ExecutionCoordinatorDecisionResult;
    if (enqueue.duplicate === "inflight") {
      result = {
        accepted: false,
        reason: "inflight-duplicate",
        queueDepth: state.queue.length,
        queuePosition: 0,
        inflightIntentId: state.inflight?.intent.intentId ?? null,
        leaseExpiresAt: state.inflight?.leaseExpiresAt ?? null,
      };
    } else if (mode === "enqueue") {
      result = {
        accepted: false,
        reason: "queued",
        queueDepth: state.queue.length,
        queuePosition: enqueue.position,
      };
    } else if (enqueue.position > 1) {
      state.rejectionCount += 1;
      result = {
        accepted: false,
        reason: "queued-behind-priority",
        queueDepth: state.queue.length,
        queuePosition: enqueue.position,
      };
    } else {
      result = dispatchFromHead({
        state,
        now,
        decisionLeaseMs,
      });
    }

    state.updatedAt = now;
    await this.persistState(state);
    await maybeSetAlarm(this.state, {
      queueDepth: state.queue.length,
      hasInflight: state.inflight !== null,
      auctionWindowMs,
    });
    return new Response(
      JSON.stringify({ ok: true, result, recoveredExpiredInflight }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  private async handleTick(request: Request, trigger: "fetch" | "alarm") {
    const now = this.now();
    const payload =
      trigger === "fetch" ? ((await request.json()) as TickRequest) : {};
    const state = await this.loadState();
    const recoveredExpiredInflight = recoverExpiredInflight(state, now);
    const decisionLeaseMs = parseDecisionLeaseMs(
      this.env.EXECUTION_COORDINATOR_LEASE_MS,
    );
    const result = dispatchFromHead({
      state,
      now,
      decisionLeaseMs,
    });
    const lane = resolveStateLane(state);
    const auctionWindowMs = resolveAuctionWindowMs({
      env: this.env,
      lane,
      overrideRaw: payload.auctionWindowMs,
    });

    state.updatedAt = now;
    await this.persistState(state);
    await maybeSetAlarm(this.state, {
      queueDepth: state.queue.length,
      hasInflight: state.inflight !== null,
      auctionWindowMs,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        trigger,
        result,
        recoveredExpiredInflight,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  private async handleAck(request: Request): Promise<Response> {
    const now = this.now();
    const payload = (await request.json()) as AckRequest;
    const parsed = parseAckRequest(payload);
    if (!parsed) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid-ack-request" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const state = await this.loadState();
    const recoveredExpiredInflight = recoverExpiredInflight(state, now);
    const inflight = state.inflight;
    if (!inflight) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "no-inflight-decision",
          recoveredExpiredInflight,
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      parsed.decisionId &&
      parsed.decisionId !== inflight.decision.decisionId
    ) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "decision-mismatch",
          expectedDecisionId: inflight.decision.decisionId,
          recoveredExpiredInflight,
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (parsed.intentId && parsed.intentId !== inflight.intent.intentId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "intent-mismatch",
          expectedIntentId: inflight.intent.intentId,
          recoveredExpiredInflight,
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const clearedDecisionId = inflight.decision.decisionId;
    const clearedIntentId = inflight.intent.intentId;
    state.inflight = null;
    state.updatedAt = now;
    const lane = resolveStateLane(state);
    const auctionWindowMs = resolveAuctionWindowMs({
      env: this.env,
      lane,
      overrideRaw: undefined,
    });
    await this.persistState(state);
    await maybeSetAlarm(this.state, {
      queueDepth: state.queue.length,
      hasInflight: state.inflight !== null,
      auctionWindowMs,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          clearedDecisionId,
          clearedIntentId,
          queueDepth: state.queue.length,
        },
        recoveredExpiredInflight,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      (url.pathname === "/execution/intent" ||
        url.pathname === "/internal/execution/intent")
    ) {
      return await this.handleSubmit(request);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/execution/auction/tick" ||
        url.pathname === "/internal/execution/auction/tick")
    ) {
      return await this.handleTick(request, "fetch");
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/execution/ack" ||
        url.pathname === "/internal/execution/ack")
    ) {
      return await this.handleAck(request);
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/execution/state" ||
        url.pathname === "/internal/execution/state")
    ) {
      const state = await this.loadState();
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
    await this.handleTick(
      new Request("https://internal/execution/auction/tick"),
      "alarm",
    );
  }
}

export async function requestExecutionCoordinatorDecision(
  env: Env,
  input: {
    intent: ExecutionIntent;
    mode?: "inline" | "enqueue";
    auctionWindowMs?: number;
  },
): Promise<ExecutionCoordinatorDecisionResult | null> {
  if (!env.EXECUTION_COORDINATOR_DO) return null;
  const enabled =
    String(env.EXECUTION_COORDINATOR_ENABLED ?? "0").trim() === "1";
  if (!enabled) return null;

  const id = env.EXECUTION_COORDINATOR_DO.idFromName(
    EXECUTION_COORDINATOR_NAME,
  );
  const stub = env.EXECUTION_COORDINATOR_DO.get(id);
  const response = await stub.fetch("https://internal/execution/intent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      intent: input.intent,
      mode: input.mode ?? "inline",
      auctionWindowMs: input.auctionWindowMs,
    }),
  });
  if (!response.ok) {
    throw new Error(`execution-coordinator-request-failed:${response.status}`);
  }
  const payload = (await response.json()) as {
    ok: boolean;
    result?: ExecutionCoordinatorDecisionResult;
  };
  return payload.ok ? (payload.result ?? null) : null;
}

export async function acknowledgeExecutionCoordinatorDecision(
  env: Env,
  input: {
    decisionId?: string;
    intentId?: string;
  },
): Promise<boolean | null> {
  if (!env.EXECUTION_COORDINATOR_DO) return null;
  const enabled =
    String(env.EXECUTION_COORDINATOR_ENABLED ?? "0").trim() === "1";
  if (!enabled) return null;

  const decisionId = String(input.decisionId ?? "").trim();
  const intentId = String(input.intentId ?? "").trim();
  if (!decisionId && !intentId) {
    throw new Error("execution-coordinator-ack-missing-identifiers");
  }

  const id = env.EXECUTION_COORDINATOR_DO.idFromName(
    EXECUTION_COORDINATOR_NAME,
  );
  const stub = env.EXECUTION_COORDINATOR_DO.get(id);
  const response = await stub.fetch("https://internal/execution/ack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(decisionId ? { decisionId } : {}),
      ...(intentId ? { intentId } : {}),
    }),
  });
  if (response.status === 409) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`execution-coordinator-ack-failed:${response.status}`);
  }
  return true;
}
