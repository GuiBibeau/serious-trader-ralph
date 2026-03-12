import {
  parseRuntimeStrategyLabPromotionEvent,
  parseRuntimeStrategyLabPromotionRecord,
  type RuntimeStrategyLabPromotionEvent,
  type RuntimeStrategyLabPromotionRecord,
  type RuntimeStrategyLabSubjectKind,
} from "../../../src/runtime/contracts/autonomous_runtime.js";

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

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function mapPromotionRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabPromotionRecord {
  const appliedAt = stringOrNull(row.appliedAt);
  const issueNumber = numberOrNull(row.issueNumber);
  const pullRequestNumber = numberOrNull(row.pullRequestNumber);
  const deploymentId = stringOrNull(row.deploymentId);
  const policyGateId = stringOrNull(row.policyGateId);
  const synthesisId = stringOrNull(row.synthesisId);
  const triageId = stringOrNull(row.triageId);
  const implementationReference = parseJsonValue(row.implementationReference);
  const evidenceRefs = parseJsonValue(row.evidenceRefs);
  const checks = parseJsonValue(row.checks);
  const actions = parseJsonValue(row.actions);
  const approvals = parseJsonValue(row.approvals);
  const metadata = parseJsonValue(row.metadata);

  return parseRuntimeStrategyLabPromotionRecord({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    promotionId: stringValue(row.promotionId),
    subjectKind: stringValue(row.subjectKind),
    subjectKey: stringValue(row.subjectKey),
    currentState: stringValue(row.currentState),
    targetState: stringValue(row.targetState),
    transitionType: stringValue(row.transitionType),
    status: stringValue(row.status),
    summary: stringValue(row.summary),
    requestedBy: stringValue(row.requestedBy),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(appliedAt ? { appliedAt } : {}),
    ...(issueNumber !== null ? { issueNumber } : {}),
    ...(pullRequestNumber !== null ? { pullRequestNumber } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    ...(policyGateId ? { policyGateId } : {}),
    ...(synthesisId ? { synthesisId } : {}),
    ...(triageId ? { triageId } : {}),
    ...(implementationReference ? { implementationReference } : {}),
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    checks: Array.isArray(checks) ? checks : [],
    actions: Array.isArray(actions) ? actions : [],
    approvals: Array.isArray(approvals) ? approvals : [],
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapEventRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabPromotionEvent {
  const fromState = stringOrNull(row.fromState);
  const toState = stringOrNull(row.toState);
  const details = parseJsonValue(row.details);

  return parseRuntimeStrategyLabPromotionEvent({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    eventId: stringValue(row.eventId),
    promotionId: stringValue(row.promotionId),
    eventType: stringValue(row.eventType),
    actor: stringValue(row.actor),
    ...(fromState ? { fromState } : {}),
    ...(toState ? { toState } : {}),
    summary: stringValue(row.summary),
    ...(isRecord(details) ? { details } : {}),
    createdAt: stringValue(row.createdAt),
  });
}

export async function writeStrategyLabPromotion(
  db: D1Database,
  record: RuntimeStrategyLabPromotionRecord,
): Promise<RuntimeStrategyLabPromotionRecord> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_promotions (
        promotion_id,
        schema_version,
        subject_kind,
        subject_key,
        current_state,
        target_state,
        transition_type,
        status,
        summary,
        requested_by,
        issue_number,
        pull_request_number,
        deployment_id,
        policy_gate_id,
        synthesis_id,
        triage_id,
        implementation_reference_json,
        evidence_refs_json,
        checks_json,
        actions_json,
        approvals_json,
        metadata_json,
        applied_at,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
        ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19,
        ?20, ?21, ?22, ?23, ?24, ?25
      )
      ON CONFLICT(promotion_id) DO UPDATE SET
        subject_kind = excluded.subject_kind,
        subject_key = excluded.subject_key,
        current_state = excluded.current_state,
        target_state = excluded.target_state,
        transition_type = excluded.transition_type,
        status = excluded.status,
        summary = excluded.summary,
        requested_by = excluded.requested_by,
        issue_number = excluded.issue_number,
        pull_request_number = excluded.pull_request_number,
        deployment_id = excluded.deployment_id,
        policy_gate_id = excluded.policy_gate_id,
        synthesis_id = excluded.synthesis_id,
        triage_id = excluded.triage_id,
        implementation_reference_json = excluded.implementation_reference_json,
        evidence_refs_json = excluded.evidence_refs_json,
        checks_json = excluded.checks_json,
        actions_json = excluded.actions_json,
        approvals_json = excluded.approvals_json,
        metadata_json = excluded.metadata_json,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      record.promotionId,
      record.schemaVersion,
      record.subjectKind,
      record.subjectKey,
      record.currentState,
      record.targetState,
      record.transitionType,
      record.status,
      record.summary,
      record.requestedBy,
      record.issueNumber ?? null,
      record.pullRequestNumber ?? null,
      record.deploymentId ?? null,
      record.policyGateId ?? null,
      record.synthesisId ?? null,
      record.triageId ?? null,
      stringifyJson(record.implementationReference),
      stringifyJson(record.evidenceRefs) ?? "[]",
      stringifyJson(record.checks) ?? "[]",
      stringifyJson(record.actions) ?? "[]",
      stringifyJson(record.approvals),
      stringifyJson(record.metadata),
      record.appliedAt ?? null,
      record.createdAt,
      record.updatedAt,
    )
    .run();
  return record;
}

export async function appendStrategyLabPromotionEvent(
  db: D1Database,
  event: RuntimeStrategyLabPromotionEvent,
): Promise<RuntimeStrategyLabPromotionEvent> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_promotion_events (
        event_id,
        promotion_id,
        event_type,
        actor,
        from_state,
        to_state,
        summary,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `,
    )
    .bind(
      event.eventId,
      event.promotionId,
      event.eventType,
      event.actor,
      event.fromState ?? null,
      event.toState ?? null,
      event.summary,
      stringifyJson(event.details),
      event.createdAt,
    )
    .run();
  return event;
}

export async function getStrategyLabPromotion(
  db: D1Database,
  promotionId: string,
): Promise<RuntimeStrategyLabPromotionRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        promotion_id AS promotionId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        current_state AS currentState,
        target_state AS targetState,
        transition_type AS transitionType,
        status,
        summary,
        requested_by AS requestedBy,
        issue_number AS issueNumber,
        pull_request_number AS pullRequestNumber,
        deployment_id AS deploymentId,
        policy_gate_id AS policyGateId,
        synthesis_id AS synthesisId,
        triage_id AS triageId,
        implementation_reference_json AS implementationReference,
        evidence_refs_json AS evidenceRefs,
        checks_json AS checks,
        actions_json AS actions,
        approvals_json AS approvals,
        metadata_json AS metadata,
        applied_at AS appliedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_lab_promotions
      WHERE promotion_id = ?1
      LIMIT 1
      `,
    )
    .bind(promotionId)
    .first()) as Record<string, unknown> | null;
  return row ? mapPromotionRow(row) : null;
}

export async function listStrategyLabPromotions(
  db: D1Database,
  options?: {
    subjectKind?: RuntimeStrategyLabSubjectKind;
    subjectKey?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyLabPromotionRecord[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        promotion_id AS promotionId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        current_state AS currentState,
        target_state AS targetState,
        transition_type AS transitionType,
        status,
        summary,
        requested_by AS requestedBy,
        issue_number AS issueNumber,
        pull_request_number AS pullRequestNumber,
        deployment_id AS deploymentId,
        policy_gate_id AS policyGateId,
        synthesis_id AS synthesisId,
        triage_id AS triageId,
        implementation_reference_json AS implementationReference,
        evidence_refs_json AS evidenceRefs,
        checks_json AS checks,
        actions_json AS actions,
        approvals_json AS approvals,
        metadata_json AS metadata,
        applied_at AS appliedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_lab_promotions
      WHERE (?1 IS NULL OR subject_kind = ?1)
        AND (?2 IS NULL OR subject_key = ?2)
      ORDER BY created_at DESC, promotion_id DESC
      LIMIT ?3
      `,
    )
    .bind(options?.subjectKind ?? null, options?.subjectKey ?? null, limit)
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapPromotionRow);
}

export async function listStrategyLabPromotionEvents(
  db: D1Database,
  promotionId: string,
): Promise<RuntimeStrategyLabPromotionEvent[]> {
  const rows = (await db
    .prepare(
      `
      SELECT
        event_id AS eventId,
        promotion_id AS promotionId,
        event_type AS eventType,
        actor,
        from_state AS fromState,
        to_state AS toState,
        summary,
        details_json AS details,
        created_at AS createdAt
      FROM strategy_lab_promotion_events
      WHERE promotion_id = ?1
      ORDER BY created_at ASC, event_id ASC
      `,
    )
    .bind(promotionId)
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapEventRow);
}
