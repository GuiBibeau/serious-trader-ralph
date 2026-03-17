import {
  parseRuntimeStrategyDeskPromotionHandoff,
  type RuntimeStrategyDeskPromotionHandoff,
} from "../../../src/runtime/contracts/autonomous_runtime.js";

export type StrategyDeskPromotionHandoffEvent = {
  eventId: string;
  handoffId: string;
  eventType:
    | "prepared"
    | "submitted"
    | "approved"
    | "applied"
    | "rejected"
    | "paused"
    | "killed"
    | "demoted"
    | "archived";
  actor: string;
  fromStatus?: string;
  toStatus?: string;
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
};

export type StrategyDeskExecutionRecipeRecord = {
  recipeId: string;
  scenarioId: string;
  handoffId: string;
  bindingId: string;
  schemaVersion: string;
  status: "paper" | "armed" | "paused" | "killed" | "archived";
  venueKey: string;
  instrumentId?: string;
  pair?: Record<string, unknown>;
  targetMode: "shadow" | "paper" | "limited_live";
  lane?: string;
  legIds: string[];
  budget?: Record<string, unknown>;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type StrategyDeskPromotionHandoffRow = Record<string, unknown>;
type StrategyDeskPromotionHandoffEventRow = Record<string, unknown>;
type StrategyDeskExecutionRecipeRow = Record<string, unknown>;

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

function mapHandoffRow(
  row: StrategyDeskPromotionHandoffRow,
): RuntimeStrategyDeskPromotionHandoff {
  const implementationReference = parseJsonValue(row.implementationReference);
  const evidenceRefs = parseJsonValue(row.evidenceRefs);
  const checks = parseJsonValue(row.checks);
  const approvals = parseJsonValue(row.approvals);
  const bindings = parseJsonValue(row.bindings);
  const actions = parseJsonValue(row.actions);
  const metadata = parseJsonValue(row.metadata);
  const appliedAt = stringOrNull(row.appliedAt);

  return parseRuntimeStrategyDeskPromotionHandoff({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    handoffId: stringValue(row.handoffId),
    scenarioId: stringValue(row.scenarioId),
    currentState: stringValue(row.currentState),
    targetMode: stringValue(row.targetMode),
    status: stringValue(row.status),
    summary: stringValue(row.summary),
    requestedBy: stringValue(row.requestedBy),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(appliedAt ? { appliedAt } : {}),
    ...(isRecord(implementationReference) ? { implementationReference } : {}),
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    checks: Array.isArray(checks) ? checks : [],
    approvals: Array.isArray(approvals) ? approvals : [],
    bindings: Array.isArray(bindings) ? bindings : [],
    actions: Array.isArray(actions) ? actions : [],
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapHandoffEventRow(
  row: StrategyDeskPromotionHandoffEventRow,
): StrategyDeskPromotionHandoffEvent {
  const fromStatus = stringOrNull(row.fromStatus);
  const toStatus = stringOrNull(row.toStatus);
  const details = parseJsonValue(row.details);

  return {
    eventId: stringValue(row.eventId),
    handoffId: stringValue(row.handoffId),
    eventType: stringValue(
      row.eventType,
    ) as StrategyDeskPromotionHandoffEvent["eventType"],
    actor: stringValue(row.actor),
    ...(fromStatus ? { fromStatus } : {}),
    ...(toStatus ? { toStatus } : {}),
    summary: stringValue(row.summary),
    ...(isRecord(details) ? { details } : {}),
    createdAt: stringValue(row.createdAt),
  };
}

function mapExecutionRecipeRow(
  row: StrategyDeskExecutionRecipeRow,
): StrategyDeskExecutionRecipeRecord {
  const pair = parseJsonValue(row.pair);
  const legIds = parseJsonValue(row.legIds);
  const budget = parseJsonValue(row.budget);
  const metadata = parseJsonValue(row.metadata);
  const instrumentId = stringOrNull(row.instrumentId);
  const lane = stringOrNull(row.lane);
  const notes = stringOrNull(row.notes);

  return {
    recipeId: stringValue(row.recipeId),
    scenarioId: stringValue(row.scenarioId),
    handoffId: stringValue(row.handoffId),
    bindingId: stringValue(row.bindingId),
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    status: stringValue(
      row.status,
    ) as StrategyDeskExecutionRecipeRecord["status"],
    venueKey: stringValue(row.venueKey),
    ...(instrumentId ? { instrumentId } : {}),
    ...(isRecord(pair) ? { pair } : {}),
    targetMode: stringValue(
      row.targetMode,
    ) as StrategyDeskExecutionRecipeRecord["targetMode"],
    ...(lane ? { lane } : {}),
    legIds: Array.isArray(legIds)
      ? legIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    ...(isRecord(budget) ? { budget } : {}),
    ...(notes ? { notes } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

export async function writeStrategyDeskPromotionHandoff(
  db: D1Database,
  handoff: RuntimeStrategyDeskPromotionHandoff,
): Promise<RuntimeStrategyDeskPromotionHandoff> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_promotion_handoffs (
        handoff_id,
        scenario_id,
        schema_version,
        current_state,
        target_mode,
        status,
        summary,
        requested_by,
        implementation_reference_json,
        evidence_refs_json,
        checks_json,
        approvals_json,
        bindings_json,
        actions_json,
        metadata_json,
        created_at,
        updated_at,
        applied_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
      )
      ON CONFLICT(handoff_id) DO UPDATE SET
        scenario_id = excluded.scenario_id,
        schema_version = excluded.schema_version,
        current_state = excluded.current_state,
        target_mode = excluded.target_mode,
        status = excluded.status,
        summary = excluded.summary,
        requested_by = excluded.requested_by,
        implementation_reference_json = excluded.implementation_reference_json,
        evidence_refs_json = excluded.evidence_refs_json,
        checks_json = excluded.checks_json,
        approvals_json = excluded.approvals_json,
        bindings_json = excluded.bindings_json,
        actions_json = excluded.actions_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        applied_at = excluded.applied_at
      `,
    )
    .bind(
      handoff.handoffId,
      handoff.scenarioId,
      handoff.schemaVersion,
      handoff.currentState,
      handoff.targetMode,
      handoff.status,
      handoff.summary,
      handoff.requestedBy,
      stringifyJson(handoff.implementationReference),
      stringifyJson(handoff.evidenceRefs) ?? "[]",
      stringifyJson(handoff.checks) ?? "[]",
      stringifyJson(handoff.approvals) ?? "[]",
      stringifyJson(handoff.bindings) ?? "[]",
      stringifyJson(handoff.actions) ?? "[]",
      stringifyJson(handoff.metadata),
      handoff.createdAt,
      handoff.updatedAt,
      handoff.appliedAt ?? null,
    )
    .run();
  return handoff;
}

export async function getStrategyDeskPromotionHandoff(
  db: D1Database,
  handoffId: string,
): Promise<RuntimeStrategyDeskPromotionHandoff | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        handoff_id AS handoffId,
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        current_state AS currentState,
        target_mode AS targetMode,
        status,
        summary,
        requested_by AS requestedBy,
        implementation_reference_json AS implementationReference,
        evidence_refs_json AS evidenceRefs,
        checks_json AS checks,
        approvals_json AS approvals,
        bindings_json AS bindings,
        actions_json AS actions,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        applied_at AS appliedAt
      FROM strategy_desk_promotion_handoffs
      WHERE handoff_id = ?1
      LIMIT 1
      `,
    )
    .bind(handoffId)
    .first()) as StrategyDeskPromotionHandoffRow | null;
  return row ? mapHandoffRow(row) : null;
}

export async function listStrategyDeskPromotionHandoffs(
  db: D1Database,
  options?: {
    handoffId?: string;
    scenarioId?: string;
    status?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyDeskPromotionHandoff[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        handoff_id AS handoffId,
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        current_state AS currentState,
        target_mode AS targetMode,
        status,
        summary,
        requested_by AS requestedBy,
        implementation_reference_json AS implementationReference,
        evidence_refs_json AS evidenceRefs,
        checks_json AS checks,
        approvals_json AS approvals,
        bindings_json AS bindings,
        actions_json AS actions,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        applied_at AS appliedAt
      FROM strategy_desk_promotion_handoffs
      WHERE (?1 IS NULL OR handoff_id = ?1)
        AND (?2 IS NULL OR scenario_id = ?2)
        AND (?3 IS NULL OR status = ?3)
      ORDER BY created_at DESC, handoff_id DESC
      LIMIT ?4
      `,
    )
    .bind(
      options?.handoffId ?? null,
      options?.scenarioId ?? null,
      options?.status ?? null,
      limit,
    )
    .all()) as { results?: StrategyDeskPromotionHandoffRow[] };
  return (rows.results ?? []).map(mapHandoffRow);
}

export async function appendStrategyDeskPromotionHandoffEvent(
  db: D1Database,
  event: StrategyDeskPromotionHandoffEvent,
): Promise<StrategyDeskPromotionHandoffEvent> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_promotion_handoff_events (
        event_id,
        handoff_id,
        event_type,
        actor,
        from_status,
        to_status,
        summary,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `,
    )
    .bind(
      event.eventId,
      event.handoffId,
      event.eventType,
      event.actor,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.summary,
      stringifyJson(event.details),
      event.createdAt,
    )
    .run();
  return event;
}

export async function listStrategyDeskPromotionHandoffEvents(
  db: D1Database,
  handoffId: string,
): Promise<StrategyDeskPromotionHandoffEvent[]> {
  const rows = (await db
    .prepare(
      `
      SELECT
        event_id AS eventId,
        handoff_id AS handoffId,
        event_type AS eventType,
        actor,
        from_status AS fromStatus,
        to_status AS toStatus,
        summary,
        details_json AS details,
        created_at AS createdAt
      FROM strategy_desk_promotion_handoff_events
      WHERE handoff_id = ?1
      ORDER BY created_at ASC, rowid ASC
      `,
    )
    .bind(handoffId)
    .all()) as { results?: StrategyDeskPromotionHandoffEventRow[] };
  return (rows.results ?? []).map(mapHandoffEventRow);
}

export async function writeStrategyDeskExecutionRecipe(
  db: D1Database,
  recipe: StrategyDeskExecutionRecipeRecord,
): Promise<StrategyDeskExecutionRecipeRecord> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_execution_recipes (
        recipe_id,
        scenario_id,
        handoff_id,
        binding_id,
        schema_version,
        status,
        venue_key,
        instrument_id,
        pair_json,
        target_mode,
        lane,
        leg_ids_json,
        budget_json,
        notes,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
      )
      ON CONFLICT(recipe_id) DO UPDATE SET
        scenario_id = excluded.scenario_id,
        handoff_id = excluded.handoff_id,
        binding_id = excluded.binding_id,
        schema_version = excluded.schema_version,
        status = excluded.status,
        venue_key = excluded.venue_key,
        instrument_id = excluded.instrument_id,
        pair_json = excluded.pair_json,
        target_mode = excluded.target_mode,
        lane = excluded.lane,
        leg_ids_json = excluded.leg_ids_json,
        budget_json = excluded.budget_json,
        notes = excluded.notes,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      recipe.recipeId,
      recipe.scenarioId,
      recipe.handoffId,
      recipe.bindingId,
      recipe.schemaVersion,
      recipe.status,
      recipe.venueKey,
      recipe.instrumentId ?? null,
      stringifyJson(recipe.pair),
      recipe.targetMode,
      recipe.lane ?? null,
      stringifyJson(recipe.legIds) ?? "[]",
      stringifyJson(recipe.budget),
      recipe.notes ?? null,
      stringifyJson(recipe.metadata),
      recipe.createdAt,
      recipe.updatedAt,
    )
    .run();
  return recipe;
}

export async function getStrategyDeskExecutionRecipeForBinding(
  db: D1Database,
  handoffId: string,
  bindingId: string,
): Promise<StrategyDeskExecutionRecipeRecord | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        recipe_id AS recipeId,
        scenario_id AS scenarioId,
        handoff_id AS handoffId,
        binding_id AS bindingId,
        schema_version AS schemaVersion,
        status,
        venue_key AS venueKey,
        instrument_id AS instrumentId,
        pair_json AS pair,
        target_mode AS targetMode,
        lane,
        leg_ids_json AS legIds,
        budget_json AS budget,
        notes,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_desk_execution_recipes
      WHERE handoff_id = ?1 AND binding_id = ?2
      LIMIT 1
      `,
    )
    .bind(handoffId, bindingId)
    .first()) as StrategyDeskExecutionRecipeRow | null;
  return row ? mapExecutionRecipeRow(row) : null;
}

export async function listStrategyDeskExecutionRecipes(
  db: D1Database,
  options?: {
    scenarioId?: string;
    handoffId?: string;
    status?: string;
    limit?: number;
  },
): Promise<StrategyDeskExecutionRecipeRecord[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        recipe_id AS recipeId,
        scenario_id AS scenarioId,
        handoff_id AS handoffId,
        binding_id AS bindingId,
        schema_version AS schemaVersion,
        status,
        venue_key AS venueKey,
        instrument_id AS instrumentId,
        pair_json AS pair,
        target_mode AS targetMode,
        lane,
        leg_ids_json AS legIds,
        budget_json AS budget,
        notes,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_desk_execution_recipes
      WHERE (?1 IS NULL OR scenario_id = ?1)
        AND (?2 IS NULL OR handoff_id = ?2)
        AND (?3 IS NULL OR status = ?3)
      ORDER BY updated_at DESC, recipe_id DESC
      LIMIT ?4
      `,
    )
    .bind(
      options?.scenarioId ?? null,
      options?.handoffId ?? null,
      options?.status ?? null,
      limit,
    )
    .all()) as { results?: StrategyDeskExecutionRecipeRow[] };
  return (rows.results ?? []).map(mapExecutionRecipeRow);
}
