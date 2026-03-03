import type { Env } from "../types";
import type { ExecutionActorType, JsonObject } from "./repository";

const DEFAULT_MAX_PAYLOAD_BYTES = 32_768;
const DEFAULT_MAX_PAYLOAD_DEPTH = 12;
const DEFAULT_MAX_PAYLOAD_KEYS = 512;
const DEFAULT_MAX_PAYLOAD_NODES = 2_048;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_IP_MAX = 120;
const DEFAULT_RATE_LIMIT_ACTOR_MAX = 60;
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 15;
const DEFAULT_DUPLICATE_BURST_MAX = 12;
const DEFAULT_KV_PREFIX = "exec_submit_abuse:v1";

const LOCAL_COUNTERS = new Map<
  string,
  {
    count: number;
    expiresAtMs: number;
  }
>();

type PayloadShapeMetrics = {
  depth: number;
  nodes: number;
  keys: number;
};

type SubmitPayloadLimits = {
  maxPayloadBytes: number;
  maxPayloadDepth: number;
  maxPayloadNodes: number;
  maxPayloadKeys: number;
};

type SubmitRateLimits = {
  windowSeconds: number;
  ipMax: number;
  actorMax: number;
  duplicateWindowSeconds: number;
  duplicateBurstMax: number;
};

type SubmitBlocklists = {
  blockedIps: Set<string>;
  blockedActors: Set<string>;
  blockedIdempotencyKeys: Set<string>;
};

type ResolvedAbuseGuardConfig = SubmitPayloadLimits &
  SubmitRateLimits &
  SubmitBlocklists & {
    enabled: boolean;
    kvPrefix: string;
  };

export type ExecSubmitPayloadReadResult =
  | {
      ok: true;
      payload: Record<string, unknown>;
      metadata: JsonObject;
    }
  | {
      ok: false;
      status: number;
      error: "invalid-request";
      reason:
        | "invalid-content-type"
        | "payload-too-large"
        | "invalid-json-payload"
        | "payload-shape-limit-exceeded";
      metadata: JsonObject;
    };

export type ExecSubmitAbuseGuardResult =
  | {
      ok: true;
      metadata: JsonObject;
    }
  | {
      ok: false;
      status: 403 | 429;
      error: "policy-denied";
      reason:
        | "submit-ip-blocklisted"
        | "submit-actor-blocklisted"
        | "submit-idempotency-blocklisted"
        | "submit-ip-rate-limit-exceeded"
        | "submit-actor-rate-limit-exceeded"
        | "submit-duplicate-burst-limit-exceeded";
      retryAfterSeconds: number | null;
      metadata: JsonObject;
    };

function parsePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.floor(numeric);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parseCsvSet(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function resolveConfig(env: Env): ResolvedAbuseGuardConfig {
  return {
    enabled: readBoolean(env.EXEC_SUBMIT_ABUSE_GUARD_ENABLED, true),
    maxPayloadBytes: parsePositiveInt(
      env.EXEC_SUBMIT_MAX_PAYLOAD_BYTES,
      DEFAULT_MAX_PAYLOAD_BYTES,
      1_024,
      262_144,
    ),
    maxPayloadDepth: parsePositiveInt(
      env.EXEC_SUBMIT_MAX_PAYLOAD_DEPTH,
      DEFAULT_MAX_PAYLOAD_DEPTH,
      2,
      64,
    ),
    maxPayloadKeys: parsePositiveInt(
      env.EXEC_SUBMIT_MAX_PAYLOAD_KEYS,
      DEFAULT_MAX_PAYLOAD_KEYS,
      8,
      20_000,
    ),
    maxPayloadNodes: parsePositiveInt(
      env.EXEC_SUBMIT_MAX_PAYLOAD_NODES,
      DEFAULT_MAX_PAYLOAD_NODES,
      16,
      100_000,
    ),
    windowSeconds: parsePositiveInt(
      env.EXEC_SUBMIT_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      1,
      3_600,
    ),
    ipMax: parsePositiveInt(
      env.EXEC_SUBMIT_RATE_LIMIT_IP_MAX,
      DEFAULT_RATE_LIMIT_IP_MAX,
      1,
      10_000,
    ),
    actorMax: parsePositiveInt(
      env.EXEC_SUBMIT_RATE_LIMIT_ACTOR_MAX,
      DEFAULT_RATE_LIMIT_ACTOR_MAX,
      1,
      10_000,
    ),
    duplicateWindowSeconds: parsePositiveInt(
      env.EXEC_SUBMIT_DUPLICATE_WINDOW_SECONDS,
      DEFAULT_DUPLICATE_WINDOW_SECONDS,
      1,
      600,
    ),
    duplicateBurstMax: parsePositiveInt(
      env.EXEC_SUBMIT_DUPLICATE_BURST_MAX,
      DEFAULT_DUPLICATE_BURST_MAX,
      1,
      1_000,
    ),
    blockedIps: parseCsvSet(env.EXEC_SUBMIT_BLOCKLIST_IPS),
    blockedActors: parseCsvSet(env.EXEC_SUBMIT_BLOCKLIST_ACTORS),
    blockedIdempotencyKeys: parseCsvSet(
      env.EXEC_SUBMIT_BLOCKLIST_IDEMPOTENCY_KEYS,
    ),
    kvPrefix:
      String(env.EXEC_SUBMIT_ABUSE_KV_PREFIX ?? "").trim() || DEFAULT_KV_PREFIX,
  };
}

function readClientIp(request: Request): string {
  const direct = String(request.headers.get("cf-connecting-ip") ?? "").trim();
  if (direct) return direct;
  const forwarded = String(request.headers.get("x-forwarded-for") ?? "").trim();
  if (!forwarded) return "unknown";
  const first = forwarded.split(",")[0];
  return String(first ?? "").trim() || "unknown";
}

function analyzePayloadShape(
  payload: unknown,
  limits: SubmitPayloadLimits,
):
  | { ok: true; metrics: PayloadShapeMetrics }
  | { ok: false; metrics: PayloadShapeMetrics } {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: payload, depth: 1 },
  ];
  const metrics: PayloadShapeMetrics = {
    depth: 0,
    nodes: 0,
    keys: 0,
  };

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    metrics.nodes += 1;
    if (current.depth > metrics.depth) {
      metrics.depth = current.depth;
    }
    if (
      metrics.nodes > limits.maxPayloadNodes ||
      metrics.depth > limits.maxPayloadDepth
    ) {
      return { ok: false, metrics };
    }

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }

    if (!current.value || typeof current.value !== "object") {
      continue;
    }

    const record = current.value as Record<string, unknown>;
    const keys = Object.keys(record);
    metrics.keys += keys.length;
    if (metrics.keys > limits.maxPayloadKeys) {
      return { ok: false, metrics };
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      stack.push({
        value: record[key],
        depth: current.depth + 1,
      });
    }
  }

  return {
    ok: true,
    metrics,
  };
}

async function incrementCounter(input: {
  env: Env;
  key: string;
  ttlSeconds: number;
}): Promise<number> {
  if (input.env.CONFIG_KV) {
    const raw = await input.env.CONFIG_KV.get(input.key);
    const current = parsePositiveInt(raw, 0, 0, 1_000_000_000);
    const next = current + 1;
    await input.env.CONFIG_KV.put(input.key, String(next), {
      expirationTtl: input.ttlSeconds,
    } as KVNamespacePutOptions);
    return next;
  }

  const now = Date.now();
  const existing = LOCAL_COUNTERS.get(input.key);
  if (existing && existing.expiresAtMs > now) {
    existing.count += 1;
    LOCAL_COUNTERS.set(input.key, existing);
    return existing.count;
  }
  LOCAL_COUNTERS.set(input.key, {
    count: 1,
    expiresAtMs: now + input.ttlSeconds * 1_000,
  });
  return 1;
}

function actorScope(
  actorType: ExecutionActorType,
  actorId: string | null,
): string {
  const normalizedActorId = String(actorId ?? "").trim();
  if (normalizedActorId) return `${actorType}:${normalizedActorId}`;
  if (actorType === "anonymous_x402") return "anonymous_x402:anon";
  return `${actorType}:unknown`;
}

export async function readExecSubmitPayloadWithLimits(
  request: Request,
  env: Env,
): Promise<ExecSubmitPayloadReadResult> {
  const config = resolveConfig(env);
  const contentType = String(request.headers.get("content-type") ?? "")
    .trim()
    .toLowerCase();
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      status: 400,
      error: "invalid-request",
      reason: "invalid-content-type",
      metadata: {
        contentType,
      },
    };
  }

  const contentLength = parsePositiveInt(
    request.headers.get("content-length"),
    0,
    0,
    100_000_000,
  );
  if (contentLength > config.maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      error: "invalid-request",
      reason: "payload-too-large",
      metadata: {
        contentLength,
        maxPayloadBytes: config.maxPayloadBytes,
      },
    };
  }

  const rawText = await request.text();
  const bodyBytes = new TextEncoder().encode(rawText).byteLength;
  if (bodyBytes > config.maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      error: "invalid-request",
      reason: "payload-too-large",
      metadata: {
        bodyBytes,
        maxPayloadBytes: config.maxPayloadBytes,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid-request",
      reason: "invalid-json-payload",
      metadata: {
        bodyBytes,
      },
    };
  }

  const shape = analyzePayloadShape(parsed, config);
  if (!shape.ok) {
    return {
      ok: false,
      status: 400,
      error: "invalid-request",
      reason: "payload-shape-limit-exceeded",
      metadata: {
        bodyBytes,
        depth: shape.metrics.depth,
        nodes: shape.metrics.nodes,
        keys: shape.metrics.keys,
        maxPayloadDepth: config.maxPayloadDepth,
        maxPayloadNodes: config.maxPayloadNodes,
        maxPayloadKeys: config.maxPayloadKeys,
      },
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      status: 400,
      error: "invalid-request",
      reason: "invalid-json-payload",
      metadata: {
        bodyBytes,
        depth: shape.metrics.depth,
        nodes: shape.metrics.nodes,
        keys: shape.metrics.keys,
      },
    };
  }

  return {
    ok: true,
    payload: parsed as Record<string, unknown>,
    metadata: {
      bodyBytes,
      depth: shape.metrics.depth,
      nodes: shape.metrics.nodes,
      keys: shape.metrics.keys,
      maxPayloadBytes: config.maxPayloadBytes,
      maxPayloadDepth: config.maxPayloadDepth,
      maxPayloadNodes: config.maxPayloadNodes,
      maxPayloadKeys: config.maxPayloadKeys,
    },
  };
}

export async function enforceExecSubmitAbuseGuard(input: {
  env: Env;
  request: Request;
  actorType: ExecutionActorType;
  actorId: string | null;
  idempotencyKey: string;
}): Promise<ExecSubmitAbuseGuardResult> {
  const config = resolveConfig(input.env);
  const ip = readClientIp(input.request);
  const actor = actorScope(input.actorType, input.actorId);

  if (!config.enabled) {
    return {
      ok: true,
      metadata: {
        enabled: false,
      },
    };
  }

  if (config.blockedIps.has(ip)) {
    return {
      ok: false,
      status: 403,
      error: "policy-denied",
      reason: "submit-ip-blocklisted",
      retryAfterSeconds: null,
      metadata: {
        ip,
        actor,
      },
    };
  }

  if (
    config.blockedActors.has(actor) ||
    config.blockedActors.has(String(input.actorId ?? "").trim())
  ) {
    return {
      ok: false,
      status: 403,
      error: "policy-denied",
      reason: "submit-actor-blocklisted",
      retryAfterSeconds: null,
      metadata: {
        ip,
        actor,
      },
    };
  }

  if (config.blockedIdempotencyKeys.has(input.idempotencyKey)) {
    return {
      ok: false,
      status: 403,
      error: "policy-denied",
      reason: "submit-idempotency-blocklisted",
      retryAfterSeconds: null,
      metadata: {
        ip,
        actor,
      },
    };
  }

  const nowMs = Date.now();
  const windowBucket = Math.floor(nowMs / (config.windowSeconds * 1_000));
  const duplicateBucket = Math.floor(
    nowMs / (config.duplicateWindowSeconds * 1_000),
  );
  const ipCounterKey = `${config.kvPrefix}:ip:${windowBucket}:${ip}`;
  const actorCounterKey = `${config.kvPrefix}:actor:${windowBucket}:${actor}`;
  const duplicateCounterKey = `${config.kvPrefix}:dup:${duplicateBucket}:${actor}:${input.idempotencyKey}`;

  const [ipCount, actorCount, duplicateCount] = await Promise.all([
    incrementCounter({
      env: input.env,
      key: ipCounterKey,
      ttlSeconds: config.windowSeconds,
    }),
    incrementCounter({
      env: input.env,
      key: actorCounterKey,
      ttlSeconds: config.windowSeconds,
    }),
    incrementCounter({
      env: input.env,
      key: duplicateCounterKey,
      ttlSeconds: config.duplicateWindowSeconds,
    }),
  ]);

  const metadata: JsonObject = {
    enabled: true,
    ip,
    actor,
    counters: {
      ipCount,
      ipMax: config.ipMax,
      actorCount,
      actorMax: config.actorMax,
      duplicateCount,
      duplicateBurstMax: config.duplicateBurstMax,
      windowSeconds: config.windowSeconds,
      duplicateWindowSeconds: config.duplicateWindowSeconds,
    },
  };

  if (ipCount > config.ipMax) {
    return {
      ok: false,
      status: 429,
      error: "policy-denied",
      reason: "submit-ip-rate-limit-exceeded",
      retryAfterSeconds: config.windowSeconds,
      metadata,
    };
  }

  if (actorCount > config.actorMax) {
    return {
      ok: false,
      status: 429,
      error: "policy-denied",
      reason: "submit-actor-rate-limit-exceeded",
      retryAfterSeconds: config.windowSeconds,
      metadata,
    };
  }

  if (duplicateCount > config.duplicateBurstMax) {
    return {
      ok: false,
      status: 429,
      error: "policy-denied",
      reason: "submit-duplicate-burst-limit-exceeded",
      retryAfterSeconds: config.duplicateWindowSeconds,
      metadata,
    };
  }

  return {
    ok: true,
    metadata,
  };
}
