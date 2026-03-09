import type { JsonObject } from "./execution/repository";

export type RuntimeCanaryTriggerSource = "schedule" | "post_deploy" | "manual";
export type RuntimeCanaryRunStatus =
  | "pending"
  | "skipped"
  | "blocked"
  | "success"
  | "failed"
  | "disabled";
export type RuntimeCanaryReconciliationStatus =
  | "not_attempted"
  | "passed"
  | "needs_manual_review"
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

type D1RunResultLike = {
  meta?: {
    changes?: number;
  };
};

function runChanges(value: unknown): number {
  if (!isRecord(value)) return 0;
  const meta = (value as D1RunResultLike).meta;
  if (!isRecord(meta)) return 0;
  return numberValue(meta.changes, 0);
}

export type RuntimeCanaryStateRecord = {
  stateKey: string;
  schemaVersion: string;
  deploymentId: string | null;
  walletId: string | null;
  walletAddress: string | null;
  disabled: boolean;
  disabledReason: string | null;
  lastRunId: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeCanaryRunRecord = {
  runId: string;
  schemaVersion: string;
  triggerSource: RuntimeCanaryTriggerSource;
  status: RuntimeCanaryRunStatus;
  deploymentId: string;
  targetNotionalUsd: string;
  runtimeRunId: string | null;
  runtimeDeploymentState: string | null;
  submitRequestId: string | null;
  runtimeReceiptId: string | null;
  reconciliationStatus: RuntimeCanaryReconciliationStatus;
  walletId: string | null;
  walletAddress: string | null;
  disableReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: JsonObject | null;
  coordination: JsonObject | null;
  receipt: JsonObject | null;
  reconciliation: JsonObject | null;
  observedLedger: JsonObject | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRuntimeCanaryStateRow(
  row: Record<string, unknown>,
): RuntimeCanaryStateRecord {
  return {
    stateKey: stringValue(row.stateKey || CANARY_STATE_KEY),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    deploymentId: stringOrNull(row.deploymentId),
    walletId: stringOrNull(row.walletId),
    walletAddress: stringOrNull(row.walletAddress),
    disabled: boolValue(row.disabled),
    disabledReason: stringOrNull(row.disabledReason),
    lastRunId: stringOrNull(row.lastRunId),
    lastRunAt: stringOrNull(row.lastRunAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

function mapRuntimeCanaryRunRow(
  row: Record<string, unknown>,
): RuntimeCanaryRunRecord {
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
        ? (triggerSource as RuntimeCanaryTriggerSource)
        : "manual",
    status:
      status === "pending" ||
      status === "skipped" ||
      status === "blocked" ||
      status === "success" ||
      status === "failed" ||
      status === "disabled"
        ? (status as RuntimeCanaryRunStatus)
        : "failed",
    deploymentId: stringValue(row.deploymentId),
    targetNotionalUsd: stringValue(row.targetNotionalUsd),
    runtimeRunId: stringOrNull(row.runtimeRunId),
    runtimeDeploymentState: stringOrNull(row.runtimeDeploymentState),
    submitRequestId: stringOrNull(row.submitRequestId),
    runtimeReceiptId: stringOrNull(row.runtimeReceiptId),
    reconciliationStatus:
      reconciliationStatus === "passed" ||
      reconciliationStatus === "needs_manual_review" ||
      reconciliationStatus === "failed"
        ? (reconciliationStatus as RuntimeCanaryReconciliationStatus)
        : "not_attempted",
    walletId: stringOrNull(row.walletId),
    walletAddress: stringOrNull(row.walletAddress),
    disableReason: stringOrNull(row.disableReason),
    errorCode: stringOrNull(row.errorCode),
    errorMessage: stringOrNull(row.errorMessage),
    metadata: parseJsonObject(row.metadataJson),
    coordination: parseJsonObject(row.coordinationJson),
    receipt: parseJsonObject(row.receiptJson),
    reconciliation: parseJsonObject(row.reconciliationJson),
    observedLedger: parseJsonObject(row.observedLedgerJson),
    startedAt: stringValue(row.startedAt),
    completedAt: stringOrNull(row.completedAt),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

async function ensureRuntimeCanaryStateRow(
  db: D1Database,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `
      INSERT OR IGNORE INTO runtime_canary_state (
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

export async function getRuntimeCanaryState(
  db: D1Database,
): Promise<RuntimeCanaryStateRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        state_key as stateKey,
        schema_version as schemaVersion,
        deployment_id as deploymentId,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disabled,
        disabled_reason as disabledReason,
        last_run_id as lastRunId,
        last_run_at as lastRunAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM runtime_canary_state
      WHERE state_key = ?1
      LIMIT 1
      `,
    )
    .bind(CANARY_STATE_KEY)
    .first()) as Record<string, unknown> | null;
  return row ? mapRuntimeCanaryStateRow(row) : null;
}

export async function updateRuntimeCanaryState(
  db: D1Database,
  patch: Partial<{
    deploymentId: string | null;
    walletId: string | null;
    walletAddress: string | null;
    disabled: boolean;
    disabledReason: string | null;
    lastRunId: string | null;
    lastRunAt: string | null;
  }>,
  nowIso = new Date().toISOString(),
): Promise<RuntimeCanaryStateRecord> {
  await ensureRuntimeCanaryStateRow(db, nowIso);
  const current =
    (await getRuntimeCanaryState(db)) ??
    ({
      stateKey: CANARY_STATE_KEY,
      schemaVersion: "v1",
      deploymentId: null,
      walletId: null,
      walletAddress: null,
      disabled: false,
      disabledReason: null,
      lastRunId: null,
      lastRunAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    } satisfies RuntimeCanaryStateRecord);

  const result = await db
    .prepare(
      `
      UPDATE runtime_canary_state
      SET
        deployment_id = ?2,
        wallet_id = ?3,
        wallet_address = ?4,
        disabled = ?5,
        disabled_reason = ?6,
        last_run_id = ?7,
        last_run_at = ?8,
        updated_at = ?9
      WHERE state_key = ?1
      `,
    )
    .bind(
      CANARY_STATE_KEY,
      patch.deploymentId !== undefined
        ? patch.deploymentId
        : current.deploymentId,
      patch.walletId !== undefined ? patch.walletId : current.walletId,
      patch.walletAddress !== undefined
        ? patch.walletAddress
        : current.walletAddress,
      patch.disabled !== undefined
        ? patch.disabled
          ? 1
          : 0
        : current.disabled
          ? 1
          : 0,
      patch.disabledReason !== undefined
        ? patch.disabledReason
        : current.disabledReason,
      patch.lastRunId !== undefined ? patch.lastRunId : current.lastRunId,
      patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
      nowIso,
    )
    .run();

  if (runChanges(result) < 1) {
    throw new Error("runtime-canary-state-update-failed");
  }
  const next = await getRuntimeCanaryState(db);
  if (!next) {
    throw new Error("runtime-canary-state-load-failed");
  }
  return next;
}

export async function createRuntimeCanaryRun(
  db: D1Database,
  input: {
    runId: string;
    triggerSource: RuntimeCanaryTriggerSource;
    status: RuntimeCanaryRunStatus;
    deploymentId: string;
    targetNotionalUsd: string;
    walletId?: string | null;
    walletAddress?: string | null;
    startedAt: string;
    metadata?: JsonObject | null;
  },
): Promise<RuntimeCanaryRunRecord> {
  await db
    .prepare(
      `
      INSERT INTO runtime_canary_runs (
        run_id,
        schema_version,
        trigger_source,
        status,
        deployment_id,
        target_notional_usd,
        reconciliation_status,
        wallet_id,
        wallet_address,
        metadata_json,
        started_at,
        created_at,
        updated_at
      ) VALUES (?1, 'v1', ?2, ?3, ?4, ?5, 'not_attempted', ?6, ?7, ?8, ?9, ?9, ?9)
      `,
    )
    .bind(
      input.runId,
      input.triggerSource,
      input.status,
      input.deploymentId,
      input.targetNotionalUsd,
      input.walletId ?? null,
      input.walletAddress ?? null,
      toJsonString(input.metadata ?? null),
      input.startedAt,
    )
    .run();
  const run = await getRuntimeCanaryRun(db, input.runId);
  if (!run) {
    throw new Error("runtime-canary-run-create-failed");
  }
  return run;
}

export async function getRuntimeCanaryRun(
  db: D1Database,
  runId: string,
): Promise<RuntimeCanaryRunRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        run_id as runId,
        schema_version as schemaVersion,
        trigger_source as triggerSource,
        status,
        deployment_id as deploymentId,
        target_notional_usd as targetNotionalUsd,
        runtime_run_id as runtimeRunId,
        runtime_deployment_state as runtimeDeploymentState,
        submit_request_id as submitRequestId,
        runtime_receipt_id as runtimeReceiptId,
        reconciliation_status as reconciliationStatus,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disable_reason as disableReason,
        error_code as errorCode,
        error_message as errorMessage,
        metadata_json as metadataJson,
        coordination_json as coordinationJson,
        receipt_json as receiptJson,
        reconciliation_json as reconciliationJson,
        observed_ledger_json as observedLedgerJson,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM runtime_canary_runs
      WHERE run_id = ?1
      LIMIT 1
      `,
    )
    .bind(runId)
    .first()) as Record<string, unknown> | null;
  return row ? mapRuntimeCanaryRunRow(row) : null;
}

export async function updateRuntimeCanaryRun(
  db: D1Database,
  input: {
    runId: string;
    status?: RuntimeCanaryRunStatus;
    runtimeRunId?: string | null;
    runtimeDeploymentState?: string | null;
    submitRequestId?: string | null;
    runtimeReceiptId?: string | null;
    reconciliationStatus?: RuntimeCanaryReconciliationStatus;
    disableReason?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: JsonObject | null;
    coordination?: JsonObject | null;
    receipt?: JsonObject | null;
    reconciliation?: JsonObject | null;
    observedLedger?: JsonObject | null;
    completedAt?: string | null;
    nowIso?: string;
  },
): Promise<RuntimeCanaryRunRecord> {
  const current = await getRuntimeCanaryRun(db, input.runId);
  if (!current) throw new Error("runtime-canary-run-not-found");
  const nowIso = input.nowIso ?? new Date().toISOString();
  const result = await db
    .prepare(
      `
      UPDATE runtime_canary_runs
      SET
        status = ?2,
        runtime_run_id = ?3,
        runtime_deployment_state = ?4,
        submit_request_id = ?5,
        runtime_receipt_id = ?6,
        reconciliation_status = ?7,
        disable_reason = ?8,
        error_code = ?9,
        error_message = ?10,
        metadata_json = ?11,
        coordination_json = ?12,
        receipt_json = ?13,
        reconciliation_json = ?14,
        observed_ledger_json = ?15,
        completed_at = ?16,
        updated_at = ?17
      WHERE run_id = ?1
      `,
    )
    .bind(
      input.runId,
      input.status ?? current.status,
      input.runtimeRunId !== undefined
        ? input.runtimeRunId
        : current.runtimeRunId,
      input.runtimeDeploymentState !== undefined
        ? input.runtimeDeploymentState
        : current.runtimeDeploymentState,
      input.submitRequestId !== undefined
        ? input.submitRequestId
        : current.submitRequestId,
      input.runtimeReceiptId !== undefined
        ? input.runtimeReceiptId
        : current.runtimeReceiptId,
      input.reconciliationStatus ?? current.reconciliationStatus,
      input.disableReason !== undefined
        ? input.disableReason
        : current.disableReason,
      input.errorCode !== undefined ? input.errorCode : current.errorCode,
      input.errorMessage !== undefined
        ? input.errorMessage
        : current.errorMessage,
      toJsonString(
        input.metadata !== undefined ? input.metadata : current.metadata,
      ),
      toJsonString(
        input.coordination !== undefined
          ? input.coordination
          : current.coordination,
      ),
      toJsonString(
        input.receipt !== undefined ? input.receipt : current.receipt,
      ),
      toJsonString(
        input.reconciliation !== undefined
          ? input.reconciliation
          : current.reconciliation,
      ),
      toJsonString(
        input.observedLedger !== undefined
          ? input.observedLedger
          : current.observedLedger,
      ),
      input.completedAt !== undefined ? input.completedAt : current.completedAt,
      nowIso,
    )
    .run();
  if (runChanges(result) < 1) {
    throw new Error("runtime-canary-run-update-failed");
  }
  const next = await getRuntimeCanaryRun(db, input.runId);
  if (!next) throw new Error("runtime-canary-run-load-failed");
  return next;
}

export async function listRuntimeCanaryRuns(
  db: D1Database,
  limit = 10,
): Promise<RuntimeCanaryRunRecord[]> {
  const capped = Math.min(50, Math.max(1, Math.floor(limit)));
  const rows = (await db
    .prepare(
      `
      SELECT
        run_id as runId,
        schema_version as schemaVersion,
        trigger_source as triggerSource,
        status,
        deployment_id as deploymentId,
        target_notional_usd as targetNotionalUsd,
        runtime_run_id as runtimeRunId,
        runtime_deployment_state as runtimeDeploymentState,
        submit_request_id as submitRequestId,
        runtime_receipt_id as runtimeReceiptId,
        reconciliation_status as reconciliationStatus,
        wallet_id as walletId,
        wallet_address as walletAddress,
        disable_reason as disableReason,
        error_code as errorCode,
        error_message as errorMessage,
        metadata_json as metadataJson,
        coordination_json as coordinationJson,
        receipt_json as receiptJson,
        reconciliation_json as reconciliationJson,
        observed_ledger_json as observedLedgerJson,
        started_at as startedAt,
        completed_at as completedAt,
        created_at as createdAt,
        updated_at as updatedAt
      FROM runtime_canary_runs
      ORDER BY started_at DESC, created_at DESC
      LIMIT ?1
      `,
    )
    .bind(capped)
    .all()) as { results?: unknown[] };
  return Array.isArray(rows.results)
    ? rows.results
        .filter(isRecord)
        .map((row) => mapRuntimeCanaryRunRow(row as Record<string, unknown>))
    : [];
}

export async function getRuntimeCanaryDailySpendUsd(
  db: D1Database,
  datePrefix: string,
): Promise<number> {
  const row = (await db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CAST(target_notional_usd AS REAL)), 0) as totalUsd
      FROM runtime_canary_runs
      WHERE started_at >= ?1
        AND started_at < ?2
        AND status = 'success'
      `,
    )
    .bind(`${datePrefix}T00:00:00.000Z`, `${datePrefix}T23:59:59.999Z`)
    .first()) as Record<string, unknown> | null;
  return numberValue(row?.totalUsd, 0);
}
