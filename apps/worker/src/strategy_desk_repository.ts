import {
  parseRuntimeStrategyDeskScenarioManifest,
  parseRuntimeStrategyDeskScenarioReport,
  parseRuntimeStrategyDeskScenarioRun,
  type RuntimeStrategyDeskScenarioManifest,
  type RuntimeStrategyDeskScenarioReport,
  type RuntimeStrategyDeskScenarioRun,
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

type StrategyDeskScenarioRow = Record<string, unknown>;
type StrategyDeskScenarioLegRow = Record<string, unknown>;
type StrategyDeskScenarioRunRow = Record<string, unknown>;
type StrategyDeskScenarioReportRow = Record<string, unknown>;

function mapScenarioLegRow(
  row: StrategyDeskScenarioLegRow,
): RuntimeStrategyDeskScenarioManifest["legs"][number] {
  const pair = parseJsonValue(row.pair);
  const assetKeys = parseJsonValue(row.assetKeys);
  const enabledModes = parseJsonValue(row.enabledModes);
  const sizing = parseJsonValue(row.sizing);
  const intent = parseJsonValue(row.intent);
  const dependencies = parseJsonValue(row.dependencies);
  const tags = parseJsonValue(row.tags);

  return {
    legId: stringValue(row.legId),
    label: stringValue(row.label),
    role: stringValue(
      row.role,
    ) as RuntimeStrategyDeskScenarioManifest["legs"][number]["role"],
    venueKey: stringValue(row.venueKey),
    intentFamily: stringValue(
      row.intentFamily,
    ) as RuntimeStrategyDeskScenarioManifest["legs"][number]["intentFamily"],
    marketType: stringValue(
      row.marketType,
    ) as RuntimeStrategyDeskScenarioManifest["legs"][number]["marketType"],
    ...(isRecord(pair) ? { pair } : {}),
    ...(stringOrNull(row.instrumentId)
      ? { instrumentId: stringValue(row.instrumentId) }
      : {}),
    assetKeys: Array.isArray(assetKeys) ? assetKeys : [],
    enabledModes: Array.isArray(enabledModes) ? enabledModes : [],
    sizing: isRecord(sizing) ? sizing : {},
    ...(isRecord(intent) ? { intent } : {}),
    ...(stringOrNull(row.thesis) ? { thesis: stringValue(row.thesis) } : {}),
    ...(Array.isArray(dependencies) && dependencies.length > 0
      ? { dependencies }
      : {}),
    ...(Array.isArray(tags) && tags.length > 0 ? { tags } : {}),
  };
}

function mapScenarioRow(
  row: StrategyDeskScenarioRow,
  legs: RuntimeStrategyDeskScenarioManifest["legs"],
): RuntimeStrategyDeskScenarioManifest {
  const sleeveId = stringOrNull(row.sleeveId);
  const reviewedAt = stringOrNull(row.reviewedAt);
  const activeHandoffId = stringOrNull(row.activeHandoffId);
  const latestReportId = stringOrNull(row.latestReportId);
  const riskLimits = parseJsonValue(row.riskLimits);
  const evidence = parseJsonValue(row.evidence);
  const implementationReferences = parseJsonValue(row.implementationReferences);
  const tags = parseJsonValue(row.tags);
  const metadata = parseJsonValue(row.metadata);

  return parseRuntimeStrategyDeskScenarioManifest({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    scenarioId: stringValue(row.scenarioId),
    title: stringValue(row.title),
    summary: stringValue(row.summary),
    ownerUserId: stringValue(row.ownerUserId),
    strategyKey: stringValue(row.strategyKey),
    thesis: stringValue(row.thesis),
    ...(sleeveId ? { sleeveId } : {}),
    state: stringValue(
      row.state,
    ) as RuntimeStrategyDeskScenarioManifest["state"],
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(activeHandoffId ? { activeHandoffId } : {}),
    ...(latestReportId ? { latestReportId } : {}),
    ...(isRecord(riskLimits) ? { riskLimits } : {}),
    legs,
    evidence: Array.isArray(evidence) ? evidence : [],
    implementationReferences: Array.isArray(implementationReferences)
      ? implementationReferences
      : [],
    tags: Array.isArray(tags) ? tags : [],
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapScenarioRunRow(
  row: StrategyDeskScenarioRunRow,
): RuntimeStrategyDeskScenarioRun {
  const trigger = parseJsonValue(row.trigger);
  const legRuns = parseJsonValue(row.legRuns);
  const metadata = parseJsonValue(row.metadata);
  const startedAt = stringOrNull(row.startedAt);
  const completedAt = stringOrNull(row.completedAt);
  const failureCode = stringOrNull(row.failureCode);
  const failureMessage = stringOrNull(row.failureMessage);

  return parseRuntimeStrategyDeskScenarioRun({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    scenarioRunId: stringValue(row.scenarioRunId),
    scenarioId: stringValue(row.scenarioId),
    scenarioState: stringValue(
      row.scenarioState,
    ) as RuntimeStrategyDeskScenarioRun["scenarioState"],
    runKind: stringValue(
      row.runKind,
    ) as RuntimeStrategyDeskScenarioRun["runKind"],
    state: stringValue(row.state) as RuntimeStrategyDeskScenarioRun["state"],
    requestedBy: stringValue(row.requestedBy),
    trigger: isRecord(trigger) ? trigger : {},
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    legRuns: Array.isArray(legRuns) ? legRuns : [],
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

function mapScenarioReportRow(
  row: StrategyDeskScenarioReportRow,
): RuntimeStrategyDeskScenarioReport {
  const legOutcomes = parseJsonValue(row.legOutcomes);
  const portfolioSummary = parseJsonValue(row.portfolioSummary);
  const scorecard = parseJsonValue(row.scorecard);
  const riskOverlays = parseJsonValue(row.riskOverlays);
  const evidence = parseJsonValue(row.evidence);
  const checks = parseJsonValue(row.checks);
  const approvals = parseJsonValue(row.approvals);
  const metadata = parseJsonValue(row.metadata);

  return parseRuntimeStrategyDeskScenarioReport({
    schemaVersion: stringValue(row.schemaVersion || "v1"),
    reportId: stringValue(row.reportId),
    scenarioId: stringValue(row.scenarioId),
    scenarioRunId: stringValue(row.scenarioRunId),
    stage: stringValue(row.stage) as RuntimeStrategyDeskScenarioReport["stage"],
    status: stringValue(
      row.status,
    ) as RuntimeStrategyDeskScenarioReport["status"],
    summary: stringValue(row.summary),
    generatedAt: stringValue(row.generatedAt),
    legOutcomes: Array.isArray(legOutcomes) ? legOutcomes : [],
    ...(isRecord(portfolioSummary) ? { portfolioSummary } : {}),
    ...(isRecord(scorecard) ? { scorecard } : {}),
    ...(Array.isArray(riskOverlays) ? { riskOverlays } : {}),
    evidence: Array.isArray(evidence) ? evidence : [],
    checks: Array.isArray(checks) ? checks : [],
    approvals: Array.isArray(approvals) ? approvals : [],
    ...(isRecord(metadata) ? { metadata } : {}),
  });
}

async function listScenarioLegsForIds(
  db: D1Database,
  scenarioIds: string[],
): Promise<Map<string, RuntimeStrategyDeskScenarioManifest["legs"]>> {
  const result = new Map<string, RuntimeStrategyDeskScenarioManifest["legs"]>();
  if (scenarioIds.length === 0) return result;

  const placeholders = scenarioIds
    .map((_, index) => `?${index + 1}`)
    .join(", ");
  const rows = (await db
    .prepare(
      `
      SELECT
        scenario_id AS scenarioId,
        leg_id AS legId,
        sort_order AS sortOrder,
        label,
        role,
        venue_key AS venueKey,
        intent_family AS intentFamily,
        market_type AS marketType,
        pair_json AS pair,
        instrument_id AS instrumentId,
        asset_keys_json AS assetKeys,
        enabled_modes_json AS enabledModes,
        sizing_json AS sizing,
        intent_json AS intent,
        thesis,
        dependencies_json AS dependencies,
        tags_json AS tags
      FROM strategy_desk_scenario_legs
      WHERE scenario_id IN (${placeholders})
      ORDER BY scenario_id ASC, sort_order ASC, leg_id ASC
      `,
    )
    .bind(...scenarioIds)
    .all()) as { results?: StrategyDeskScenarioLegRow[] };

  for (const row of rows.results ?? []) {
    const scenarioId = stringValue(row.scenarioId);
    const legs = result.get(scenarioId) ?? [];
    legs.push(mapScenarioLegRow(row));
    result.set(scenarioId, legs);
  }
  return result;
}

export async function writeStrategyDeskScenarioManifest(
  db: D1Database,
  scenario: RuntimeStrategyDeskScenarioManifest,
): Promise<RuntimeStrategyDeskScenarioManifest> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_scenarios (
        scenario_id,
        schema_version,
        title,
        summary,
        owner_user_id,
        strategy_key,
        thesis,
        sleeve_id,
        state,
        reviewed_at,
        active_handoff_id,
        latest_report_id,
        risk_limits_json,
        evidence_json,
        implementation_references_json,
        tags_json,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
      )
      ON CONFLICT(scenario_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        title = excluded.title,
        summary = excluded.summary,
        owner_user_id = excluded.owner_user_id,
        strategy_key = excluded.strategy_key,
        thesis = excluded.thesis,
        sleeve_id = excluded.sleeve_id,
        state = excluded.state,
        reviewed_at = excluded.reviewed_at,
        active_handoff_id = excluded.active_handoff_id,
        latest_report_id = excluded.latest_report_id,
        risk_limits_json = excluded.risk_limits_json,
        evidence_json = excluded.evidence_json,
        implementation_references_json = excluded.implementation_references_json,
        tags_json = excluded.tags_json,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      `,
    )
    .bind(
      scenario.scenarioId,
      scenario.schemaVersion,
      scenario.title,
      scenario.summary,
      scenario.ownerUserId,
      scenario.strategyKey,
      scenario.thesis,
      scenario.sleeveId ?? null,
      scenario.state,
      scenario.reviewedAt ?? null,
      scenario.activeHandoffId ?? null,
      scenario.latestReportId ?? null,
      stringifyJson(scenario.riskLimits),
      stringifyJson(scenario.evidence) ?? "[]",
      stringifyJson(scenario.implementationReferences) ?? "[]",
      stringifyJson(scenario.tags) ?? "[]",
      stringifyJson(scenario.metadata),
      scenario.createdAt,
      scenario.updatedAt,
    )
    .run();

  await db
    .prepare(
      `
      DELETE FROM strategy_desk_scenario_legs
      WHERE scenario_id = ?1
      `,
    )
    .bind(scenario.scenarioId)
    .run();

  for (const [index, leg] of scenario.legs.entries()) {
    await db
      .prepare(
        `
        INSERT INTO strategy_desk_scenario_legs (
          scenario_id,
          leg_id,
          sort_order,
          label,
          role,
          venue_key,
          intent_family,
          market_type,
          pair_json,
          instrument_id,
          asset_keys_json,
          enabled_modes_json,
          sizing_json,
          intent_json,
          thesis,
          dependencies_json,
          tags_json
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
        )
        `,
      )
      .bind(
        scenario.scenarioId,
        leg.legId,
        index,
        leg.label,
        leg.role,
        leg.venueKey,
        leg.intentFamily,
        leg.marketType,
        stringifyJson(leg.pair),
        leg.instrumentId ?? null,
        stringifyJson(leg.assetKeys) ?? "[]",
        stringifyJson(leg.enabledModes) ?? "[]",
        stringifyJson(leg.sizing) ?? "{}",
        stringifyJson(leg.intent),
        leg.thesis ?? null,
        stringifyJson(leg.dependencies),
        stringifyJson(leg.tags),
      )
      .run();
  }

  return scenario;
}

export async function updateStrategyDeskScenarioLatestReport(
  db: D1Database,
  input: {
    scenarioId: string;
    latestReportId: string;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `
      UPDATE strategy_desk_scenarios
      SET latest_report_id = ?2,
          updated_at = ?3
      WHERE scenario_id = ?1
      `,
    )
    .bind(input.scenarioId, input.latestReportId, input.updatedAt)
    .run();
}

export async function getStrategyDeskScenarioManifest(
  db: D1Database,
  scenarioId: string,
): Promise<RuntimeStrategyDeskScenarioManifest | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        title,
        summary,
        owner_user_id AS ownerUserId,
        strategy_key AS strategyKey,
        thesis,
        sleeve_id AS sleeveId,
        state,
        reviewed_at AS reviewedAt,
        active_handoff_id AS activeHandoffId,
        latest_report_id AS latestReportId,
        risk_limits_json AS riskLimits,
        evidence_json AS evidence,
        implementation_references_json AS implementationReferences,
        tags_json AS tags,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_desk_scenarios
      WHERE scenario_id = ?1
      LIMIT 1
      `,
    )
    .bind(scenarioId)
    .first()) as StrategyDeskScenarioRow | null;

  if (!row) return null;
  const legsByScenario = await listScenarioLegsForIds(db, [scenarioId]);
  return mapScenarioRow(row, legsByScenario.get(scenarioId) ?? []);
}

export async function listStrategyDeskScenarioManifests(
  db: D1Database,
  options?: {
    scenarioId?: string;
    ownerUserId?: string;
    strategyKey?: string;
    state?: string;
    venueKey?: string;
    intentFamily?: string;
    marketType?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyDeskScenarioManifest[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        title,
        summary,
        owner_user_id AS ownerUserId,
        strategy_key AS strategyKey,
        thesis,
        sleeve_id AS sleeveId,
        state,
        reviewed_at AS reviewedAt,
        active_handoff_id AS activeHandoffId,
        latest_report_id AS latestReportId,
        risk_limits_json AS riskLimits,
        evidence_json AS evidence,
        implementation_references_json AS implementationReferences,
        tags_json AS tags,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM strategy_desk_scenarios
      WHERE (?1 IS NULL OR scenario_id = ?1)
        AND (?2 IS NULL OR owner_user_id = ?2)
        AND (?3 IS NULL OR strategy_key = ?3)
        AND (?4 IS NULL OR state = ?4)
        AND (
          (?5 IS NULL AND ?6 IS NULL AND ?7 IS NULL) OR EXISTS (
            SELECT 1
            FROM strategy_desk_scenario_legs
            WHERE scenario_id = strategy_desk_scenarios.scenario_id
              AND (?5 IS NULL OR venue_key = ?5)
              AND (?6 IS NULL OR intent_family = ?6)
              AND (?7 IS NULL OR market_type = ?7)
          )
        )
      ORDER BY updated_at DESC, scenario_id DESC
      LIMIT ?8
      `,
    )
    .bind(
      options?.scenarioId ?? null,
      options?.ownerUserId ?? null,
      options?.strategyKey ?? null,
      options?.state ?? null,
      options?.venueKey ?? null,
      options?.intentFamily ?? null,
      options?.marketType ?? null,
      limit,
    )
    .all()) as { results?: StrategyDeskScenarioRow[] };

  const results = rows.results ?? [];
  const scenarioIds = results.map((row) => stringValue(row.scenarioId));
  const legsByScenario = await listScenarioLegsForIds(db, scenarioIds);
  return results.map((row) =>
    mapScenarioRow(row, legsByScenario.get(stringValue(row.scenarioId)) ?? []),
  );
}

export async function writeStrategyDeskScenarioRun(
  db: D1Database,
  run: RuntimeStrategyDeskScenarioRun,
): Promise<RuntimeStrategyDeskScenarioRun> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_runs (
        scenario_run_id,
        scenario_id,
        schema_version,
        scenario_state,
        run_kind,
        state,
        requested_by,
        trigger_json,
        leg_runs_json,
        failure_code,
        failure_message,
        metadata_json,
        created_at,
        updated_at,
        started_at,
        completed_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
      )
      ON CONFLICT(scenario_run_id) DO UPDATE SET
        scenario_id = excluded.scenario_id,
        schema_version = excluded.schema_version,
        scenario_state = excluded.scenario_state,
        run_kind = excluded.run_kind,
        state = excluded.state,
        requested_by = excluded.requested_by,
        trigger_json = excluded.trigger_json,
        leg_runs_json = excluded.leg_runs_json,
        failure_code = excluded.failure_code,
        failure_message = excluded.failure_message,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
      `,
    )
    .bind(
      run.scenarioRunId,
      run.scenarioId,
      run.schemaVersion,
      run.scenarioState,
      run.runKind,
      run.state,
      run.requestedBy,
      stringifyJson(run.trigger) ?? "{}",
      stringifyJson(run.legRuns) ?? "[]",
      run.failureCode ?? null,
      run.failureMessage ?? null,
      stringifyJson(run.metadata),
      run.createdAt,
      run.updatedAt,
      run.startedAt ?? null,
      run.completedAt ?? null,
    )
    .run();
  return run;
}

export async function getStrategyDeskScenarioRun(
  db: D1Database,
  scenarioRunId: string,
): Promise<RuntimeStrategyDeskScenarioRun | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        scenario_run_id AS scenarioRunId,
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        scenario_state AS scenarioState,
        run_kind AS runKind,
        state,
        requested_by AS requestedBy,
        trigger_json AS trigger,
        leg_runs_json AS legRuns,
        failure_code AS failureCode,
        failure_message AS failureMessage,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM strategy_desk_runs
      WHERE scenario_run_id = ?1
      LIMIT 1
      `,
    )
    .bind(scenarioRunId)
    .first()) as StrategyDeskScenarioRunRow | null;
  return row ? mapScenarioRunRow(row) : null;
}

export async function listStrategyDeskScenarioRuns(
  db: D1Database,
  options?: {
    scenarioRunId?: string;
    scenarioId?: string;
    runKind?: string;
    state?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyDeskScenarioRun[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        scenario_run_id AS scenarioRunId,
        scenario_id AS scenarioId,
        schema_version AS schemaVersion,
        scenario_state AS scenarioState,
        run_kind AS runKind,
        state,
        requested_by AS requestedBy,
        trigger_json AS trigger,
        leg_runs_json AS legRuns,
        failure_code AS failureCode,
        failure_message AS failureMessage,
        metadata_json AS metadata,
        created_at AS createdAt,
        updated_at AS updatedAt,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM strategy_desk_runs
      WHERE (?1 IS NULL OR scenario_run_id = ?1)
        AND (?2 IS NULL OR scenario_id = ?2)
        AND (?3 IS NULL OR run_kind = ?3)
        AND (?4 IS NULL OR state = ?4)
      ORDER BY created_at DESC, scenario_run_id DESC
      LIMIT ?5
      `,
    )
    .bind(
      options?.scenarioRunId ?? null,
      options?.scenarioId ?? null,
      options?.runKind ?? null,
      options?.state ?? null,
      limit,
    )
    .all()) as { results?: StrategyDeskScenarioRunRow[] };
  return (rows.results ?? []).map(mapScenarioRunRow);
}

export async function writeStrategyDeskScenarioReport(
  db: D1Database,
  report: RuntimeStrategyDeskScenarioReport,
): Promise<RuntimeStrategyDeskScenarioReport> {
  await db
    .prepare(
      `
      INSERT INTO strategy_desk_reports (
        report_id,
        scenario_id,
        scenario_run_id,
        schema_version,
        stage,
        status,
        summary,
        leg_outcomes_json,
        portfolio_summary_json,
        scorecard_json,
        risk_overlays_json,
        evidence_json,
        checks_json,
        approvals_json,
        metadata_json,
        generated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
      )
      ON CONFLICT(report_id) DO UPDATE SET
        scenario_id = excluded.scenario_id,
        scenario_run_id = excluded.scenario_run_id,
        schema_version = excluded.schema_version,
        stage = excluded.stage,
        status = excluded.status,
        summary = excluded.summary,
        leg_outcomes_json = excluded.leg_outcomes_json,
        portfolio_summary_json = excluded.portfolio_summary_json,
        scorecard_json = excluded.scorecard_json,
        risk_overlays_json = excluded.risk_overlays_json,
        evidence_json = excluded.evidence_json,
        checks_json = excluded.checks_json,
        approvals_json = excluded.approvals_json,
        metadata_json = excluded.metadata_json,
        generated_at = excluded.generated_at
      `,
    )
    .bind(
      report.reportId,
      report.scenarioId,
      report.scenarioRunId,
      report.schemaVersion,
      report.stage,
      report.status,
      report.summary,
      stringifyJson(report.legOutcomes) ?? "[]",
      stringifyJson(report.portfolioSummary),
      stringifyJson(report.scorecard),
      stringifyJson(report.riskOverlays) ?? "[]",
      stringifyJson(report.evidence) ?? "[]",
      stringifyJson(report.checks) ?? "[]",
      stringifyJson(report.approvals) ?? "[]",
      stringifyJson(report.metadata),
      report.generatedAt,
    )
    .run();
  return report;
}

export async function getStrategyDeskScenarioReport(
  db: D1Database,
  reportId: string,
): Promise<RuntimeStrategyDeskScenarioReport | null> {
  const row = (await db
    .prepare(
      `
      SELECT
        report_id AS reportId,
        scenario_id AS scenarioId,
        scenario_run_id AS scenarioRunId,
        schema_version AS schemaVersion,
        stage,
        status,
        summary,
        leg_outcomes_json AS legOutcomes,
        portfolio_summary_json AS portfolioSummary,
        scorecard_json AS scorecard,
        risk_overlays_json AS riskOverlays,
        evidence_json AS evidence,
        checks_json AS checks,
        approvals_json AS approvals,
        metadata_json AS metadata,
        generated_at AS generatedAt
      FROM strategy_desk_reports
      WHERE report_id = ?1
      LIMIT 1
      `,
    )
    .bind(reportId)
    .first()) as StrategyDeskScenarioReportRow | null;
  return row ? mapScenarioReportRow(row) : null;
}

export async function listStrategyDeskScenarioReports(
  db: D1Database,
  options?: {
    reportId?: string;
    scenarioId?: string;
    scenarioRunId?: string;
    stage?: string;
    status?: string;
    limit?: number;
  },
): Promise<RuntimeStrategyDeskScenarioReport[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const rows = (await db
    .prepare(
      `
      SELECT
        report_id AS reportId,
        scenario_id AS scenarioId,
        scenario_run_id AS scenarioRunId,
        schema_version AS schemaVersion,
        stage,
        status,
        summary,
        leg_outcomes_json AS legOutcomes,
        portfolio_summary_json AS portfolioSummary,
        scorecard_json AS scorecard,
        risk_overlays_json AS riskOverlays,
        evidence_json AS evidence,
        checks_json AS checks,
        approvals_json AS approvals,
        metadata_json AS metadata,
        generated_at AS generatedAt
      FROM strategy_desk_reports
      WHERE (?1 IS NULL OR report_id = ?1)
        AND (?2 IS NULL OR scenario_id = ?2)
        AND (?3 IS NULL OR scenario_run_id = ?3)
        AND (?4 IS NULL OR stage = ?4)
        AND (?5 IS NULL OR status = ?5)
      ORDER BY generated_at DESC, report_id DESC
      LIMIT ?6
      `,
    )
    .bind(
      options?.reportId ?? null,
      options?.scenarioId ?? null,
      options?.scenarioRunId ?? null,
      options?.stage ?? null,
      options?.status ?? null,
      limit,
    )
    .all()) as { results?: StrategyDeskScenarioReportRow[] };
  return (rows.results ?? []).map(mapScenarioReportRow);
}
