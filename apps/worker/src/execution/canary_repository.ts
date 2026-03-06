import type { JsonObject } from "./repository";

export type ExecutionCanaryDirection = "buy" | "sell";
export type ExecutionCanaryTriggerSource =
  | "schedule"
  | "post_deploy"
  | "manual";
export type ExecutionCanaryRunStatus =
  | "pending"
  | "skipped"
  | "blocked"
  | "success"
  | "failed"
  | "disabled";
export type ExecutionCanaryReconciliationStatus =
  | "not_attempted"
  | "passed"
  | "failed";

const CANARY_STATE_KEY = "mainnet";

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

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true";
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? (parsed as JsonObject) : null;
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

export type ExecutionCanaryStateRecord = {
  stateKey: string;
  schemaVersion: string;
  walletId: string | null;
  walletAddress: string | null;
  disabled: boolean;
  disabledReason: string | null;
  lastDirection: ExecutionCanaryDirection | null;
  lastRunId: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionCanaryRunRecord = {
  runId: string;
  schemaVersion: string;
  triggerSource: ExecutionCanaryTriggerSource;
  status: ExecutionCanaryRunStatus;
  direction: ExecutionCanaryDirection;
  pairId: string;
  inputMint: string;
  outputMint: string;
  targetNotionalUsd: string;
  amountAtomic: string | null;
  slippageBps: number;
  quotedOutAtomic: string | null;
  minExpectedOutAtomic: string | null;
  quotePriceImpactPct: number | null;
  requestId: string | null;
  receiptId: string | null;
  signature: string | null;
  receiptStatus: string | null;
  reconciliationStatus: ExecutionCanaryReconciliationStatus;
  walletId: string | null;
  walletAddress: string | null;
  disableReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: JsonObject | null;
  quote: JsonObject | null;
  receipt: JsonObject | null;
  reconciliation: JsonObject | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapCanaryStateRow(
  row: Record<string, unknown>,
): ExecutionCanaryStateRecord {
  const direction = stringOrNull(row.lastDirection);
  return {
    stateKey: stringValue(row.stateKey || CANARY_STATE_KEY),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    walletId: stringOrNull(row.walletId),
    walletAddress: stringOrNull(row.walletAddress),
    disabled: boolValue(row.disabled),
    disabledReason: stringOrNull(row.disabledReason),
    lastDirection:
      direction === "buy" || direction === "sell"
        ? (direction as ExecutionCanaryDirection)
        : null,
    lastRunId: stringOrNull(row.lastRunId),
    lastRunAt: stringOrNull(row.lastRunAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

function mapCanaryRunRow(
  row: Record<string, unknown>,
): ExecutionCanaryRunRecord {
  const direction = stringValue(row.direction).toLowerCase();
  const triggerSource = stringValue(row.triggerSource).toLowerCase();
  const status = stringValue(row.status).toLowerCase();
  const reconciliationStatus = stringValue(
    row.reconciliationStatus,
  ).toLowerCase();
  return {
    runId: stringValue(row.runId),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    triggerSource:
      triggerSource === "schedule" ||
      triggerSource === "post_deploy" ||
      triggerSource === "manual"
        ? (triggerSource as ExecutionCanaryTriggerSource)
        : "manual",
    status:
      status === "pending" ||
      status === "skipped" ||
      status === "blocked" ||
      status === "success" ||
      status === "failed" ||
      status === "disabled"
        ? (status as ExecutionCanaryRunStatus)
        : "failed",
    direction: direction === "sell" ? "sell" : "buy",
    pairId: stringValue(row.pairId),
    inputMint: stringValue(row.inputMint),
    outputMint: stringValue(row.outputMint),
    targetNotionalUsd: stringValue(row.targetNotionalUsd),
    amountAtomic: stringOrNull(row.amountAtomic),
    slippageBps: numberValue(row.slippageBps, 50),
    quotedOutAtomic: stringOrNull(row.quotedOutAtomic),
    minExpectedOutAtomic: stringOrNull(row.minExpectedOutAtomic),
    quotePriceImpactPct:
      row.quotePriceImpactPct === null || row.quotePriceImpactPct === undefined
        ? null
        : numberValue(row.quotePriceImpactPct, 0),
    requestId: stringOrNull(row.requestId),
    receiptId: stringOrNull(row.receiptId),
    signature: stringOrNull(row.signature),
    receiptStatus: stringOrNull(row.receiptStatus),
    reconciliationStatus:
      reconciliationStatus === "passed" || reconciliationStatus === "failed"
        ? (reconciliationStatus as ExecutionCanaryReconciliationStatus)
        : "not_attempted",
    walletId: stringOrNull(row.walletId),
    walletAddress: stringOrNull(row.walletAddress),
    disableReason: stringOrNull(row.disableReason),
    errorCode: stringOrNull(row.errorCode),
    errorMessage: stringOrNull(row.errorMessage),
    metadata: parseJsonObject(row.metadataJson),
    quote: parseJsonObject(row.quoteJson),
    receipt: parseJsonObject(row.receiptJson),
    reconciliation: parseJsonObject(row.reconciliationJson),
    startedAt: stringValue(row.startedAt),
    completedAt: stringOrNull(row.completedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

async function ensureCanaryStateRow(
  db: D1Database,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `
      INSERT OR IGNORE INTO execution_canary_state (
        state_key,
        schema_version,
        disabled,
        created_at,
        updated_at
      ) VALUES (?1, 'v1', 0, ?2, ?2)
      `,
    )
    .bind(CANARY_STATE_KEY, nowIso)
    .run();
}

export async function getExecutionCanaryState(
  db: D1Database,
): Promise<ExecutionCanaryStateRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        state_key as stateKey,
        schema_version as schemaVersion,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disabled,
        disabled_reason as disabledReason,
        last_direction as lastDirection,
        last_run_id as lastRunId,
        last_run_at as lastRunAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_canary_state
      WHERE state_key = ?1
      LIMIT 1
      `,
    )
    .bind(CANARY_STATE_KEY)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapCanaryStateRow(row);
}

export async function updateExecutionCanaryState(
  db: D1Database,
  input: {
    walletId?: string | null;
    walletAddress?: string | null;
    disabled?: boolean;
    disabledReason?: string | null;
    lastDirection?: ExecutionCanaryDirection | null;
    lastRunId?: string | null;
    lastRunAt?: string | null;
    nowIso?: string;
  },
): Promise<ExecutionCanaryStateRecord> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  await ensureCanaryStateRow(db, nowIso);
  const current = await getExecutionCanaryState(db);
  await db
    .prepare(
      `
      UPDATE execution_canary_state
      SET
        wallet_id = ?1,
        wallet_address = ?2,
        disabled = ?3,
        disabled_reason = ?4,
        last_direction = ?5,
        last_run_id = ?6,
        last_run_at = ?7,
        updated_at = ?8
      WHERE state_key = ?9
      `,
    )
    .bind(
      input.walletId !== undefined
        ? input.walletId
        : (current?.walletId ?? null),
      input.walletAddress !== undefined
        ? input.walletAddress
        : (current?.walletAddress ?? null),
      input.disabled !== undefined
        ? input.disabled
          ? 1
          : 0
        : current?.disabled
          ? 1
          : 0,
      input.disabledReason !== undefined
        ? input.disabledReason
        : (current?.disabledReason ?? null),
      input.lastDirection !== undefined
        ? input.lastDirection
        : (current?.lastDirection ?? null),
      input.lastRunId !== undefined
        ? input.lastRunId
        : (current?.lastRunId ?? null),
      input.lastRunAt !== undefined
        ? input.lastRunAt
        : (current?.lastRunAt ?? null),
      nowIso,
      CANARY_STATE_KEY,
    )
    .run();
  const updated = await getExecutionCanaryState(db);
  if (!updated) {
    throw new Error("execution-canary-state-update-failed");
  }
  return updated;
}

export async function createExecutionCanaryRun(
  db: D1Database,
  input: {
    runId: string;
    triggerSource: ExecutionCanaryTriggerSource;
    status: ExecutionCanaryRunStatus;
    direction: ExecutionCanaryDirection;
    pairId: string;
    inputMint: string;
    outputMint: string;
    targetNotionalUsd: string;
    slippageBps: number;
    walletId?: string | null;
    walletAddress?: string | null;
    startedAt?: string;
    amountAtomic?: string | null;
    quotedOutAtomic?: string | null;
    minExpectedOutAtomic?: string | null;
    quotePriceImpactPct?: number | null;
    metadata?: JsonObject | null;
    quote?: JsonObject | null;
    receipt?: JsonObject | null;
    reconciliation?: JsonObject | null;
    requestId?: string | null;
    receiptId?: string | null;
    signature?: string | null;
    receiptStatus?: string | null;
    reconciliationStatus?: ExecutionCanaryReconciliationStatus;
    disableReason?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: string | null;
  },
): Promise<ExecutionCanaryRunRecord> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  await db
    .prepare(
      `
      INSERT INTO execution_canary_runs (
        run_id,
        schema_version,
        trigger_source,
        status,
        direction,
        pair_id,
        input_mint,
        output_mint,
        target_notional_usd,
        amount_atomic,
        slippage_bps,
        quoted_out_atomic,
        min_expected_out_atomic,
        quote_price_impact_pct,
        request_id,
        receipt_id,
        signature,
        receipt_status,
        reconciliation_status,
        wallet_id,
        wallet_address,
        disable_reason,
        error_code,
        error_message,
        metadata_json,
        quote_json,
        receipt_json,
        reconciliation_json,
        started_at,
        completed_at,
        created_at,
        updated_at
      ) VALUES (
        ?1, 'v1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?28, ?28
      )
      `,
    )
    .bind(
      input.runId,
      input.triggerSource,
      input.status,
      input.direction,
      input.pairId,
      input.inputMint,
      input.outputMint,
      input.targetNotionalUsd,
      input.amountAtomic ?? null,
      input.slippageBps,
      input.quotedOutAtomic ?? null,
      input.minExpectedOutAtomic ?? null,
      input.quotePriceImpactPct ?? null,
      input.requestId ?? null,
      input.receiptId ?? null,
      input.signature ?? null,
      input.receiptStatus ?? null,
      input.reconciliationStatus ?? "not_attempted",
      input.walletId ?? null,
      input.walletAddress ?? null,
      input.disableReason ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      toJsonString(input.metadata),
      toJsonString(input.quote),
      toJsonString(input.receipt),
      toJsonString(input.reconciliation),
      startedAt,
      input.completedAt ?? null,
    )
    .run();
  const created = await getExecutionCanaryRun(db, input.runId);
  if (!created) {
    throw new Error("execution-canary-run-create-failed");
  }
  return created;
}

export async function getExecutionCanaryRun(
  db: D1Database,
  runId: string,
): Promise<ExecutionCanaryRunRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        run_id as runId,
        schema_version as schemaVersion,
        trigger_source as triggerSource,
        status,
        direction,
        pair_id as pairId,
        input_mint as inputMint,
        output_mint as outputMint,
        target_notional_usd as targetNotionalUsd,
        amount_atomic as amountAtomic,
        slippage_bps as slippageBps,
        quoted_out_atomic as quotedOutAtomic,
        min_expected_out_atomic as minExpectedOutAtomic,
        quote_price_impact_pct as quotePriceImpactPct,
        request_id as requestId,
        receipt_id as receiptId,
        signature,
        receipt_status as receiptStatus,
        reconciliation_status as reconciliationStatus,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disable_reason as disableReason,
        error_code as errorCode,
        error_message as errorMessage,
        metadata_json as metadataJson,
        quote_json as quoteJson,
        receipt_json as receiptJson,
        reconciliation_json as reconciliationJson,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_canary_runs
      WHERE run_id = ?1
      LIMIT 1
      `,
    )
    .bind(runId)
    .first()) as unknown;
  if (!isRecord(row)) return null;
  return mapCanaryRunRow(row);
}

export async function updateExecutionCanaryRun(
  db: D1Database,
  input: {
    runId: string;
    status?: ExecutionCanaryRunStatus;
    amountAtomic?: string | null;
    quotedOutAtomic?: string | null;
    minExpectedOutAtomic?: string | null;
    quotePriceImpactPct?: number | null;
    requestId?: string | null;
    receiptId?: string | null;
    signature?: string | null;
    receiptStatus?: string | null;
    reconciliationStatus?: ExecutionCanaryReconciliationStatus;
    disableReason?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonObject | null;
    quote?: JsonObject | null;
    receipt?: JsonObject | null;
    reconciliation?: JsonObject | null;
    completedAt?: string | null;
    nowIso?: string;
  },
): Promise<ExecutionCanaryRunRecord | null> {
  const current = await getExecutionCanaryRun(db, input.runId);
  if (!current) return null;
  const nowIso = input.nowIso ?? new Date().toISOString();
  await db
    .prepare(
      `
      UPDATE execution_canary_runs
      SET
        status = ?1,
        amount_atomic = ?2,
        quoted_out_atomic = ?3,
        min_expected_out_atomic = ?4,
        quote_price_impact_pct = ?5,
        request_id = ?6,
        receipt_id = ?7,
        signature = ?8,
        receipt_status = ?9,
        reconciliation_status = ?10,
        disable_reason = ?11,
        error_code = ?12,
        error_message = ?13,
        metadata_json = ?14,
        quote_json = ?15,
        receipt_json = ?16,
        reconciliation_json = ?17,
        completed_at = ?18,
        updated_at = ?19
      WHERE run_id = ?20
      `,
    )
    .bind(
      input.status ?? current.status,
      input.amountAtomic !== undefined
        ? input.amountAtomic
        : current.amountAtomic,
      input.quotedOutAtomic !== undefined
        ? input.quotedOutAtomic
        : current.quotedOutAtomic,
      input.minExpectedOutAtomic !== undefined
        ? input.minExpectedOutAtomic
        : current.minExpectedOutAtomic,
      input.quotePriceImpactPct !== undefined
        ? input.quotePriceImpactPct
        : current.quotePriceImpactPct,
      input.requestId !== undefined ? input.requestId : current.requestId,
      input.receiptId !== undefined ? input.receiptId : current.receiptId,
      input.signature !== undefined ? input.signature : current.signature,
      input.receiptStatus !== undefined
        ? input.receiptStatus
        : current.receiptStatus,
      input.reconciliationStatus ?? current.reconciliationStatus,
      input.disableReason !== undefined
        ? input.disableReason
        : current.disableReason,
      input.errorCode !== undefined ? input.errorCode : current.errorCode,
      input.errorMessage !== undefined
        ? input.errorMessage
        : current.errorMessage,
      input.metadata !== undefined
        ? toJsonString(input.metadata)
        : toJsonString(current.metadata),
      input.quote !== undefined
        ? toJsonString(input.quote)
        : toJsonString(current.quote),
      input.receipt !== undefined
        ? toJsonString(input.receipt)
        : toJsonString(current.receipt),
      input.reconciliation !== undefined
        ? toJsonString(input.reconciliation)
        : toJsonString(current.reconciliation),
      input.completedAt !== undefined ? input.completedAt : current.completedAt,
      nowIso,
      input.runId,
    )
    .run();
  return await getExecutionCanaryRun(db, input.runId);
}

export async function listExecutionCanaryRuns(
  db: D1Database,
  limit = 10,
): Promise<ExecutionCanaryRunRecord[]> {
  const rows = (await db
    .prepare(
      `
      SELECT
        run_id as runId,
        schema_version as schemaVersion,
        trigger_source as triggerSource,
        status,
        direction,
        pair_id as pairId,
        input_mint as inputMint,
        output_mint as outputMint,
        target_notional_usd as targetNotionalUsd,
        amount_atomic as amountAtomic,
        slippage_bps as slippageBps,
        quoted_out_atomic as quotedOutAtomic,
        min_expected_out_atomic as minExpectedOutAtomic,
        quote_price_impact_pct as quotePriceImpactPct,
        request_id as requestId,
        receipt_id as receiptId,
        signature,
        receipt_status as receiptStatus,
        reconciliation_status as reconciliationStatus,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disable_reason as disableReason,
        error_code as errorCode,
        error_message as errorMessage,
        metadata_json as metadataJson,
        quote_json as quoteJson,
        receipt_json as receiptJson,
        reconciliation_json as reconciliationJson,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM execution_canary_runs
      ORDER BY started_at DESC
      LIMIT ?1
      `,
    )
    .bind(Math.max(1, Math.min(100, Math.floor(limit))))
    .all()) as { results?: unknown[] };
  return Array.isArray(rows.results)
    ? rows.results.filter(isRecord).map((row) => mapCanaryRunRow(row))
    : [];
}

export async function getExecutionCanaryDailySpendUsd(
  db: D1Database,
  utcDate: string,
): Promise<number> {
  const row = (await db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CAST(target_notional_usd AS REAL)), 0) as totalUsd
      FROM execution_canary_runs
      WHERE substr(started_at, 1, 10) = ?1
        AND status NOT IN ('skipped', 'blocked')
      `,
    )
    .bind(utcDate)
    .first()) as unknown;
  if (!isRecord(row)) return 0;
  return numberValue(row.totalUsd, 0);
}
