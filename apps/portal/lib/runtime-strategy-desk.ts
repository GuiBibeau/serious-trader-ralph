export type RuntimeStrategyDeskScenarioLeg = {
  legId: string;
  label: string;
  role: string;
  venueKey: string;
  intentFamily: string;
  marketType: string;
  pair?: Record<string, unknown>;
  instrumentId?: string;
  assetKeys: readonly string[];
  enabledModes: readonly string[];
  sizing: Record<string, unknown>;
  intent?: Record<string, unknown>;
  thesis?: string;
  dependencies?: readonly string[];
  tags?: readonly string[];
};

export type RuntimeStrategyDeskScenarioManifest = {
  schemaVersion?: string;
  scenarioId: string;
  title: string;
  summary: string;
  ownerUserId: string;
  strategyKey: string;
  thesis: string;
  sleeveId?: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  activeHandoffId?: string;
  latestReportId?: string;
  riskLimits?: Record<string, unknown>;
  researchMatrix?: Record<string, unknown>;
  legs: readonly RuntimeStrategyDeskScenarioLeg[];
  evidence: readonly Record<string, unknown>[];
  implementationReferences: readonly Record<string, unknown>[];
  tags: readonly string[];
  metadata?: Record<string, unknown>;
};

export type RuntimeStrategyDeskScenarioRun = {
  schemaVersion?: string;
  scenarioRunId: string;
  scenarioId: string;
  scenarioState: string;
  runKind: string;
  state: string;
  requestedBy: string;
  trigger: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  legRuns: readonly Record<string, unknown>[];
  failureCode?: string;
  failureMessage?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeStrategyDeskScenarioReport = {
  schemaVersion?: string;
  reportId: string;
  scenarioId: string;
  scenarioRunId: string;
  stage: string;
  status: string;
  summary: string;
  generatedAt: string;
  legOutcomes: readonly Record<string, unknown>[];
  portfolioSummary?: Record<string, unknown>;
  scorecard?: Record<string, unknown>;
  riskOverlays: readonly Record<string, unknown>[];
  studyMatrix?: Record<string, unknown>;
  evidence: readonly Record<string, unknown>[];
  checks: readonly Record<string, unknown>[];
  approvals: readonly Record<string, unknown>[];
  metadata?: Record<string, unknown>;
};

type ParseSuccess<T> = {
  success: true;
  data: T;
};

type ParseFailure = {
  success: false;
  error: string;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return readString(value) ?? undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => Boolean(readString(entry)));
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> =>
    isRecord(entry),
  );
}

function fail<T>(error: string): ParseResult<T> {
  return { success: false, error };
}

function safeParseScenarioLeg(
  value: unknown,
): ParseResult<RuntimeStrategyDeskScenarioLeg> {
  if (!isRecord(value)) return fail("strategy-desk-leg-not-object");
  const legId = readString(value.legId);
  const label = readString(value.label);
  const role = readString(value.role);
  const venueKey = readString(value.venueKey);
  const intentFamily = readString(value.intentFamily);
  const marketType = readString(value.marketType);
  if (!legId || !label || !role || !venueKey || !intentFamily || !marketType) {
    return fail("strategy-desk-leg-invalid");
  }

  return {
    success: true,
    data: {
      legId,
      label,
      role,
      venueKey,
      intentFamily,
      marketType,
      pair: isRecord(value.pair) ? value.pair : undefined,
      instrumentId: readOptionalString(value.instrumentId),
      assetKeys: readStringArray(value.assetKeys),
      enabledModes: readStringArray(value.enabledModes),
      sizing: isRecord(value.sizing) ? value.sizing : {},
      intent: isRecord(value.intent) ? value.intent : undefined,
      thesis: readOptionalString(value.thesis),
      dependencies: readStringArray(value.dependencies),
      tags: readStringArray(value.tags),
    },
  };
}

export function safeParseRuntimeStrategyDeskScenarioManifest(
  value: unknown,
): ParseResult<RuntimeStrategyDeskScenarioManifest> {
  if (!isRecord(value)) return fail("strategy-desk-scenario-not-object");
  const scenarioId = readString(value.scenarioId);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const ownerUserId = readString(value.ownerUserId);
  const strategyKey = readString(value.strategyKey);
  const thesis = readString(value.thesis);
  const state = readString(value.state);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  if (
    !scenarioId ||
    !title ||
    !summary ||
    !ownerUserId ||
    !strategyKey ||
    !thesis ||
    !state ||
    !createdAt ||
    !updatedAt
  ) {
    return fail("strategy-desk-scenario-invalid");
  }

  if (!Array.isArray(value.legs) || value.legs.length === 0) {
    return fail("strategy-desk-scenario-legs-invalid");
  }
  const parsedLegs = value.legs.map((entry) => safeParseScenarioLeg(entry));
  if (parsedLegs.some((parsed) => !parsed.success)) {
    return fail("strategy-desk-scenario-legs-invalid");
  }
  const legs = parsedLegs.map(
    (parsed) => (parsed as ParseSuccess<RuntimeStrategyDeskScenarioLeg>).data,
  );

  return {
    success: true,
    data: {
      scenarioId,
      schemaVersion: readOptionalString(value.schemaVersion),
      title,
      summary,
      ownerUserId,
      strategyKey,
      thesis,
      sleeveId: readOptionalString(value.sleeveId),
      state,
      createdAt,
      updatedAt,
      reviewedAt: readOptionalString(value.reviewedAt),
      activeHandoffId: readOptionalString(value.activeHandoffId),
      latestReportId: readOptionalString(value.latestReportId),
      riskLimits: isRecord(value.riskLimits) ? value.riskLimits : undefined,
      researchMatrix: isRecord(value.researchMatrix)
        ? value.researchMatrix
        : undefined,
      legs,
      evidence: readRecordArray(value.evidence),
      implementationReferences: readRecordArray(value.implementationReferences),
      tags: readStringArray(value.tags),
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
    },
  };
}

export function safeParseRuntimeStrategyDeskScenarioRun(
  value: unknown,
): ParseResult<RuntimeStrategyDeskScenarioRun> {
  if (!isRecord(value)) return fail("strategy-desk-run-not-object");
  const trigger = isRecord(value.trigger) ? value.trigger : null;
  const scenarioRunId = readString(value.scenarioRunId);
  const scenarioId = readString(value.scenarioId);
  const scenarioState = readString(value.scenarioState);
  const runKind = readString(value.runKind);
  const state = readString(value.state);
  const requestedBy = readString(value.requestedBy);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  if (
    !trigger ||
    !scenarioRunId ||
    !scenarioId ||
    !scenarioState ||
    !runKind ||
    !state ||
    !requestedBy ||
    !createdAt ||
    !updatedAt
  ) {
    return fail("strategy-desk-run-invalid");
  }

  return {
    success: true,
    data: {
      scenarioRunId,
      schemaVersion: readOptionalString(value.schemaVersion),
      scenarioId,
      scenarioState,
      runKind,
      state,
      requestedBy,
      trigger,
      createdAt,
      updatedAt,
      startedAt: readOptionalString(value.startedAt),
      completedAt: readOptionalString(value.completedAt),
      legRuns: readRecordArray(value.legRuns),
      failureCode: readOptionalString(value.failureCode),
      failureMessage: readOptionalString(value.failureMessage),
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
    },
  };
}

export function safeParseRuntimeStrategyDeskScenarioReport(
  value: unknown,
): ParseResult<RuntimeStrategyDeskScenarioReport> {
  if (!isRecord(value)) return fail("strategy-desk-report-not-object");
  const reportId = readString(value.reportId);
  const scenarioId = readString(value.scenarioId);
  const scenarioRunId = readString(value.scenarioRunId);
  const stage = readString(value.stage);
  const status = readString(value.status);
  const summary = readString(value.summary);
  const generatedAt = readString(value.generatedAt);
  if (
    !reportId ||
    !scenarioId ||
    !scenarioRunId ||
    !stage ||
    !status ||
    !summary ||
    !generatedAt
  ) {
    return fail("strategy-desk-report-invalid");
  }

  return {
    success: true,
    data: {
      reportId,
      schemaVersion: readOptionalString(value.schemaVersion),
      scenarioId,
      scenarioRunId,
      stage,
      status,
      summary,
      generatedAt,
      legOutcomes: readRecordArray(value.legOutcomes),
      portfolioSummary: isRecord(value.portfolioSummary)
        ? value.portfolioSummary
        : undefined,
      scorecard: isRecord(value.scorecard) ? value.scorecard : undefined,
      riskOverlays: readRecordArray(value.riskOverlays),
      studyMatrix: isRecord(value.studyMatrix) ? value.studyMatrix : undefined,
      evidence: readRecordArray(value.evidence),
      checks: readRecordArray(value.checks),
      approvals: readRecordArray(value.approvals),
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
    },
  };
}
