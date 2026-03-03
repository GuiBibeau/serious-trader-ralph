export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type ExecutionActorType =
  | "anonymous_x402"
  | "privy_user"
  | "api_key_actor";
export type ExecutionMode = "relay_signed" | "privy_execute";
export type ExecutionLane = "fast" | "protected" | "safe";
export type ExecutionStatus =
  | "received"
  | "validated"
  | "dispatched"
  | "landed"
  | "failed"
  | "expired"
  | "rejected";
export type ExecutionTerminalStatus = Extract<
  ExecutionStatus,
  "landed" | "failed" | "expired" | "rejected"
>;

export const EXECUTION_TERMINAL_STATUSES = new Set<ExecutionStatus>([
  "landed",
  "failed",
  "expired",
  "rejected",
]);

type D1RunResultLike = {
  meta?: {
    changes?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function stringOrNull(value: unknown): string | null {
  const parsed = String(value ?? "").trim();
  return parsed ? parsed : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

function toJsonString(value: JsonObject | null | undefined): string | null {
  if (!value || !isRecord(value)) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function runChanges(value: unknown): number {
  if (!isRecord(value)) return 0;
  const meta = (value as D1RunResultLike).meta;
  if (!isRecord(meta)) return 0;
  return numberValue(meta.changes, 0);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("unique constraint failed");
}

export function executionNowIso(now = new Date()): string {
  return now.toISOString();
}

export type ExecutionRequestRecord = {
  requestId: string;
  schemaVersion: string;
  idempotencyScope: string;
  idempotencyKey: string;
  payloadHash: string;
  actorType: ExecutionActorType;
  actorId: string | null;
  mode: ExecutionMode;
  lane: ExecutionLane;
  status: ExecutionStatus;
  statusReason: string | null;
  metadata: JsonObject | null;
  receivedAt: string;
  validatedAt: string | null;
  terminalAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionAttemptRecord = {
  attemptId: string;
  requestId: string;
  attemptNo: number;
  lane: ExecutionLane;
  provider: string;
  status: string;
  providerRequestId: string | null;
  providerResponse: JsonObject | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionStatusEventRecord = {
  eventId: string;
  requestId: string;
  seq: number;
  status: ExecutionStatus;
  reason: string | null;
  details: JsonObject | null;
  createdAt: string;
};

export type ExecutionReceiptRecord = {
  requestId: string;
  receiptId: string;
  schemaVersion: string;
  finalizedStatus: string;
  lane: ExecutionLane;
  provider: string | null;
  signature: string | null;
  slot: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  receipt: JsonObject | null;
  readyAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionLatestStatusRecord = {
  request: ExecutionRequestRecord;
  latestEvent: ExecutionStatusEventRecord | null;
  latestAttempt: ExecutionAttemptRecord | null;
  receipt: ExecutionReceiptRecord | null;
};

function mapExecutionRequestRow(
  row: Record<string, unknown>,
): ExecutionRequestRecord {
  return {
    requestId: stringValue(row.requestId),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    idempotencyScope: stringValue(row.idempotencyScope),
    idempotencyKey: stringValue(row.idempotencyKey),
    payloadHash: stringValue(row.payloadHash),
    actorType:
      stringValue(row.actorType) === "privy_user" ||
      stringValue(row.actorType) === "api_key_actor"
        ? (stringValue(row.actorType) as ExecutionActorType)
        : "anonymous_x402",
    actorId: stringOrNull(row.actorId),
    mode:
      stringValue(row.mode) === "privy_execute"
        ? "privy_execute"
        : "relay_signed",
    lane:
      stringValue(row.lane) === "protected" || stringValue(row.lane) === "safe"
        ? (stringValue(row.lane) as ExecutionLane)
        : "fast",
    status:
      EXECUTION_TERMINAL_STATUSES.has(
        stringValue(row.status) as ExecutionStatus,
      ) ||
      stringValue(row.status) === "received" ||
      stringValue(row.status) === "validated" ||
      stringValue(row.status) === "dispatched"
        ? (stringValue(row.status) as ExecutionStatus)
        : "received",
    statusReason: stringOrNull(row.statusReason),
    metadata: parseJsonObject(row.metadataJson),
    receivedAt: stringValue(row.receivedAt),
    validatedAt: stringOrNull(row.validatedAt),
    terminalAt: stringOrNull(row.terminalAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

function mapExecutionAttemptRow(
  row: Record<string, unknown>,
): ExecutionAttemptRecord {
  return {
    attemptId: stringValue(row.attemptId),
    requestId: stringValue(row.requestId),
    attemptNo: numberValue(row.attemptNo),
    lane:
      stringValue(row.lane) === "protected" || stringValue(row.lane) === "safe"
        ? (stringValue(row.lane) as ExecutionLane)
        : "fast",
    provider: stringValue(row.provider),
    status: stringValue(row.status),
    providerRequestId: stringOrNull(row.providerRequestId),
    providerResponse: parseJsonObject(row.providerResponseJson),
    errorCode: stringOrNull(row.errorCode),
    errorMessage: stringOrNull(row.errorMessage),
    startedAt: stringValue(row.startedAt),
    completedAt: stringOrNull(row.completedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

function mapExecutionStatusEventRow(
  row: Record<string, unknown>,
): ExecutionStatusEventRecord {
  return {
    eventId: stringValue(row.eventId),
    requestId: stringValue(row.requestId),
    seq: numberValue(row.seq),
    status:
      stringValue(row.status) === "validated" ||
      stringValue(row.status) === "dispatched" ||
      stringValue(row.status) === "landed" ||
      stringValue(row.status) === "failed" ||
      stringValue(row.status) === "expired" ||
      stringValue(row.status) === "rejected"
        ? (stringValue(row.status) as ExecutionStatus)
        : "received",
    reason: stringOrNull(row.reason),
    details: parseJsonObject(row.detailsJson),
    createdAt: stringValue(row.createdAt),
  };
}

function mapExecutionReceiptRow(
  row: Record<string, unknown>,
): ExecutionReceiptRecord {
  return {
    requestId: stringValue(row.requestId),
    receiptId: stringValue(row.receiptId),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    finalizedStatus: stringValue(row.finalizedStatus),
    lane:
      stringValue(row.lane) === "protected" || stringValue(row.lane) === "safe"
        ? (stringValue(row.lane) as ExecutionLane)
        : "fast",
    provider: stringOrNull(row.provider),
    signature: stringOrNull(row.signature),
    slot:
      row.slot === null || row.slot === undefined
        ? null
        : numberValue(row.slot, 0),
    errorCode: stringOrNull(row.errorCode),
    errorMessage: stringOrNull(row.errorMessage),
    receipt: parseJsonObject(row.receiptJson),
    readyAt: stringValue(row.readyAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

export async function getExecutionRequestById(
  db: D1Database,
  requestId: string,
): Promise<ExecutionRequestRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        request_id as requestId,
        schema_version as schemaVersion,
        idempotency_scope as idempotencyScope,
        idempotency_key as idempotencyKey,
        payload_hash as payloadHash,
        actor_type as actorType,
        actor_id as actorId,
        mode,
        lane,
        status,
        status_reason as statusReason,
        metadata_json as metadataJson,
        received_at as receivedAt,
        validated_at as validatedAt,
        terminal_at as terminalAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_requests
      WHERE request_id = ?1
      LIMIT 1
      `,
    )
    .bind(requestId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionRequestRow(row);
}

export async function getExecutionRequestByIdempotency(
  db: D1Database,
  idempotencyScope: string,
  idempotencyKey: string,
): Promise<ExecutionRequestRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        request_id as requestId,
        schema_version as schemaVersion,
        idempotency_scope as idempotencyScope,
        idempotency_key as idempotencyKey,
        payload_hash as payloadHash,
        actor_type as actorType,
        actor_id as actorId,
        mode,
        lane,
        status,
        status_reason as statusReason,
        metadata_json as metadataJson,
        received_at as receivedAt,
        validated_at as validatedAt,
        terminal_at as terminalAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_requests
      WHERE idempotency_scope = ?1
        AND idempotency_key = ?2
      LIMIT 1
      `,
    )
    .bind(idempotencyScope, idempotencyKey)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionRequestRow(row);
}

export async function createExecutionRequestIdempotent(
  db: D1Database,
  input: {
    requestId: string;
    idempotencyScope: string;
    idempotencyKey: string;
    payloadHash: string;
    actorType: ExecutionActorType;
    actorId?: string | null;
    mode: ExecutionMode;
    lane: ExecutionLane;
    status?: ExecutionStatus;
    statusReason?: string | null;
    metadata?: JsonObject | null;
    nowIso?: string;
  },
): Promise<{ created: boolean; row: ExecutionRequestRecord }> {
  const existing = await getExecutionRequestByIdempotency(
    db,
    input.idempotencyScope,
    input.idempotencyKey,
  );
  if (existing) {
    return { created: false, row: existing };
  }

  const nowIso = input.nowIso ?? executionNowIso();
  const status = input.status ?? "received";
  try {
    await db
      .prepare(
        `
        INSERT INTO execution_requests (
          request_id,
          schema_version,
          idempotency_scope,
          idempotency_key,
          payload_hash,
          actor_type,
          actor_id,
          mode,
          lane,
          status,
          status_reason,
          metadata_json,
          received_at,
          created_at,
          updated_at
        ) VALUES (?1, 'v1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12)
        `,
      )
      .bind(
        input.requestId,
        input.idempotencyScope,
        input.idempotencyKey,
        input.payloadHash,
        input.actorType,
        input.actorId ?? null,
        input.mode,
        input.lane,
        status,
        input.statusReason ?? null,
        toJsonString(input.metadata),
        nowIso,
      )
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await getExecutionRequestByIdempotency(
      db,
      input.idempotencyScope,
      input.idempotencyKey,
    );
    if (!raced) throw error;
    return { created: false, row: raced };
  }

  const created = await getExecutionRequestById(db, input.requestId);
  if (!created) {
    throw new Error("execution-request-create-failed");
  }
  return { created: true, row: created };
}

export async function updateExecutionRequestStatus(
  db: D1Database,
  input: {
    requestId: string;
    status: ExecutionStatus;
    statusReason?: string | null;
    nowIso?: string;
  },
): Promise<ExecutionRequestRecord | null> {
  const nowIso = input.nowIso ?? executionNowIso();
  await db
    .prepare(
      `
      UPDATE execution_requests
      SET
        status = ?1,
        status_reason = ?2,
        validated_at = CASE
          WHEN ?1 = 'validated' AND validated_at IS NULL THEN ?3
          ELSE validated_at
        END,
        updated_at = ?3
      WHERE request_id = ?4
      `,
    )
    .bind(input.status, input.statusReason ?? null, nowIso, input.requestId)
    .run();
  return getExecutionRequestById(db, input.requestId);
}

export async function appendExecutionStatusEvent(
  db: D1Database,
  input: {
    eventId?: string;
    requestId: string;
    status: ExecutionStatus;
    reason?: string | null;
    details?: JsonObject | null;
    createdAt?: string;
  },
): Promise<ExecutionStatusEventRecord> {
  const createdAt = input.createdAt ?? executionNowIso();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextSeqRow = (await db
      .prepare(
        `
        SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq
        FROM execution_status_events
        WHERE request_id = ?1
        `,
      )
      .bind(input.requestId)
      .first()) as unknown;
    const nextSeq = isRecord(nextSeqRow)
      ? Math.max(1, numberValue(nextSeqRow.nextSeq, 1))
      : 1;
    const eventId = input.eventId ?? crypto.randomUUID();
    try {
      await db
        .prepare(
          `
          INSERT INTO execution_status_events (
            event_id,
            request_id,
            seq,
            status,
            reason,
            details_json,
            created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          `,
        )
        .bind(
          eventId,
          input.requestId,
          nextSeq,
          input.status,
          input.reason ?? null,
          toJsonString(input.details),
          createdAt,
        )
        .run();

      const row = (await db
        .prepare(
          `
          SELECT
            event_id as eventId,
            request_id as requestId,
            seq,
            status,
            reason,
            details_json as detailsJson,
            created_at as createdAt
          FROM execution_status_events
          WHERE event_id = ?1
          LIMIT 1
          `,
        )
        .bind(eventId)
        .first()) as unknown;
      if (!isRecord(row)) {
        throw new Error("execution-status-event-read-failed");
      }
      return mapExecutionStatusEventRow(row);
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 4) {
        throw error;
      }
    }
  }
  throw new Error("execution-status-event-create-failed");
}

export async function listExecutionStatusEvents(
  db: D1Database,
  requestId: string,
  limit = 100,
): Promise<ExecutionStatusEventRecord[]> {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = (await db
    .prepare(
      `
      SELECT
        event_id as eventId,
        request_id as requestId,
        seq,
        status,
        reason,
        details_json as detailsJson,
        created_at as createdAt
      FROM execution_status_events
      WHERE request_id = ?1
      ORDER BY seq ASC
      LIMIT ?2
      `,
    )
    .bind(requestId, boundedLimit)
    .all()) as { results?: unknown[] };
  const items = Array.isArray(rows.results) ? rows.results : [];
  return items.filter(isRecord).map((row) => mapExecutionStatusEventRow(row));
}

export async function terminalizeExecutionRequest(
  db: D1Database,
  input: {
    requestId: string;
    status: ExecutionTerminalStatus;
    statusReason?: string | null;
    details?: JsonObject | null;
    nowIso?: string;
  },
): Promise<{
  applied: boolean;
  request: ExecutionRequestRecord | null;
  event: ExecutionStatusEventRecord | null;
}> {
  const nowIso = input.nowIso ?? executionNowIso();
  const result = await db
    .prepare(
      `
      UPDATE execution_requests
      SET
        status = ?1,
        status_reason = ?2,
        terminal_at = ?3,
        updated_at = ?3
      WHERE request_id = ?4
        AND terminal_at IS NULL
      `,
    )
    .bind(input.status, input.statusReason ?? null, nowIso, input.requestId)
    .run();
  const applied = runChanges(result) > 0;
  if (!applied) {
    return {
      applied: false,
      request: await getExecutionRequestById(db, input.requestId),
      event: null,
    };
  }

  const event = await appendExecutionStatusEvent(db, {
    requestId: input.requestId,
    status: input.status,
    reason: input.statusReason ?? null,
    details: input.details ?? null,
    createdAt: nowIso,
  });
  const request = await getExecutionRequestById(db, input.requestId);
  return {
    applied: true,
    request,
    event,
  };
}

export async function createExecutionAttemptIdempotent(
  db: D1Database,
  input: {
    attemptId: string;
    requestId: string;
    attemptNo: number;
    lane: ExecutionLane;
    provider: string;
    status: string;
    providerRequestId?: string | null;
    providerResponse?: JsonObject | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt?: string;
    nowIso?: string;
  },
): Promise<{ created: boolean; row: ExecutionAttemptRecord }> {
  const existing = await getExecutionAttemptByRequestAndNumber(
    db,
    input.requestId,
    input.attemptNo,
  );
  if (existing) return { created: false, row: existing };

  const startedAt = input.startedAt ?? executionNowIso();
  const nowIso = input.nowIso ?? startedAt;
  try {
    await db
      .prepare(
        `
        INSERT INTO execution_attempts (
          attempt_id,
          request_id,
          attempt_no,
          lane,
          provider,
          status,
          provider_request_id,
          provider_response_json,
          error_code,
          error_message,
          started_at,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
        `,
      )
      .bind(
        input.attemptId,
        input.requestId,
        Math.max(1, Math.floor(input.attemptNo)),
        input.lane,
        input.provider,
        input.status,
        input.providerRequestId ?? null,
        toJsonString(input.providerResponse),
        input.errorCode ?? null,
        input.errorMessage ?? null,
        startedAt,
        nowIso,
      )
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await getExecutionAttemptByRequestAndNumber(
      db,
      input.requestId,
      input.attemptNo,
    );
    if (!raced) throw error;
    return { created: false, row: raced };
  }

  const row = await getExecutionAttemptById(db, input.attemptId);
  if (!row) throw new Error("execution-attempt-create-failed");
  return { created: true, row };
}

export async function getExecutionAttemptById(
  db: D1Database,
  attemptId: string,
): Promise<ExecutionAttemptRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        attempt_id as attemptId,
        request_id as requestId,
        attempt_no as attemptNo,
        lane,
        provider,
        status,
        provider_request_id as providerRequestId,
        provider_response_json as providerResponseJson,
        error_code as errorCode,
        error_message as errorMessage,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_attempts
      WHERE attempt_id = ?1
      LIMIT 1
      `,
    )
    .bind(attemptId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionAttemptRow(row);
}

export async function getExecutionAttemptByRequestAndNumber(
  db: D1Database,
  requestId: string,
  attemptNo: number,
): Promise<ExecutionAttemptRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        attempt_id as attemptId,
        request_id as requestId,
        attempt_no as attemptNo,
        lane,
        provider,
        status,
        provider_request_id as providerRequestId,
        provider_response_json as providerResponseJson,
        error_code as errorCode,
        error_message as errorMessage,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_attempts
      WHERE request_id = ?1
        AND attempt_no = ?2
      LIMIT 1
      `,
    )
    .bind(requestId, Math.max(1, Math.floor(attemptNo)))
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionAttemptRow(row);
}

export async function listExecutionAttempts(
  db: D1Database,
  requestId: string,
): Promise<ExecutionAttemptRecord[]> {
  const rows = (await db
    .prepare(
      `
      SELECT
        attempt_id as attemptId,
        request_id as requestId,
        attempt_no as attemptNo,
        lane,
        provider,
        status,
        provider_request_id as providerRequestId,
        provider_response_json as providerResponseJson,
        error_code as errorCode,
        error_message as errorMessage,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_attempts
      WHERE request_id = ?1
      ORDER BY attempt_no ASC
      `,
    )
    .bind(requestId)
    .all()) as { results?: unknown[] };
  const items = Array.isArray(rows.results) ? rows.results : [];
  return items.filter(isRecord).map((row) => mapExecutionAttemptRow(row));
}

export async function finalizeExecutionAttempt(
  db: D1Database,
  input: {
    attemptId: string;
    status: string;
    providerResponse?: JsonObject | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: string;
  },
): Promise<ExecutionAttemptRecord | null> {
  const completedAt = input.completedAt ?? executionNowIso();
  await db
    .prepare(
      `
      UPDATE execution_attempts
      SET
        status = ?1,
        provider_response_json = ?2,
        error_code = ?3,
        error_message = ?4,
        completed_at = ?5,
        updated_at = ?5
      WHERE attempt_id = ?6
      `,
    )
    .bind(
      input.status,
      toJsonString(input.providerResponse),
      input.errorCode ?? null,
      input.errorMessage ?? null,
      completedAt,
      input.attemptId,
    )
    .run();
  return getExecutionAttemptById(db, input.attemptId);
}

export async function getExecutionReceiptByRequestId(
  db: D1Database,
  requestId: string,
): Promise<ExecutionReceiptRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        request_id as requestId,
        receipt_id as receiptId,
        schema_version as schemaVersion,
        finalized_status as finalizedStatus,
        lane,
        provider,
        signature,
        slot,
        error_code as errorCode,
        error_message as errorMessage,
        receipt_json as receiptJson,
        ready_at as readyAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_receipts
      WHERE request_id = ?1
      LIMIT 1
      `,
    )
    .bind(requestId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionReceiptRow(row);
}

export async function upsertExecutionReceiptIdempotent(
  db: D1Database,
  input: {
    requestId: string;
    receiptId: string;
    finalizedStatus: string;
    lane: ExecutionLane;
    provider?: string | null;
    signature?: string | null;
    slot?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    receipt?: JsonObject | null;
    readyAt?: string;
    nowIso?: string;
  },
): Promise<{ created: boolean; row: ExecutionReceiptRecord }> {
  const existing = await getExecutionReceiptByRequestId(db, input.requestId);
  if (existing) return { created: false, row: existing };

  const readyAt = input.readyAt ?? executionNowIso();
  const nowIso = input.nowIso ?? readyAt;
  try {
    await db
      .prepare(
        `
        INSERT INTO execution_receipts (
          request_id,
          receipt_id,
          schema_version,
          finalized_status,
          lane,
          provider,
          signature,
          slot,
          error_code,
          error_message,
          receipt_json,
          ready_at,
          created_at,
          updated_at
        ) VALUES (?1, ?2, 'v1', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
        `,
      )
      .bind(
        input.requestId,
        input.receiptId,
        input.finalizedStatus,
        input.lane,
        input.provider ?? null,
        input.signature ?? null,
        input.slot ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        toJsonString(input.receipt),
        readyAt,
        nowIso,
      )
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await getExecutionReceiptByRequestId(db, input.requestId);
    if (!raced) throw error;
    return { created: false, row: raced };
  }

  const row = await getExecutionReceiptByRequestId(db, input.requestId);
  if (!row) throw new Error("execution-receipt-create-failed");
  return { created: true, row };
}

async function getLatestExecutionStatusEvent(
  db: D1Database,
  requestId: string,
): Promise<ExecutionStatusEventRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        event_id as eventId,
        request_id as requestId,
        seq,
        status,
        reason,
        details_json as detailsJson,
        created_at as createdAt
      FROM execution_status_events
      WHERE request_id = ?1
      ORDER BY seq DESC
      LIMIT 1
      `,
    )
    .bind(requestId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionStatusEventRow(row);
}

async function getLatestExecutionAttempt(
  db: D1Database,
  requestId: string,
): Promise<ExecutionAttemptRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        attempt_id as attemptId,
        request_id as requestId,
        attempt_no as attemptNo,
        lane,
        provider,
        status,
        provider_request_id as providerRequestId,
        provider_response_json as providerResponseJson,
        error_code as errorCode,
        error_message as errorMessage,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_attempts
      WHERE request_id = ?1
      ORDER BY attempt_no DESC
      LIMIT 1
      `,
    )
    .bind(requestId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapExecutionAttemptRow(row);
}

export async function getExecutionLatestStatus(
  db: D1Database,
  requestId: string,
): Promise<ExecutionLatestStatusRecord | null> {
  const request = await getExecutionRequestById(db, requestId);
  if (!request) return null;
  const [latestEvent, latestAttempt, receipt] = await Promise.all([
    getLatestExecutionStatusEvent(db, requestId),
    getLatestExecutionAttempt(db, requestId),
    getExecutionReceiptByRequestId(db, requestId),
  ]);
  return {
    request,
    latestEvent,
    latestAttempt,
    receipt,
  };
}
