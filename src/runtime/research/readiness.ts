import {
  parseRuntimeStrategyLabReadinessArtifact,
  parseRuntimeStrategyLabReadinessCanaryRun,
  parseRuntimeStrategyLabSubjectControl,
  type RuntimeAssetRecord,
  type RuntimeBacktestReport,
  type RuntimeExecutionCostModelRecord,
  type RuntimeExecutionCostObservationRecord,
  type RuntimeFeatureDefinitionRecord,
  type RuntimeHistoricalDatasetSnapshotRecord,
  type RuntimeStrategyLabCheck,
  type RuntimeStrategyLabEvidenceRef,
  type RuntimeStrategyLabPromotionStatus,
  type RuntimeStrategyLabReadinessArtifact,
  type RuntimeStrategyLabReadinessCanaryRun,
  type RuntimeStrategyLabSubjectControl,
  type RuntimeVenueCapability,
} from "../contracts/autonomous_runtime.js";
import {
  getRuntimeVenueCapability,
  runtimeVenueSupportsAdapter,
  runtimeVenueSupportsMode,
} from "../venues/catalog.js";

type RuntimeResearchReadinessTargetState =
  RuntimeStrategyLabReadinessArtifact["targetState"];

type RuntimeResearchSubjectControlPatch = {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  liveAllowed?: boolean;
  killSwitchEnabled?: boolean;
  disabledReason?: string | null;
  updatedBy?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeResearchReadinessRequest = {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  targetState: RuntimeResearchReadinessTargetState;
  requestedBy: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  adapterKey?: string;
  canaryRunId?: string;
  evidenceRefs?: RuntimeStrategyLabEvidenceRef[];
  metadata?: Record<string, unknown>;
  venueCapability?: RuntimeVenueCapability | null;
  assetRecord?: RuntimeAssetRecord | null;
  datasetSnapshots?: RuntimeHistoricalDatasetSnapshotRecord[];
  featureDefinitions?: RuntimeFeatureDefinitionRecord[];
  costModels?: RuntimeExecutionCostModelRecord[];
  costObservations?: RuntimeExecutionCostObservationRecord[];
  backtests?: RuntimeBacktestReport[];
  controls?: {
    venue?: RuntimeStrategyLabSubjectControl;
    asset?: RuntimeStrategyLabSubjectControl;
  };
  canaryRun?: RuntimeStrategyLabReadinessCanaryRun | null;
};

export type RuntimeResearchReadinessCanaryRequest = {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  requestedBy: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  adapterKey?: string;
  triggerSource?: "manual" | "promotion";
  targetNotionalUsd?: string;
  proofMode?: "readiness_canary" | "venue_tx_smoke";
  tightenOnFailure?: boolean;
  failureControlMode?: "disable_live" | "engage_kill_switch";
  killDrillNotes?: string[];
  metadata?: Record<string, unknown>;
};

type ReadinessContext = {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  venueKey: string;
  assetKey: string;
  pairSymbol: string;
  adapterKey: string | null;
  venueCapability: RuntimeVenueCapability | null;
  assetRecord: RuntimeAssetRecord | null;
  assetVenueMapping: RuntimeAssetRecord["venueMappings"][number] | null;
  datasetSnapshots: RuntimeHistoricalDatasetSnapshotRecord[];
  featureDefinitions: RuntimeFeatureDefinitionRecord[];
  costModels: RuntimeExecutionCostModelRecord[];
  costObservations: RuntimeExecutionCostObservationRecord[];
  backtests: RuntimeBacktestReport[];
  venueControl: RuntimeStrategyLabSubjectControl | null;
  assetControl: RuntimeStrategyLabSubjectControl | null;
  canaryRun: RuntimeStrategyLabReadinessCanaryRun | null;
  requestedBy: string;
  targetState: RuntimeResearchReadinessTargetState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`missing-${field}`);
  }
  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => readOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readStatus(
  checks: RuntimeStrategyLabCheck[],
): RuntimeStrategyLabPromotionStatus {
  if (checks.some((check) => check.status === "blocked")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "requires_human_approval")) {
    return "requires_human_approval";
  }
  return "pass";
}

function check(
  checkId: string,
  status: RuntimeStrategyLabCheck["status"],
  message: string,
  observedValue?: string,
  thresholdValue?: string,
): RuntimeStrategyLabCheck {
  return {
    checkId,
    status,
    ...(observedValue ? { observedValue } : {}),
    ...(thresholdValue ? { thresholdValue } : {}),
    message,
  };
}

function dedupeEvidenceRefs(
  refs: RuntimeStrategyLabEvidenceRef[],
): RuntimeStrategyLabEvidenceRef[] {
  const seen = new Set<string>();
  const unique: RuntimeStrategyLabEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function pushEvidenceRef(
  refs: RuntimeStrategyLabEvidenceRef[],
  ref: RuntimeStrategyLabEvidenceRef | null,
): void {
  if (ref) {
    refs.push(ref);
  }
}

function parseEvidenceRef(input: unknown): RuntimeStrategyLabEvidenceRef {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-evidence-ref");
  }
  return {
    kind: readRequiredString(input.kind, "evidenceRefs.kind"),
    ref: readRequiredString(input.ref, "evidenceRefs.ref"),
    ...(readOptionalString(input.notes)
      ? { notes: readOptionalString(input.notes) }
      : {}),
  };
}

function isPositiveNumericString(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function latestCostObservationWithinGuard(input: {
  costModels: RuntimeExecutionCostModelRecord[];
  costObservations: RuntimeExecutionCostObservationRecord[];
}): boolean {
  if (input.costModels.length === 0) {
    return false;
  }
  if (input.costObservations.length === 0) {
    return false;
  }

  return input.costModels.some((model) =>
    input.costObservations.some(
      (observation) =>
        observation.modelId === model.modelId &&
        observation.costDriftBps <= model.driftGuard.maxCostDriftBps &&
        observation.reconciliationStatus === "passed",
    ),
  );
}

function buildReadinessContext(
  request: RuntimeResearchReadinessRequest,
): ReadinessContext {
  const venueKey = request.venueKey ?? request.venueCapability?.venueKey ?? "";
  const assetKey = request.assetKey ?? request.assetRecord?.assetKey ?? "";
  const pairSymbol = request.pairSymbol ?? `${assetKey}/USDC`;
  const venueCapability =
    request.venueCapability ??
    (venueKey ? getRuntimeVenueCapability(venueKey) : null);
  const assetRecord = request.assetRecord ?? null;
  const assetVenueMapping =
    assetRecord?.venueMappings.find(
      (mapping) => mapping.venueKey === venueKey,
    ) ?? null;

  return {
    subjectKind: request.subjectKind,
    subjectKey: request.subjectKey,
    venueKey,
    assetKey,
    pairSymbol,
    adapterKey: request.adapterKey ?? null,
    venueCapability,
    assetRecord,
    assetVenueMapping,
    datasetSnapshots: request.datasetSnapshots ?? [],
    featureDefinitions: request.featureDefinitions ?? [],
    costModels: request.costModels ?? [],
    costObservations: request.costObservations ?? [],
    backtests: request.backtests ?? [],
    venueControl: request.controls?.venue ?? null,
    assetControl: request.controls?.asset ?? null,
    canaryRun: request.canaryRun ?? null,
    requestedBy: request.requestedBy,
    targetState: request.targetState,
  };
}

function summarizeReadiness(input: {
  subjectKind: "venue" | "asset";
  subjectKey: string;
  targetState: RuntimeResearchReadinessTargetState;
  status: RuntimeStrategyLabPromotionStatus;
  checks: RuntimeStrategyLabCheck[];
}): string {
  const passing = input.checks.filter(
    (check) => check.status === "pass",
  ).length;
  const total = input.checks.length;
  if (input.status === "pass") {
    return `${input.subjectKind}:${input.subjectKey} cleared ${input.targetState} readiness with ${passing}/${total} passing checks.`;
  }
  const blocked = input.checks
    .filter((check) => check.status !== "pass")
    .map((check) => check.checkId)
    .join(", ");
  return `${input.subjectKind}:${input.subjectKey} is not ready for ${input.targetState}; blocking checks: ${blocked || "unknown"}.`;
}

export function parseRuntimeResearchReadinessRequest(
  input: unknown,
): RuntimeResearchReadinessRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-readiness-request");
  }

  const subjectKind = readRequiredString(input.subjectKind, "subjectKind");
  const targetState = readRequiredString(input.targetState, "targetState");
  if (subjectKind !== "venue" && subjectKind !== "asset") {
    throw new Error("invalid-runtime-research-readiness-subject-kind");
  }
  if (
    targetState !== "limited_live_ready" &&
    targetState !== "broad_live_ready"
  ) {
    throw new Error("invalid-runtime-research-readiness-target-state");
  }

  return {
    subjectKind,
    subjectKey: readRequiredString(input.subjectKey, "subjectKey"),
    targetState,
    requestedBy: readRequiredString(input.requestedBy, "requestedBy"),
    ...(readOptionalString(input.venueKey)
      ? { venueKey: readOptionalString(input.venueKey) }
      : {}),
    ...(readOptionalString(input.assetKey)
      ? { assetKey: readOptionalString(input.assetKey) }
      : {}),
    ...(readOptionalString(input.pairSymbol)
      ? { pairSymbol: readOptionalString(input.pairSymbol) }
      : {}),
    ...(readOptionalString(input.adapterKey)
      ? { adapterKey: readOptionalString(input.adapterKey) }
      : {}),
    ...(readOptionalString(input.canaryRunId)
      ? { canaryRunId: readOptionalString(input.canaryRunId) }
      : {}),
    ...(Array.isArray(input.evidenceRefs)
      ? { evidenceRefs: input.evidenceRefs.map(parseEvidenceRef) }
      : {}),
    ...(isRecord(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  };
}

export function parseRuntimeResearchReadinessCanaryRequest(
  input: unknown,
): RuntimeResearchReadinessCanaryRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-readiness-canary-request");
  }

  const subjectKind = readRequiredString(input.subjectKind, "subjectKind");
  if (subjectKind !== "venue" && subjectKind !== "asset") {
    throw new Error("invalid-runtime-research-readiness-canary-subject-kind");
  }

  const triggerSourceValue = readOptionalString(input.triggerSource);
  if (
    triggerSourceValue &&
    triggerSourceValue !== "manual" &&
    triggerSourceValue !== "promotion"
  ) {
    throw new Error("invalid-runtime-research-readiness-canary-trigger");
  }
  const triggerSource =
    triggerSourceValue === "manual" || triggerSourceValue === "promotion"
      ? triggerSourceValue
      : undefined;
  const proofModeValue = readOptionalString(input.proofMode);
  if (
    proofModeValue &&
    proofModeValue !== "readiness_canary" &&
    proofModeValue !== "venue_tx_smoke"
  ) {
    throw new Error("invalid-runtime-research-readiness-canary-proof-mode");
  }
  const failureControlModeValue = readOptionalString(input.failureControlMode);
  if (
    failureControlModeValue &&
    failureControlModeValue !== "disable_live" &&
    failureControlModeValue !== "engage_kill_switch"
  ) {
    throw new Error(
      "invalid-runtime-research-readiness-canary-failure-control-mode",
    );
  }
  const proofMode =
    proofModeValue === "readiness_canary" || proofModeValue === "venue_tx_smoke"
      ? proofModeValue
      : undefined;
  const failureControlMode =
    failureControlModeValue === "disable_live" ||
    failureControlModeValue === "engage_kill_switch"
      ? failureControlModeValue
      : undefined;

  return {
    subjectKind,
    subjectKey: readRequiredString(input.subjectKey, "subjectKey"),
    requestedBy: readRequiredString(input.requestedBy, "requestedBy"),
    ...(readOptionalString(input.venueKey)
      ? { venueKey: readOptionalString(input.venueKey) }
      : {}),
    ...(readOptionalString(input.assetKey)
      ? { assetKey: readOptionalString(input.assetKey) }
      : {}),
    ...(readOptionalString(input.pairSymbol)
      ? { pairSymbol: readOptionalString(input.pairSymbol) }
      : {}),
    ...(readOptionalString(input.adapterKey)
      ? { adapterKey: readOptionalString(input.adapterKey) }
      : {}),
    ...(triggerSource ? { triggerSource } : {}),
    ...(readOptionalString(input.targetNotionalUsd)
      ? { targetNotionalUsd: readOptionalString(input.targetNotionalUsd) }
      : {}),
    ...(proofMode ? { proofMode } : {}),
    ...(readOptionalBoolean(input.tightenOnFailure) !== undefined
      ? { tightenOnFailure: readOptionalBoolean(input.tightenOnFailure) }
      : {}),
    ...(failureControlMode ? { failureControlMode } : {}),
    ...(readStringArray(input.killDrillNotes)
      ? { killDrillNotes: readStringArray(input.killDrillNotes) }
      : {}),
    ...(isRecord(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  };
}

export function parseRuntimeResearchVenueTxSmokeRequest(
  input: unknown,
): RuntimeResearchReadinessCanaryRequest {
  const request = parseRuntimeResearchReadinessCanaryRequest(input);
  if (request.subjectKind !== "venue") {
    throw new Error("invalid-runtime-research-venue-tx-smoke-subject-kind");
  }

  return {
    ...request,
    proofMode: "venue_tx_smoke",
    triggerSource: request.triggerSource ?? "manual",
    tightenOnFailure: request.tightenOnFailure ?? true,
    failureControlMode: request.failureControlMode ?? "disable_live",
  };
}

export function parseRuntimeResearchSubjectControlPatch(
  input: unknown,
): RuntimeResearchSubjectControlPatch {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-subject-control");
  }

  const subjectKind = readRequiredString(input.subjectKind, "subjectKind");
  if (subjectKind !== "venue" && subjectKind !== "asset") {
    throw new Error("invalid-runtime-strategy-lab-subject-control-kind");
  }

  return {
    subjectKind,
    subjectKey: readRequiredString(input.subjectKey, "subjectKey"),
    ...(readOptionalBoolean(input.liveAllowed) !== undefined
      ? { liveAllowed: readOptionalBoolean(input.liveAllowed) }
      : {}),
    ...(readOptionalBoolean(input.killSwitchEnabled) !== undefined
      ? { killSwitchEnabled: readOptionalBoolean(input.killSwitchEnabled) }
      : {}),
    ...(input.disabledReason === null ||
    typeof input.disabledReason === "string"
      ? { disabledReason: input.disabledReason ?? null }
      : {}),
    ...(readOptionalString(input.updatedBy)
      ? { updatedBy: readOptionalString(input.updatedBy) }
      : {}),
    ...(isRecord(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  };
}

export function buildRuntimeStrategyLabSubjectControlRecord(input: {
  patch: RuntimeResearchSubjectControlPatch;
  existing?: RuntimeStrategyLabSubjectControl | null;
  updatedAt?: string;
}): RuntimeStrategyLabSubjectControl {
  const nowIso = input.updatedAt ?? new Date().toISOString();
  const existing = input.existing ?? null;
  return parseRuntimeStrategyLabSubjectControl({
    schemaVersion: "v1",
    subjectKind: input.patch.subjectKind,
    subjectKey: input.patch.subjectKey,
    liveAllowed: input.patch.liveAllowed ?? existing?.liveAllowed ?? false,
    killSwitchEnabled:
      input.patch.killSwitchEnabled ?? existing?.killSwitchEnabled ?? false,
    ...(input.patch.disabledReason !== undefined
      ? input.patch.disabledReason
        ? { disabledReason: input.patch.disabledReason }
        : {}
      : existing?.disabledReason
        ? { disabledReason: existing.disabledReason }
        : {}),
    updatedAt: nowIso,
    ...(input.patch.updatedBy
      ? { updatedBy: input.patch.updatedBy }
      : existing?.updatedBy
        ? { updatedBy: existing.updatedBy }
        : {}),
    ...(input.patch.metadata
      ? { metadata: input.patch.metadata }
      : existing?.metadata
        ? { metadata: existing.metadata }
        : {}),
  });
}

export function buildRuntimeResearchReadiness(input: {
  request: RuntimeResearchReadinessRequest;
}): RuntimeStrategyLabReadinessArtifact {
  const nowIso = new Date().toISOString();
  const request = input.request;
  const context = buildReadinessContext(request);
  const checks: RuntimeStrategyLabCheck[] = [];
  const evidenceRefs: RuntimeStrategyLabEvidenceRef[] = [
    ...(request.evidenceRefs ?? []),
  ];

  const liveSupported = Boolean(
    context.venueCapability &&
      runtimeVenueSupportsMode(context.venueCapability, "live"),
  );
  const adapterSupported = Boolean(
    context.venueCapability &&
      context.adapterKey &&
      runtimeVenueSupportsAdapter(context.venueCapability, context.adapterKey),
  );
  const hasDatasetCoverage = context.datasetSnapshots.length > 0;
  const hasFeatureCoverage = context.featureDefinitions.length > 0;
  const hasMinSizeRules = Boolean(
    context.assetVenueMapping
      ? isPositiveNumericString(context.assetVenueMapping.minNotionalUsd)
      : context.venueCapability
        ? isPositiveNumericString(
            context.venueCapability.sizeLimits.minNotionalUsd,
          ) ||
          isPositiveNumericString(
            context.venueCapability.precision.minQuoteNotionalUsd,
          )
        : false,
  );
  const feeModelHealthy = latestCostObservationWithinGuard({
    costModels: context.costModels,
    costObservations: context.costObservations,
  });
  const paperValidated = context.backtests.some(
    (report) => report.status === "completed" && report.promotionEligible,
  );
  const requiredControls = [
    context.venueControl,
    ...(context.subjectKind === "asset" ? [context.assetControl] : []),
  ].filter(
    (value): value is RuntimeStrategyLabSubjectControl => value !== null,
  );
  const controlsPresent =
    context.subjectKind === "asset"
      ? Boolean(context.venueControl && context.assetControl)
      : Boolean(context.venueControl);
  const killSwitchClear = requiredControls.every(
    (control) => !control.killSwitchEnabled,
  );
  const broadLiveAllowed =
    context.targetState !== "broad_live_ready" ||
    requiredControls.every((control) => control.liveAllowed);

  checks.push(
    check(
      "capability-coverage",
      liveSupported && (context.adapterKey ? adapterSupported : true)
        ? "pass"
        : "blocked",
      liveSupported
        ? context.adapterKey && !adapterSupported
          ? "The requested adapter is not registered for the venue live path."
          : "Venue capability covers bounded live execution."
        : "Venue capability does not currently support bounded live execution.",
      context.venueCapability
        ? `${context.venueCapability.venueKey}:${context.venueCapability.supportedModes.join(",")}`
        : "missing",
      "live support",
    ),
  );
  checks.push(
    check(
      "data-quality",
      hasDatasetCoverage && hasFeatureCoverage ? "pass" : "blocked",
      hasDatasetCoverage && hasFeatureCoverage
        ? "Historical dataset and feature coverage are available for readiness review."
        : "Historical dataset or feature coverage is missing for this venue or asset path.",
      `datasets=${context.datasetSnapshots.length},features=${context.featureDefinitions.length}`,
      "datasets>0,features>0",
    ),
  );
  checks.push(
    check(
      "min-size-rules",
      hasMinSizeRules ? "pass" : "blocked",
      hasMinSizeRules
        ? "Venue precision and minimum notional rules are defined."
        : "Minimum notional or precision rules are missing for the venue or asset mapping.",
      context.assetVenueMapping?.minNotionalUsd ??
        context.venueCapability?.sizeLimits.minNotionalUsd ??
        context.venueCapability?.precision.minQuoteNotionalUsd ??
        "missing",
      "> 0",
    ),
  );
  checks.push(
    check(
      "fee-sanity",
      feeModelHealthy ? "pass" : "blocked",
      feeModelHealthy
        ? "Active cost models and observed drift stay within the configured guardrail."
        : "Cost-model coverage is missing or observed cost drift is outside the configured guardrail.",
      `models=${context.costModels.length},observations=${context.costObservations.length}`,
      "healthy cost model + drift guard",
    ),
  );
  checks.push(
    check(
      "paper-validation",
      paperValidated ? "pass" : "blocked",
      paperValidated
        ? "Relevant paper or backtest evidence exists for this venue or asset path."
        : "Paper or backtest validation evidence is missing for this venue or asset path.",
      `backtests=${context.backtests.length}`,
      "completed + promotionEligible",
    ),
  );
  checks.push(
    check(
      "control-posture",
      controlsPresent && killSwitchClear && broadLiveAllowed
        ? "pass"
        : "blocked",
      controlsPresent
        ? !killSwitchClear
          ? "A subject kill switch is enabled, so the readiness path is fail-closed."
          : !broadLiveAllowed
            ? "Broad live readiness requires explicit allowlist enablement on all related controls."
            : "Per-subject controls are present and allow the readiness path to proceed."
        : "Explicit subject controls are required before a venue or asset can be promoted.",
      controlsPresent
        ? requiredControls
            .map(
              (control) =>
                `${control.subjectKind}:${control.subjectKey}:live=${control.liveAllowed ? "1" : "0"}:kill=${control.killSwitchEnabled ? "1" : "0"}`,
            )
            .join(",")
        : "missing",
      context.targetState === "broad_live_ready"
        ? "controls present, kill switch clear, live allowed"
        : "controls present, kill switch clear",
    ),
  );

  if (context.targetState === "limited_live_ready") {
    checks.push(
      check(
        "bounded-canary-plan",
        liveSupported && Boolean(context.adapterKey) ? "pass" : "blocked",
        liveSupported && context.adapterKey
          ? "A bounded live canary can be executed with the resolved venue, pair, and adapter."
          : "A bounded live canary cannot be planned because the venue live path is incomplete.",
        context.adapterKey
          ? `${context.pairSymbol}:${context.adapterKey}`
          : context.pairSymbol,
        "pair + adapter",
      ),
    );
  }

  if (context.targetState === "broad_live_ready") {
    const canaryPassed =
      context.canaryRun?.status === "success" &&
      context.canaryRun.reconciliation?.status === "passed";
    checks.push(
      check(
        "limited-live-canary",
        canaryPassed ? "pass" : "blocked",
        canaryPassed
          ? "A bounded live canary succeeded and reconciled for this venue or asset path."
          : "Broad live readiness requires a successful bounded live canary with passing reconciliation.",
        context.canaryRun
          ? `${context.canaryRun.runId}:${context.canaryRun.status}`
          : "missing",
        "success + reconciliation passed",
      ),
    );
  }

  pushEvidenceRef(
    evidenceRefs,
    context.datasetSnapshots[0]
      ? {
          kind: "data_quality_snapshot",
          ref: `dataset:${context.datasetSnapshots[0].snapshotId}`,
          notes: context.datasetSnapshots[0].datasetId,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    context.costModels[0]
      ? {
          kind: "cost_model_coverage",
          ref: `cost-model:${context.costModels[0].modelId}`,
          notes: context.costModels[0].venueKey,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    context.backtests[0]
      ? {
          kind: "paper_lifecycle_coverage",
          ref: `backtest:${context.backtests[0].reportId}`,
          notes: context.backtests[0].summary,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    controlsPresent
      ? {
          kind: "allowlist_change",
          ref: `subject-control:${context.subjectKind}:${context.subjectKey}`,
          notes:
            context.targetState === "broad_live_ready"
              ? "Controls verified for broader live readiness."
              : "Controls staged for bounded live readiness.",
        }
      : null,
  );
  if (context.targetState === "limited_live_ready") {
    pushEvidenceRef(
      evidenceRefs,
      context.adapterKey
        ? {
            kind: "bounded_canary_plan",
            ref: `canary-plan:${context.venueKey}:${context.pairSymbol}:${context.adapterKey}`,
            notes: `subject=${context.subjectKind}:${context.subjectKey}`,
          }
        : null,
    );
  }
  if (context.canaryRun?.status === "success") {
    pushEvidenceRef(evidenceRefs, {
      kind: "live_canary",
      ref: `readiness-canary:${context.canaryRun.runId}`,
      notes: context.canaryRun.signature ?? context.canaryRun.status,
    });
  }

  const status = readStatus(checks);
  const summary = summarizeReadiness({
    subjectKind: context.subjectKind,
    subjectKey: context.subjectKey,
    targetState: context.targetState,
    status,
    checks,
  });

  return parseRuntimeStrategyLabReadinessArtifact({
    schemaVersion: "v1",
    readinessId: `readiness_${crypto.randomUUID().replace(/-/g, "")}`,
    subjectKind: context.subjectKind,
    subjectKey: context.subjectKey,
    targetState: context.targetState,
    status,
    summary,
    venueKey: context.venueKey,
    assetKey: context.assetKey,
    ...(context.canaryRun?.runId
      ? { canaryRunId: context.canaryRun.runId }
      : {}),
    checks,
    evidenceRefs: dedupeEvidenceRefs(evidenceRefs),
    controls: {
      ...(context.venueControl ? { venue: context.venueControl } : {}),
      ...(context.assetControl ? { asset: context.assetControl } : {}),
    },
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: {
      requestedBy: context.requestedBy,
      pairSymbol: context.pairSymbol,
      ...(context.adapterKey ? { adapterKey: context.adapterKey } : {}),
      ...(request.metadata ? { requestMetadata: request.metadata } : {}),
    },
  });
}

export function buildRuntimeResearchReadinessMarkdown(
  readiness: RuntimeStrategyLabReadinessArtifact,
): string {
  const lines = [
    `# Strategy-lab readiness for ${readiness.subjectKind}:${readiness.subjectKey}`,
    "",
    `- Readiness id: ${readiness.readinessId}`,
    `- Target state: ${readiness.targetState}`,
    `- Status: ${readiness.status}`,
    `- Venue: ${readiness.venueKey ?? "n/a"}`,
    `- Asset: ${readiness.assetKey ?? "n/a"}`,
    `- Summary: ${readiness.summary}`,
    `- Updated at: ${readiness.updatedAt}`,
  ];

  if (readiness.canaryRunId) {
    lines.push(`- Canary run: ${readiness.canaryRunId}`);
  }

  lines.push("", "## Checks", "");
  for (const readinessCheck of readiness.checks) {
    const observed = readinessCheck.observedValue
      ? ` observed=${readinessCheck.observedValue}`
      : "";
    const threshold = readinessCheck.thresholdValue
      ? ` threshold=${readinessCheck.thresholdValue}`
      : "";
    lines.push(
      `- ${readinessCheck.checkId}: ${readinessCheck.status}${observed}${threshold} (${readinessCheck.message})`,
    );
  }

  lines.push("", "## Evidence", "");
  if (readiness.evidenceRefs.length === 0) {
    lines.push("- none");
  } else {
    for (const ref of readiness.evidenceRefs) {
      lines.push(`- ${ref.kind}: ${ref.ref}`);
    }
  }

  return lines.join("\n");
}

export function buildRuntimeResearchReadinessCanaryMarkdown(
  canaryRun: RuntimeStrategyLabReadinessCanaryRun,
): string {
  const metadata = isRecord(canaryRun.metadata) ? canaryRun.metadata : null;
  const proofMode = readOptionalString(metadata?.proofMode);
  const failureControl = isRecord(metadata?.smokeFailureControl)
    ? metadata.smokeFailureControl
    : null;
  const submissionPath = isRecord(metadata?.submissionPath)
    ? metadata.submissionPath
    : null;
  const killDrillNotes = readStringArray(metadata?.killDrillNotes) ?? [];
  const lines = [
    proofMode === "venue_tx_smoke"
      ? `# Venue TX smoke for ${canaryRun.subjectKind}:${canaryRun.subjectKey}`
      : `# Strategy-lab readiness canary for ${canaryRun.subjectKind}:${canaryRun.subjectKey}`,
    "",
    `- Run id: ${canaryRun.runId}`,
    `- Status: ${canaryRun.status}`,
    `- Venue: ${canaryRun.venueKey}`,
    `- Asset: ${canaryRun.assetKey}`,
    `- Pair: ${canaryRun.pairSymbol}`,
    `- Adapter: ${canaryRun.adapterKey}`,
    `- Trigger source: ${canaryRun.triggerSource}`,
    `- Target notional: ${canaryRun.targetNotionalUsd} USD`,
    `- Started at: ${canaryRun.startedAt}`,
  ];

  if (canaryRun.completedAt) {
    lines.push(`- Completed at: ${canaryRun.completedAt}`);
  }
  if (canaryRun.signature) {
    lines.push(`- Signature: ${canaryRun.signature}`);
  }
  if (canaryRun.errorCode) {
    lines.push(`- Error code: ${canaryRun.errorCode}`);
  }
  if (canaryRun.errorMessage) {
    lines.push(`- Error: ${canaryRun.errorMessage}`);
  }
  if (submissionPath) {
    lines.push(
      `- Submission path: ${readOptionalString(submissionPath.adapter) ?? "unknown adapter"} on ${readOptionalString(submissionPath.lane) ?? "unknown lane"}`,
    );
  }

  lines.push("", "## Evidence", "");
  if (canaryRun.evidenceRefs.length === 0) {
    lines.push("- none");
  } else {
    for (const ref of canaryRun.evidenceRefs) {
      lines.push(`- ${ref.kind}: ${ref.ref}`);
    }
  }

  if (canaryRun.reconciliation) {
    lines.push("", "## Reconciliation", "");
    lines.push(`- Status: ${canaryRun.reconciliation.status}`);
    if (canaryRun.reconciliation.actualOutputAtomic) {
      lines.push(
        `- Actual output atomic: ${canaryRun.reconciliation.actualOutputAtomic}`,
      );
    }
    if (canaryRun.reconciliation.minExpectedOutAtomic) {
      lines.push(
        `- Minimum expected out atomic: ${canaryRun.reconciliation.minExpectedOutAtomic}`,
      );
    }
    for (const note of canaryRun.reconciliation.notes ?? []) {
      lines.push(`- Note: ${note}`);
    }
  }

  if (proofMode === "venue_tx_smoke" && killDrillNotes.length > 0) {
    lines.push("", "## Kill Drill Notes", "");
    for (const note of killDrillNotes) {
      lines.push(`- ${note}`);
    }
  }

  if (proofMode === "venue_tx_smoke" && failureControl) {
    lines.push("", "## Failure Control", "");
    lines.push(
      `- Applied: ${String(failureControl.applied ?? false)}`,
      `- Mode: ${readOptionalString(failureControl.mode) ?? "n/a"}`,
      `- Live allowed: ${String(failureControl.liveAllowed ?? "n/a")}`,
      `- Kill switch enabled: ${String(failureControl.killSwitchEnabled ?? "n/a")}`,
    );
    if (readOptionalString(failureControl.disabledReason)) {
      lines.push(
        `- Disabled reason: ${readOptionalString(failureControl.disabledReason)}`,
      );
    }
  }

  return lines.join("\n");
}

export function parseRuntimeResearchReadinessCanaryRun(
  input: unknown,
): RuntimeStrategyLabReadinessCanaryRun {
  return parseRuntimeStrategyLabReadinessCanaryRun(input);
}
