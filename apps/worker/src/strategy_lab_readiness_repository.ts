import {
  parseRuntimeStrategyLabReadinessArtifact,
  parseRuntimeStrategyLabReadinessCanaryRun,
  parseRuntimeStrategyLabSubjectControl,
  type RuntimeStrategyLabReadinessArtifact,
  type RuntimeStrategyLabReadinessCanaryRun,
  type RuntimeStrategyLabSubjectControl,
  type RuntimeStrategyLabSubjectKind,
} from "../../../src/runtime/contracts/autonomous_runtime.js";

export type ReadinessCanaryStateRecord = {
  canaryKey: string;
  walletId: string | null;
  walletAddress: string | null;
  lastRunId: string | null;
  lastRunAt: string | null;
  updatedAt: string;
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

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric !== 0;
  const parsed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!parsed) return fallback;
  if (["1", "true", "on", "yes"].includes(parsed)) return true;
  if (["0", "false", "off", "no"].includes(parsed)) return false;
  return fallback;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function mapSubjectControlRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabSubjectControl {
  const disabledReason = stringOrNull(row.disabledReason);
  const updatedBy = stringOrNull(row.updatedBy);
  const metadata = parseJsonValue(row.metadata);

  return parseRuntimeStrategyLabSubjectControl({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    subjectKind: stringValue(row.subjectKind),
    subjectKey: stringValue(row.subjectKey),
    liveAllowed: booleanValue(row.liveAllowed, true),
    killSwitchEnabled: booleanValue(row.killSwitchEnabled, false),
    ...(disabledReason ? { disabledReason } : {}),
    updatedAt: stringValue(row.updatedAt),
    ...(updatedBy ? { updatedBy } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapReadinessArtifactRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabReadinessArtifact {
  const venueKey = stringOrNull(row.venueKey);
  const assetKey = stringOrNull(row.assetKey);
  const canaryRunId = stringOrNull(row.canaryRunId);
  const checks = parseJsonValue(row.checks);
  const evidenceRefs = parseJsonValue(row.evidenceRefs);
  const controls = parseJsonValue(row.controls);
  const metadata = parseJsonValue(row.metadata);

  return parseRuntimeStrategyLabReadinessArtifact({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    readinessId: stringValue(row.readinessId),
    subjectKind: stringValue(row.subjectKind),
    subjectKey: stringValue(row.subjectKey),
    targetState: stringValue(row.targetState),
    status: stringValue(row.status),
    summary: stringValue(row.summary),
    ...(venueKey ? { venueKey } : {}),
    ...(assetKey ? { assetKey } : {}),
    ...(canaryRunId ? { canaryRunId } : {}),
    checks: Array.isArray(checks) ? checks : [],
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    ...(isRecord(controls) ? { controls } : {}),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapReadinessCanaryRunRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabReadinessCanaryRun {
  const walletId = stringOrNull(row.walletId);
  const walletAddress = stringOrNull(row.walletAddress);
  const receiptId = stringOrNull(row.receiptId);
  const signature = stringOrNull(row.signature);
  const errorCode = stringOrNull(row.errorCode);
  const errorMessage = stringOrNull(row.errorMessage);
  const reconciliation = parseJsonValue(row.reconciliation);
  const evidenceRefs = parseJsonValue(row.evidenceRefs);
  const metadata = parseJsonValue(row.metadata);
  const completedAt = stringOrNull(row.completedAt);

  return parseRuntimeStrategyLabReadinessCanaryRun({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    runId: stringValue(row.runId),
    subjectKind: stringValue(row.subjectKind),
    subjectKey: stringValue(row.subjectKey),
    venueKey: stringValue(row.venueKey),
    assetKey: stringValue(row.assetKey),
    pairSymbol: stringValue(row.pairSymbol),
    adapterKey: stringValue(row.adapterKey),
    triggerSource: stringValue(row.triggerSource),
    status: stringValue(row.status),
    inputMint: stringValue(row.inputMint),
    outputMint: stringValue(row.outputMint),
    targetNotionalUsd: stringValue(row.targetNotionalUsd),
    ...(walletId ? { walletId } : {}),
    ...(walletAddress ? { walletAddress } : {}),
    ...(receiptId ? { receiptId } : {}),
    ...(signature ? { signature } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(isRecord(reconciliation) ? { reconciliation } : {}),
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    ...(isRecord(metadata) ? { metadata } : {}),
    startedAt: stringValue(row.startedAt),
    ...(completedAt ? { completedAt } : {}),
  });
}

function mapReadinessCanaryStateRow(
  row: Record<string, unknown>,
): ReadinessCanaryStateRecord {
  return {
    canaryKey: stringValue(row.canaryKey),
    walletId: stringOrNull(row.walletId),
    walletAddress: stringOrNull(row.walletAddress),
    lastRunId: stringOrNull(row.lastRunId),
    lastRunAt: stringOrNull(row.lastRunAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

export async function writeStrategyLabSubjectControl(
  db: D1Database,
  record: RuntimeStrategyLabSubjectControl,
): Promise<RuntimeStrategyLabSubjectControl> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_subject_controls (
        subject_kind,
        subject_key,
        schema_version,
        live_allowed,
        kill_switch_enabled,
        disabled_reason,
        metadata_json,
        updated_at,
        updated_by
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(subject_kind, subject_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        live_allowed = excluded.live_allowed,
        kill_switch_enabled = excluded.kill_switch_enabled,
        disabled_reason = excluded.disabled_reason,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      `,
    )
    .bind(
      record.subjectKind,
      record.subjectKey,
      record.schemaVersion,
      record.liveAllowed ? 1 : 0,
      record.killSwitchEnabled ? 1 : 0,
      record.disabledReason ?? null,
      stringifyJson(record.metadata),
      record.updatedAt,
      record.updatedBy ?? null,
    )
    .run();
  return record;
}

export async function getStrategyLabSubjectControl(
  db: D1Database,
  subjectKind: RuntimeStrategyLabSubjectKind,
  subjectKey: string,
): Promise<RuntimeStrategyLabSubjectControl | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        schema_version AS schemaVersion,
        live_allowed AS liveAllowed,
        kill_switch_enabled AS killSwitchEnabled,
        disabled_reason AS disabledReason,
        metadata_json AS metadata,
        updated_at AS updatedAt,
        updated_by AS updatedBy
      FROM strategy_lab_subject_controls
      WHERE subject_kind = ?1 AND subject_key = ?2
      LIMIT 1
      `,
    )
    .bind(subjectKind, subjectKey)
    .first()) as Record<string, unknown> | null;
  return row ? mapSubjectControlRow(row) : null;
}

export async function listStrategyLabSubjectControls(
  db: D1Database,
  options?: {
    subjectKind?: RuntimeStrategyLabSubjectKind;
    subjectKey?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyLabSubjectControl[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        schema_version AS schemaVersion,
        live_allowed AS liveAllowed,
        kill_switch_enabled AS killSwitchEnabled,
        disabled_reason AS disabledReason,
        metadata_json AS metadata,
        updated_at AS updatedAt,
        updated_by AS updatedBy
      FROM strategy_lab_subject_controls
      WHERE (?1 IS NULL OR subject_kind = ?1)
        AND (?2 IS NULL OR subject_key = ?2)
      ORDER BY updated_at DESC, subject_kind ASC, subject_key ASC
      LIMIT ?3
      `,
    )
    .bind(options?.subjectKind ?? null, options?.subjectKey ?? null, limit)
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapSubjectControlRow);
}

export async function writeStrategyLabReadinessArtifact(
  db: D1Database,
  artifact: RuntimeStrategyLabReadinessArtifact,
): Promise<RuntimeStrategyLabReadinessArtifact> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_readiness_artifacts (
        readiness_id,
        schema_version,
        subject_kind,
        subject_key,
        target_state,
        status,
        summary,
        venue_key,
        asset_key,
        canary_run_id,
        checks_json,
        evidence_refs_json,
        controls_json,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
        ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
      )
      ON CONFLICT(readiness_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        subject_kind = excluded.subject_kind,
        subject_key = excluded.subject_key,
        target_state = excluded.target_state,
        status = excluded.status,
        summary = excluded.summary,
        venue_key = excluded.venue_key,
        asset_key = excluded.asset_key,
        canary_run_id = excluded.canary_run_id,
        checks_json = excluded.checks_json,
        evidence_refs_json = excluded.evidence_refs_json,
        controls_json = excluded.controls_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      artifact.readinessId,
      artifact.schemaVersion,
      artifact.subjectKind,
      artifact.subjectKey,
      artifact.targetState,
      artifact.status,
      artifact.summary,
      artifact.venueKey ?? null,
      artifact.assetKey ?? null,
      artifact.canaryRunId ?? null,
      stringifyJson(artifact.checks) ?? "[]",
      stringifyJson(artifact.evidenceRefs) ?? "[]",
      stringifyJson(artifact.controls),
      stringifyJson(artifact.metadata),
      artifact.createdAt,
      artifact.updatedAt,
    )
    .run();
  return artifact;
}

export async function getStrategyLabReadinessArtifact(
  db: D1Database,
  readinessId: string,
): Promise<RuntimeStrategyLabReadinessArtifact | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        readiness_id AS readinessId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        target_state AS targetState,
        status,
        summary,
        venue_key AS venueKey,
        asset_key AS assetKey,
        canary_run_id AS canaryRunId,
        checks_json AS checks,
        evidence_refs_json AS evidenceRefs,
        controls_json AS controls,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_lab_readiness_artifacts
      WHERE readiness_id = ?1
      LIMIT 1
      `,
    )
    .bind(readinessId)
    .first()) as Record<string, unknown> | null;
  return row ? mapReadinessArtifactRow(row) : null;
}

export async function listStrategyLabReadinessArtifacts(
  db: D1Database,
  options?: {
    subjectKind?: RuntimeStrategyLabSubjectKind;
    subjectKey?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyLabReadinessArtifact[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        readiness_id AS readinessId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        target_state AS targetState,
        status,
        summary,
        venue_key AS venueKey,
        asset_key AS assetKey,
        canary_run_id AS canaryRunId,
        checks_json AS checks,
        evidence_refs_json AS evidenceRefs,
        controls_json AS controls,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_lab_readiness_artifacts
      WHERE (?1 IS NULL OR subject_kind = ?1)
        AND (?2 IS NULL OR subject_key = ?2)
      ORDER BY created_at DESC, readiness_id DESC
      LIMIT ?3
      `,
    )
    .bind(options?.subjectKind ?? null, options?.subjectKey ?? null, limit)
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapReadinessArtifactRow);
}

export async function getStrategyLabReadinessCanaryState(
  db: D1Database,
  canaryKey = "strategy_lab",
): Promise<ReadinessCanaryStateRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        canary_key AS canaryKey,
        wallet_id AS walletId,
        wallet_address AS walletAddress,
        last_run_id AS lastRunId,
        last_run_at AS lastRunAt,
        updated_at AS updatedAt
      FROM strategy_lab_readiness_canary_state
      WHERE canary_key = ?1
      LIMIT 1
      `,
    )
    .bind(canaryKey)
    .first()) as Record<string, unknown> | null;
  return row ? mapReadinessCanaryStateRow(row) : null;
}

export async function updateStrategyLabReadinessCanaryState(
  db: D1Database,
  patch: Partial<ReadinessCanaryStateRecord> & { canaryKey?: string },
): Promise<ReadinessCanaryStateRecord> {
  const canaryKey = patch.canaryKey ?? "strategy_lab";
  const current = await getStrategyLabReadinessCanaryState(db, canaryKey);
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_readiness_canary_state (
        canary_key,
        wallet_id,
        wallet_address,
        last_run_id,
        last_run_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(canary_key) DO UPDATE SET
        wallet_id = excluded.wallet_id,
        wallet_address = excluded.wallet_address,
        last_run_id = excluded.last_run_id,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      canaryKey,
      patch.walletId ?? current?.walletId ?? null,
      patch.walletAddress ?? current?.walletAddress ?? null,
      patch.lastRunId ?? current?.lastRunId ?? null,
      patch.lastRunAt ?? current?.lastRunAt ?? null,
      patch.updatedAt ?? new Date().toISOString(),
    )
    .run();
  const next = await getStrategyLabReadinessCanaryState(db, canaryKey);
  if (!next) {
    throw new Error("strategy-lab-readiness-canary-state-load-failed");
  }
  return next;
}

export async function createStrategyLabReadinessCanaryRun(
  db: D1Database,
  run: RuntimeStrategyLabReadinessCanaryRun,
): Promise<RuntimeStrategyLabReadinessCanaryRun> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_readiness_canary_runs (
        run_id,
        schema_version,
        subject_kind,
        subject_key,
        venue_key,
        asset_key,
        pair_symbol,
        adapter_key,
        trigger_source,
        status,
        input_mint,
        output_mint,
        target_notional_usd,
        wallet_id,
        wallet_address,
        receipt_id,
        signature,
        error_code,
        error_message,
        reconciliation_json,
        evidence_refs_json,
        metadata_json,
        started_at,
        completed_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
      )
      `,
    )
    .bind(
      run.runId,
      run.schemaVersion,
      run.subjectKind,
      run.subjectKey,
      run.venueKey,
      run.assetKey,
      run.pairSymbol,
      run.adapterKey,
      run.triggerSource,
      run.status,
      run.inputMint,
      run.outputMint,
      run.targetNotionalUsd,
      run.walletId ?? null,
      run.walletAddress ?? null,
      run.receiptId ?? null,
      run.signature ?? null,
      run.errorCode ?? null,
      run.errorMessage ?? null,
      stringifyJson(run.reconciliation),
      stringifyJson(run.evidenceRefs) ?? "[]",
      stringifyJson(run.metadata),
      run.startedAt,
      run.completedAt ?? null,
    )
    .run();
  return run;
}

export async function updateStrategyLabReadinessCanaryRun(
  db: D1Database,
  run: RuntimeStrategyLabReadinessCanaryRun,
): Promise<RuntimeStrategyLabReadinessCanaryRun> {
  await db
    .prepare(
      `
      UPDATE strategy_lab_readiness_canary_runs
      SET
        schema_version = ?2,
        subject_kind = ?3,
        subject_key = ?4,
        venue_key = ?5,
        asset_key = ?6,
        pair_symbol = ?7,
        adapter_key = ?8,
        trigger_source = ?9,
        status = ?10,
        input_mint = ?11,
        output_mint = ?12,
        target_notional_usd = ?13,
        wallet_id = ?14,
        wallet_address = ?15,
        receipt_id = ?16,
        signature = ?17,
        error_code = ?18,
        error_message = ?19,
        reconciliation_json = ?20,
        evidence_refs_json = ?21,
        metadata_json = ?22,
        started_at = ?23,
        completed_at = ?24
      WHERE run_id = ?1
      `,
    )
    .bind(
      run.runId,
      run.schemaVersion,
      run.subjectKind,
      run.subjectKey,
      run.venueKey,
      run.assetKey,
      run.pairSymbol,
      run.adapterKey,
      run.triggerSource,
      run.status,
      run.inputMint,
      run.outputMint,
      run.targetNotionalUsd,
      run.walletId ?? null,
      run.walletAddress ?? null,
      run.receiptId ?? null,
      run.signature ?? null,
      run.errorCode ?? null,
      run.errorMessage ?? null,
      stringifyJson(run.reconciliation),
      stringifyJson(run.evidenceRefs) ?? "[]",
      stringifyJson(run.metadata),
      run.startedAt,
      run.completedAt ?? null,
    )
    .run();
  return run;
}

export async function getStrategyLabReadinessCanaryRun(
  db: D1Database,
  runId: string,
): Promise<RuntimeStrategyLabReadinessCanaryRun | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        run_id AS runId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        venue_key AS venueKey,
        asset_key AS assetKey,
        pair_symbol AS pairSymbol,
        adapter_key AS adapterKey,
        trigger_source AS triggerSource,
        status,
        input_mint AS inputMint,
        output_mint AS outputMint,
        target_notional_usd AS targetNotionalUsd,
        wallet_id AS walletId,
        wallet_address AS walletAddress,
        receipt_id AS receiptId,
        signature,
        error_code AS errorCode,
        error_message AS errorMessage,
        reconciliation_json AS reconciliation,
        evidence_refs_json AS evidenceRefs,
        metadata_json AS metadata,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM strategy_lab_readiness_canary_runs
      WHERE run_id = ?1
      LIMIT 1
      `,
    )
    .bind(runId)
    .first()) as Record<string, unknown> | null;
  return row ? mapReadinessCanaryRunRow(row) : null;
}

export async function listStrategyLabReadinessCanaryRuns(
  db: D1Database,
  options?: {
    subjectKind?: RuntimeStrategyLabSubjectKind;
    subjectKey?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyLabReadinessCanaryRun[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        run_id AS runId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        venue_key AS venueKey,
        asset_key AS assetKey,
        pair_symbol AS pairSymbol,
        adapter_key AS adapterKey,
        trigger_source AS triggerSource,
        status,
        input_mint AS inputMint,
        output_mint AS outputMint,
        target_notional_usd AS targetNotionalUsd,
        wallet_id AS walletId,
        wallet_address AS walletAddress,
        receipt_id AS receiptId,
        signature,
        error_code AS errorCode,
        error_message AS errorMessage,
        reconciliation_json AS reconciliation,
        evidence_refs_json AS evidenceRefs,
        metadata_json AS metadata,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM strategy_lab_readiness_canary_runs
      WHERE (?1 IS NULL OR subject_kind = ?1)
        AND (?2 IS NULL OR subject_key = ?2)
      ORDER BY started_at DESC, run_id DESC
      LIMIT ?3
      `,
    )
    .bind(options?.subjectKind ?? null, options?.subjectKey ?? null, limit)
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapReadinessCanaryRunRow);
}

export async function getStrategyLabReadinessCanaryDailySpendUsd(
  db: D1Database,
  utcDate: string,
): Promise<number> {
  const row = (await db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CAST(target_notional_usd AS REAL)), 0) AS totalUsd
      FROM strategy_lab_readiness_canary_runs
      WHERE substr(started_at, 1, 10) = ?1
        AND status NOT IN ('skipped', 'blocked', 'disabled')
      `,
    )
    .bind(utcDate)
    .first()) as Record<string, unknown> | null;
  return row ? numberValue(row.totalUsd, 0) : 0;
}
