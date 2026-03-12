import {
  parseRuntimeStrategyLabPostLiveArtifact,
  type RuntimeStrategyLabPostLiveArtifact,
  type RuntimeStrategyLabSubjectKind,
} from "../../../src/runtime/contracts/autonomous_runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value ?? "");
}

function stringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
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

function mapPostLiveArtifactRow(
  row: Record<string, unknown>,
): RuntimeStrategyLabPostLiveArtifact {
  const currentState = stringOrNull(row.currentState);
  const deploymentId = stringOrNull(row.deploymentId);
  const venueKey = stringOrNull(row.venueKey);
  const assetKey = stringOrNull(row.assetKey);
  const pairSymbol = stringOrNull(row.pairSymbol);
  const recommendedTargetState = stringOrNull(row.recommendedTargetState);
  const appliedAction = stringOrNull(row.appliedAction);
  const appliedTargetState = stringOrNull(row.appliedTargetState);
  const followUpPromotionId = stringOrNull(row.followUpPromotionId);
  const followUpControlRef = stringOrNull(row.followUpControlRef);
  const checks = parseJsonValue(row.checks);
  const evidenceRefs = parseJsonValue(row.evidenceRefs);
  const metadata = parseJsonValue(row.metadata);
  const appliedAt = stringOrNull(row.appliedAt);

  return parseRuntimeStrategyLabPostLiveArtifact({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    postLiveId: stringValue(row.postLiveId),
    subjectKind: stringValue(row.subjectKind),
    subjectKey: stringValue(row.subjectKey),
    ...(currentState ? { currentState } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    ...(venueKey ? { venueKey } : {}),
    ...(assetKey ? { assetKey } : {}),
    ...(pairSymbol ? { pairSymbol } : {}),
    status: stringValue(row.status),
    summary: stringValue(row.summary),
    recommendedAction: stringValue(row.recommendedAction),
    ...(recommendedTargetState ? { recommendedTargetState } : {}),
    ...(appliedAction ? { appliedAction } : {}),
    ...(appliedTargetState ? { appliedTargetState } : {}),
    ...(followUpPromotionId ? { followUpPromotionId } : {}),
    ...(followUpControlRef ? { followUpControlRef } : {}),
    checks: Array.isArray(checks) ? checks : [],
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(appliedAt ? { appliedAt } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

export async function writeStrategyLabPostLiveArtifact(
  db: D1Database,
  artifact: RuntimeStrategyLabPostLiveArtifact,
): Promise<RuntimeStrategyLabPostLiveArtifact> {
  await db
    .prepare(
      `
      INSERT INTO strategy_lab_post_live_artifacts (
        post_live_id,
        schema_version,
        subject_kind,
        subject_key,
        current_state,
        deployment_id,
        venue_key,
        asset_key,
        pair_symbol,
        status,
        summary,
        recommended_action,
        recommended_target_state,
        applied_action,
        applied_target_state,
        follow_up_promotion_id,
        follow_up_control_ref,
        checks_json,
        evidence_refs_json,
        metadata_json,
        created_at,
        updated_at,
        applied_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
        ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
      )
      ON CONFLICT(post_live_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        subject_kind = excluded.subject_kind,
        subject_key = excluded.subject_key,
        current_state = excluded.current_state,
        deployment_id = excluded.deployment_id,
        venue_key = excluded.venue_key,
        asset_key = excluded.asset_key,
        pair_symbol = excluded.pair_symbol,
        status = excluded.status,
        summary = excluded.summary,
        recommended_action = excluded.recommended_action,
        recommended_target_state = excluded.recommended_target_state,
        applied_action = excluded.applied_action,
        applied_target_state = excluded.applied_target_state,
        follow_up_promotion_id = excluded.follow_up_promotion_id,
        follow_up_control_ref = excluded.follow_up_control_ref,
        checks_json = excluded.checks_json,
        evidence_refs_json = excluded.evidence_refs_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        applied_at = excluded.applied_at
      `,
    )
    .bind(
      artifact.postLiveId,
      artifact.schemaVersion,
      artifact.subjectKind,
      artifact.subjectKey,
      artifact.currentState ?? null,
      artifact.deploymentId ?? null,
      artifact.venueKey ?? null,
      artifact.assetKey ?? null,
      artifact.pairSymbol ?? null,
      artifact.status,
      artifact.summary,
      artifact.recommendedAction,
      artifact.recommendedTargetState ?? null,
      artifact.appliedAction ?? null,
      artifact.appliedTargetState ?? null,
      artifact.followUpPromotionId ?? null,
      artifact.followUpControlRef ?? null,
      stringifyJson(artifact.checks) ?? "[]",
      stringifyJson(artifact.evidenceRefs) ?? "[]",
      stringifyJson(artifact.metadata),
      artifact.createdAt,
      artifact.updatedAt,
      artifact.appliedAt ?? null,
    )
    .run();
  return artifact;
}

export async function getStrategyLabPostLiveArtifact(
  db: D1Database,
  postLiveId: string,
): Promise<RuntimeStrategyLabPostLiveArtifact | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        post_live_id AS postLiveId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        current_state AS currentState,
        deployment_id AS deploymentId,
        venue_key AS venueKey,
        asset_key AS assetKey,
        pair_symbol AS pairSymbol,
        status,
        summary,
        recommended_action AS recommendedAction,
        recommended_target_state AS recommendedTargetState,
        applied_action AS appliedAction,
        applied_target_state AS appliedTargetState,
        follow_up_promotion_id AS followUpPromotionId,
        follow_up_control_ref AS followUpControlRef,
        checks_json AS checks,
        evidence_refs_json AS evidenceRefs,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        applied_at AS appliedAt
      FROM strategy_lab_post_live_artifacts
      WHERE post_live_id = ?1
      LIMIT 1
      `,
    )
    .bind(postLiveId)
    .first()) as Record<string, unknown> | null;
  return row ? mapPostLiveArtifactRow(row) : null;
}

export async function listStrategyLabPostLiveArtifacts(
  db: D1Database,
  options?: {
    subjectKind?: RuntimeStrategyLabSubjectKind;
    subjectKey?: string;
    postLiveId?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyLabPostLiveArtifact[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        post_live_id AS postLiveId,
        schema_version AS schemaVersion,
        subject_kind AS subjectKind,
        subject_key AS subjectKey,
        current_state AS currentState,
        deployment_id AS deploymentId,
        venue_key AS venueKey,
        asset_key AS assetKey,
        pair_symbol AS pairSymbol,
        status,
        summary,
        recommended_action AS recommendedAction,
        recommended_target_state AS recommendedTargetState,
        applied_action AS appliedAction,
        applied_target_state AS appliedTargetState,
        follow_up_promotion_id AS followUpPromotionId,
        follow_up_control_ref AS followUpControlRef,
        checks_json AS checks,
        evidence_refs_json AS evidenceRefs,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        applied_at AS appliedAt
      FROM strategy_lab_post_live_artifacts
      WHERE (?1 IS NULL OR subject_kind = ?1)
        AND (?2 IS NULL OR subject_key = ?2)
        AND (?3 IS NULL OR post_live_id = ?3)
      ORDER BY created_at DESC, post_live_id DESC
      LIMIT ?4
      `,
    )
    .bind(
      options?.subjectKind ?? null,
      options?.subjectKey ?? null,
      options?.postLiveId ?? null,
      limit,
    )
    .all()) as { results?: Record<string, unknown>[] };
  return (rows.results ?? []).map(mapPostLiveArtifactRow);
}
