import {
  createExecutionRequestIdempotent,
  type ExecutionActorType,
  type ExecutionLane,
  type ExecutionMode,
  type ExecutionRequestRecord,
  type JsonObject,
} from "./repository";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function stableOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableOrder(entry));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    ordered[key] = stableOrder(record[key]);
  }
  return ordered;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableOrder(value));
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function normalizeIdempotencyKey(value: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);
}

export function readIdempotencyKey(request: Request): string | null {
  return normalizeIdempotencyKey(request.headers.get(IDEMPOTENCY_KEY_HEADER));
}

export function idempotencyScopeForActor(input: {
  actorType: ExecutionActorType;
  actorId?: string | null;
}): string {
  const actorId = String(input.actorId ?? "").trim();
  if (actorId) return `${input.actorType}:${actorId}`;
  if (input.actorType === "anonymous_x402") return "anonymous_x402:anon";
  return `${input.actorType}:unknown`;
}

export async function hashExecutionSubmitPayload(
  payload: unknown,
): Promise<string> {
  return sha256Hex(stableStringify(payload ?? null));
}

export type ExecutionIdempotencyReservation =
  | {
      result: "created";
      request: ExecutionRequestRecord;
      idempotencyScope: string;
    }
  | {
      result: "replay";
      request: ExecutionRequestRecord;
      idempotencyScope: string;
    }
  | {
      result: "conflict";
      request: ExecutionRequestRecord;
      idempotencyScope: string;
      error: "idempotency-key-conflict";
    };

export async function reserveExecutionSubmitRequest(input: {
  db: D1Database;
  requestId: string;
  idempotencyKey: string;
  actorType: ExecutionActorType;
  actorId?: string | null;
  mode: ExecutionMode;
  lane: ExecutionLane;
  payloadHash: string;
  metadata?: JsonObject | null;
  nowIso?: string;
}): Promise<ExecutionIdempotencyReservation> {
  const idempotencyScope = idempotencyScopeForActor({
    actorType: input.actorType,
    actorId: input.actorId ?? null,
  });
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) {
    throw new Error("missing-idempotency-key");
  }

  const upserted = await createExecutionRequestIdempotent(input.db, {
    requestId: input.requestId,
    idempotencyScope,
    idempotencyKey,
    payloadHash: input.payloadHash,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    mode: input.mode,
    lane: input.lane,
    status: "received",
    metadata: input.metadata ?? null,
    nowIso: input.nowIso,
  });

  if (upserted.created) {
    return {
      result: "created",
      request: upserted.row,
      idempotencyScope,
    };
  }

  if (upserted.row.payloadHash !== input.payloadHash) {
    return {
      result: "conflict",
      request: upserted.row,
      idempotencyScope,
      error: "idempotency-key-conflict",
    };
  }

  return {
    result: "replay",
    request: upserted.row,
    idempotencyScope,
  };
}
