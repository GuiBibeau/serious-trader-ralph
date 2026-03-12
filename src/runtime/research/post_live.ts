import { createHash } from "node:crypto";
import {
  parseRuntimeStrategyLabPostLiveArtifact,
  type RuntimeAssetRecord,
  type RuntimeExecutionCostModelRecord,
  type RuntimeExecutionCostObservationRecord,
  type RuntimeStrategyLabCheck,
  type RuntimeStrategyLabEvidenceRef,
  type RuntimeStrategyLabPostLiveAction,
  type RuntimeStrategyLabPostLiveArtifact,
  type RuntimeStrategyLabPromotionState,
  type RuntimeStrategyLabPromotionStatus,
  type RuntimeStrategyLabReadinessArtifact,
  type RuntimeStrategyLabReadinessCanaryRun,
  type RuntimeStrategyLabSubjectControl,
  type RuntimeStrategyLabSubjectKind,
} from "../contracts/autonomous_runtime.js";

const PROMOTION_STATES: RuntimeStrategyLabPromotionState[] = [
  "candidate",
  "draft",
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
  "paused",
  "deprecated",
];

type RuntimeResearchPostLiveThresholds = {
  minTotalPnlUsd?: string;
  maxDrawdownUsd?: string;
  maxFailedRunRateBps?: number;
  maxManualReviewRateBps?: number;
  maxDriftAlertCount?: number;
  maxCostDriftBps?: number;
  maxLatencyDriftMs?: number;
  maxFeatureAgeMs?: number;
};

export type RuntimeResearchPostLiveRequest = {
  subjectKind: RuntimeStrategyLabSubjectKind;
  subjectKey: string;
  requestedBy: string;
  issueNumber?: number;
  currentState?: RuntimeStrategyLabPromotionState;
  deploymentId?: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  refreshEvaluation?: boolean;
  applyAction?: boolean;
  thresholds?: RuntimeResearchPostLiveThresholds;
  externalChecks?: RuntimeStrategyLabCheck[];
  evidenceRefs?: RuntimeStrategyLabEvidenceRef[];
  metadata?: Record<string, unknown>;
};

export type RuntimeResearchPostLiveScorecardSnapshot = {
  deploymentId: string;
  failedRunCount: number;
  manualReviewRunCount: number;
  driftAlertCount: number;
  totalPnlUsd?: string;
  maxDrawdownUsd?: string;
  costDriftBps?: number;
  latencyDriftMs?: number;
  maxObservedFeatureAgeMs?: number;
  freshnessSloMs?: number;
  featureDefinitionCoverageBps?: number;
  regimeTagCoverageBps?: number;
  missingFeatureKeys: string[];
  missingRegimeKeys: string[];
};

export type RuntimeResearchPostLiveContext = {
  currentState?: RuntimeStrategyLabPromotionState;
  scorecard?: RuntimeResearchPostLiveScorecardSnapshot | null;
  latestCostModel?: RuntimeExecutionCostModelRecord | null;
  latestCostObservation?: RuntimeExecutionCostObservationRecord | null;
  latestReadinessArtifact?: RuntimeStrategyLabReadinessArtifact | null;
  latestCanaryRun?: RuntimeStrategyLabReadinessCanaryRun | null;
  venueControl?: RuntimeStrategyLabSubjectControl | null;
  assetControl?: RuntimeStrategyLabSubjectControl | null;
  assetRecord?: RuntimeAssetRecord | null;
  linkedPromotionId?: string | null;
  linkedControlRef?: string | null;
};

type RuntimeResearchPostLiveRecommendation = {
  action: RuntimeStrategyLabPostLiveAction;
  targetState?: RuntimeStrategyLabPromotionState;
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

function readOptionalPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function readOptionalPositiveNumberString(value: unknown): string | undefined {
  const normalized = readOptionalString(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("invalid-positive-number-string");
  }
  return normalized;
}

function readOptionalNumberString(value: unknown): string | undefined {
  const normalized = readOptionalString(value);
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error("invalid-number-string");
  }
  return normalized;
}

function parseCheck(input: unknown): RuntimeStrategyLabCheck {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-check");
  }
  const status = readRequiredString(input.status, "externalChecks.status");
  if (
    status !== "pass" &&
    status !== "blocked" &&
    status !== "requires_human_approval" &&
    status !== "not_applicable"
  ) {
    throw new Error("invalid-runtime-strategy-lab-check-status");
  }
  return {
    checkId: readRequiredString(input.checkId, "externalChecks.checkId"),
    status,
    ...(readOptionalString(input.observedValue)
      ? { observedValue: readOptionalString(input.observedValue) }
      : {}),
    ...(readOptionalString(input.thresholdValue)
      ? { thresholdValue: readOptionalString(input.thresholdValue) }
      : {}),
    message: readRequiredString(input.message, "externalChecks.message"),
  };
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

export function parseRuntimeResearchPostLiveRequest(
  input: unknown,
): RuntimeResearchPostLiveRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-post-live-request");
  }

  const subjectKind = readRequiredString(input.subjectKind, "subjectKind");
  if (
    subjectKind !== "strategy" &&
    subjectKind !== "venue" &&
    subjectKind !== "asset"
  ) {
    throw new Error("invalid-subjectKind");
  }

  const currentState = readOptionalString(input.currentState);
  if (currentState && !PROMOTION_STATES.includes(currentState as never)) {
    throw new Error("invalid-currentState");
  }

  const thresholds = isRecord(input.thresholds)
    ? {
        ...(readOptionalNumberString(input.thresholds.minTotalPnlUsd)
          ? {
              minTotalPnlUsd: readOptionalNumberString(
                input.thresholds.minTotalPnlUsd,
              ),
            }
          : {}),
        ...(readOptionalPositiveNumberString(input.thresholds.maxDrawdownUsd)
          ? {
              maxDrawdownUsd: readOptionalPositiveNumberString(
                input.thresholds.maxDrawdownUsd,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxFailedRunRateBps) !==
        undefined
          ? {
              maxFailedRunRateBps: readOptionalPositiveInt(
                input.thresholds.maxFailedRunRateBps,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxManualReviewRateBps) !==
        undefined
          ? {
              maxManualReviewRateBps: readOptionalPositiveInt(
                input.thresholds.maxManualReviewRateBps,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxDriftAlertCount) !==
        undefined
          ? {
              maxDriftAlertCount: readOptionalPositiveInt(
                input.thresholds.maxDriftAlertCount,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxCostDriftBps) !==
        undefined
          ? {
              maxCostDriftBps: readOptionalPositiveInt(
                input.thresholds.maxCostDriftBps,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxLatencyDriftMs) !==
        undefined
          ? {
              maxLatencyDriftMs: readOptionalPositiveInt(
                input.thresholds.maxLatencyDriftMs,
              ),
            }
          : {}),
        ...(readOptionalPositiveInt(input.thresholds.maxFeatureAgeMs) !==
        undefined
          ? {
              maxFeatureAgeMs: readOptionalPositiveInt(
                input.thresholds.maxFeatureAgeMs,
              ),
            }
          : {}),
      }
    : undefined;

  return {
    subjectKind,
    subjectKey: readRequiredString(input.subjectKey, "subjectKey"),
    requestedBy: readRequiredString(input.requestedBy, "requestedBy"),
    ...(typeof input.issueNumber === "number" &&
    Number.isInteger(input.issueNumber) &&
    input.issueNumber > 0
      ? { issueNumber: input.issueNumber }
      : {}),
    ...(currentState
      ? { currentState: currentState as RuntimeStrategyLabPromotionState }
      : {}),
    ...(readOptionalString(input.deploymentId)
      ? { deploymentId: readOptionalString(input.deploymentId) }
      : {}),
    ...(readOptionalString(input.venueKey)
      ? { venueKey: readOptionalString(input.venueKey) }
      : {}),
    ...(readOptionalString(input.assetKey)
      ? { assetKey: readOptionalString(input.assetKey) }
      : {}),
    ...(readOptionalString(input.pairSymbol)
      ? { pairSymbol: readOptionalString(input.pairSymbol) }
      : {}),
    ...(readOptionalBoolean(input.refreshEvaluation) !== undefined
      ? { refreshEvaluation: readOptionalBoolean(input.refreshEvaluation) }
      : {}),
    ...(readOptionalBoolean(input.applyAction) !== undefined
      ? { applyAction: readOptionalBoolean(input.applyAction) }
      : {}),
    ...(thresholds && Object.keys(thresholds).length > 0 ? { thresholds } : {}),
    ...(Array.isArray(input.externalChecks)
      ? { externalChecks: input.externalChecks.map(parseCheck) }
      : {}),
    ...(Array.isArray(input.evidenceRefs)
      ? { evidenceRefs: input.evidenceRefs.map(parseEvidenceRef) }
      : {}),
    ...(isRecord(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function statusFromChecks(
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

function pushEvidenceRef(
  refs: RuntimeStrategyLabEvidenceRef[],
  ref: RuntimeStrategyLabEvidenceRef | null,
): void {
  if (ref) {
    refs.push(ref);
  }
}

function dedupeEvidenceRefs(
  refs: RuntimeStrategyLabEvidenceRef[],
): RuntimeStrategyLabEvidenceRef[] {
  const seen = new Set<string>();
  const next: RuntimeStrategyLabEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(ref);
  }
  return next;
}

function liveAllowedCheck(
  subject: "venue" | "asset",
  control: RuntimeStrategyLabSubjectControl | null | undefined,
): RuntimeStrategyLabCheck {
  if (!control) {
    return check(
      `${subject}-control`,
      "requires_human_approval",
      `Explicit ${subject} control record is missing for post-live review.`,
      "missing",
      "live_allowed=true and kill_switch=false",
    );
  }
  const ok = control.liveAllowed && !control.killSwitchEnabled;
  return check(
    `${subject}-control`,
    ok ? "pass" : "blocked",
    ok
      ? `${subject} control permits bounded live execution.`
      : `${subject} control already blocks live execution or kill-switch is enabled.`,
    `liveAllowed=${String(control.liveAllowed)},killSwitchEnabled=${String(control.killSwitchEnabled)}`,
    "liveAllowed=true,killSwitchEnabled=false",
  );
}

function applyThresholdCheck(
  checks: RuntimeStrategyLabCheck[],
  input: {
    checkId: string;
    observed: number | null;
    threshold: number | undefined;
    messagePass: string;
    messageFail: string;
    formatter?: (value: number) => string;
  },
): void {
  const format = input.formatter ?? ((value: number) => String(value));
  if (input.threshold === undefined) {
    return;
  }
  if (input.observed === null) {
    checks.push(
      check(
        input.checkId,
        "requires_human_approval",
        `${input.messagePass} Missing observed value requires review.`,
        "missing",
        format(input.threshold),
      ),
    );
    return;
  }
  checks.push(
    check(
      input.checkId,
      input.observed <= input.threshold ? "pass" : "blocked",
      input.observed <= input.threshold ? input.messagePass : input.messageFail,
      format(input.observed),
      format(input.threshold),
    ),
  );
}

function buildStrategyChecks(input: {
  request: RuntimeResearchPostLiveRequest;
  context: RuntimeResearchPostLiveContext;
  checks: RuntimeStrategyLabCheck[];
}): void {
  const { request, context, checks } = input;
  const scorecard = context.scorecard;
  if (!request.deploymentId) {
    checks.push(
      check(
        "deployment-id",
        "blocked",
        "Strategy post-live review requires a deployment id.",
        "missing",
        "present",
      ),
    );
    return;
  }
  if (!scorecard) {
    checks.push(
      check(
        "scorecard",
        "blocked",
        "Strategy post-live review requires a runtime scorecard snapshot.",
        "missing",
        "present",
      ),
    );
    return;
  }

  const totalRuns =
    scorecard.failedRunCount + scorecard.manualReviewRunCount + 1;
  const failedRunRateBps = Math.round(
    (scorecard.failedRunCount * 10_000) / totalRuns,
  );
  const manualReviewRateBps = Math.round(
    (scorecard.manualReviewRunCount * 10_000) / totalRuns,
  );

  applyThresholdCheck(checks, {
    checkId: "strategy-failed-run-rate",
    observed: failedRunRateBps,
    threshold: request.thresholds?.maxFailedRunRateBps ?? 2_500,
    messagePass:
      "Live failed-run rate remains inside the bounded post-live budget.",
    messageFail: "Live failed-run rate exceeded the bounded post-live budget.",
    formatter: (value) => `${value}bps`,
  });
  applyThresholdCheck(checks, {
    checkId: "strategy-manual-review-rate",
    observed: manualReviewRateBps,
    threshold: request.thresholds?.maxManualReviewRateBps ?? 1_000,
    messagePass:
      "Manual-review rate remains inside the bounded post-live budget.",
    messageFail: "Manual-review rate exceeded the bounded post-live budget.",
    formatter: (value) => `${value}bps`,
  });
  applyThresholdCheck(checks, {
    checkId: "strategy-drift-alert-count",
    observed: scorecard.driftAlertCount,
    threshold: request.thresholds?.maxDriftAlertCount ?? 0,
    messagePass: "Drift alerts remain at or below the configured threshold.",
    messageFail: "Drift alerts exceeded the configured threshold.",
  });

  if (request.thresholds?.minTotalPnlUsd !== undefined) {
    const observedPnl = parseNumber(scorecard.totalPnlUsd);
    const thresholdPnl = Number(request.thresholds.minTotalPnlUsd);
    checks.push(
      check(
        "strategy-total-pnl-usd",
        observedPnl !== null && observedPnl >= thresholdPnl
          ? "pass"
          : observedPnl === null
            ? "requires_human_approval"
            : "blocked",
        observedPnl !== null && observedPnl >= thresholdPnl
          ? "Observed total PnL remains above the configured revalidation floor."
          : observedPnl === null
            ? "Observed total PnL is missing and requires review."
            : "Observed total PnL fell below the configured revalidation floor.",
        observedPnl !== null ? observedPnl.toFixed(2) : "missing",
        thresholdPnl.toFixed(2),
      ),
    );
  }
  applyThresholdCheck(checks, {
    checkId: "strategy-max-drawdown-usd",
    observed: parseNumber(scorecard.maxDrawdownUsd),
    threshold: request.thresholds?.maxDrawdownUsd
      ? Number(request.thresholds.maxDrawdownUsd)
      : undefined,
    messagePass: "Observed drawdown remains inside the configured budget.",
    messageFail: "Observed drawdown exceeded the configured budget.",
    formatter: (value) => value.toFixed(2),
  });

  const maxCostDriftBps = Math.min(
    request.thresholds?.maxCostDriftBps ?? Number.POSITIVE_INFINITY,
    context.latestCostModel?.driftGuard.maxCostDriftBps ??
      Number.POSITIVE_INFINITY,
  );
  if (Number.isFinite(maxCostDriftBps)) {
    applyThresholdCheck(checks, {
      checkId: "strategy-cost-drift-bps",
      observed: scorecard.costDriftBps ?? null,
      threshold: maxCostDriftBps,
      messagePass:
        "Observed live cost drift remains within the active model guard.",
      messageFail: "Observed live cost drift exceeded the active model guard.",
      formatter: (value) => `${value}bps`,
    });
  }

  const maxLatencyDriftMs = Math.min(
    request.thresholds?.maxLatencyDriftMs ?? Number.POSITIVE_INFINITY,
    context.latestCostModel?.driftGuard.maxLatencyDriftMs ??
      Number.POSITIVE_INFINITY,
  );
  if (Number.isFinite(maxLatencyDriftMs)) {
    applyThresholdCheck(checks, {
      checkId: "strategy-latency-drift-ms",
      observed: scorecard.latencyDriftMs ?? null,
      threshold: maxLatencyDriftMs,
      messagePass:
        "Observed live latency drift remains within the active model guard.",
      messageFail:
        "Observed live latency drift exceeded the active model guard.",
    });
  }

  const maxFeatureAgeMs =
    request.thresholds?.maxFeatureAgeMs ?? scorecard.freshnessSloMs;
  if (maxFeatureAgeMs !== undefined) {
    applyThresholdCheck(checks, {
      checkId: "strategy-feature-age-ms",
      observed: scorecard.maxObservedFeatureAgeMs ?? null,
      threshold: maxFeatureAgeMs,
      messagePass:
        "Feature freshness stays inside the configured post-live SLO.",
      messageFail: "Feature freshness exceeded the configured post-live SLO.",
    });
  }

  checks.push(
    check(
      "strategy-feature-coverage",
      scorecard.missingFeatureKeys.length === 0 &&
        scorecard.missingRegimeKeys.length === 0 &&
        (scorecard.featureDefinitionCoverageBps ?? 0) === 10_000 &&
        (scorecard.regimeTagCoverageBps ?? 0) === 10_000
        ? "pass"
        : "blocked",
      scorecard.missingFeatureKeys.length === 0 &&
        scorecard.missingRegimeKeys.length === 0 &&
        (scorecard.featureDefinitionCoverageBps ?? 0) === 10_000 &&
        (scorecard.regimeTagCoverageBps ?? 0) === 10_000
        ? "Feature and regime coverage remain complete for the live strategy."
        : "Feature or regime coverage regressed for the live strategy.",
      `missingFeatures=${scorecard.missingFeatureKeys.length},missingRegimes=${scorecard.missingRegimeKeys.length}`,
      "missingFeatures=0,missingRegimes=0",
    ),
  );

  checks.push(liveAllowedCheck("venue", context.venueControl));
  checks.push(liveAllowedCheck("asset", context.assetControl));

  if (context.latestCanaryRun) {
    const canaryPassed =
      context.latestCanaryRun.status === "success" &&
      context.latestCanaryRun.reconciliation?.status === "passed";
    checks.push(
      check(
        "strategy-linked-canary",
        canaryPassed ? "pass" : "blocked",
        canaryPassed
          ? "Linked readiness canary is still healthy."
          : "Linked readiness canary failed or requires intervention.",
        context.latestCanaryRun.status,
        "success",
      ),
    );
  }
}

function buildReadinessSubjectChecks(input: {
  request: RuntimeResearchPostLiveRequest;
  context: RuntimeResearchPostLiveContext;
  checks: RuntimeStrategyLabCheck[];
}): void {
  const { request, context, checks } = input;
  checks.push(
    liveAllowedCheck(
      request.subjectKind === "venue" ? "venue" : "asset",
      request.subjectKind === "venue"
        ? context.venueControl
        : context.assetControl,
    ),
  );

  if (context.latestReadinessArtifact) {
    checks.push(
      check(
        "subject-readiness",
        context.latestReadinessArtifact.status === "pass" ? "pass" : "blocked",
        context.latestReadinessArtifact.status === "pass"
          ? "Latest readiness artifact remains healthy."
          : "Latest readiness artifact is no longer healthy.",
        context.latestReadinessArtifact.status,
        "pass",
      ),
    );
  } else {
    checks.push(
      check(
        "subject-readiness",
        request.subjectKind === "venue" ? "pass" : "requires_human_approval",
        request.subjectKind === "venue"
          ? "No venue-scoped readiness artifact is linked; control state remains the primary guard."
          : "No readiness artifact is linked to this subject yet.",
        "missing",
        "present",
      ),
    );
  }

  if (context.latestCanaryRun) {
    const canaryPassed =
      context.latestCanaryRun.status === "success" &&
      context.latestCanaryRun.reconciliation?.status === "passed";
    checks.push(
      check(
        "subject-canary",
        canaryPassed ? "pass" : "blocked",
        canaryPassed
          ? "Latest readiness canary still passes."
          : "Latest readiness canary failed or requires intervention.",
        context.latestCanaryRun.status,
        "success",
      ),
    );
  } else {
    checks.push(
      check(
        "subject-canary",
        request.subjectKind === "venue" ? "pass" : "requires_human_approval",
        request.subjectKind === "venue"
          ? "No venue-scoped readiness canary is linked; cost drift and controls remain the primary venue guards."
          : "No readiness canary is linked to this subject yet.",
        "missing",
        "present",
      ),
    );
  }

  if (context.latestCostObservation) {
    const maxCostDriftBps = Math.min(
      request.thresholds?.maxCostDriftBps ?? Number.POSITIVE_INFINITY,
      context.latestCostModel?.driftGuard.maxCostDriftBps ??
        Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(maxCostDriftBps)) {
      applyThresholdCheck(checks, {
        checkId: "subject-cost-drift-bps",
        observed: context.latestCostObservation.costDriftBps,
        threshold: maxCostDriftBps,
        messagePass:
          "Observed cost drift remains inside the active model guard.",
        messageFail: "Observed cost drift exceeded the active model guard.",
        formatter: (value) => `${value}bps`,
      });
    }
    const maxLatencyDriftMs = Math.min(
      request.thresholds?.maxLatencyDriftMs ?? Number.POSITIVE_INFINITY,
      context.latestCostModel?.driftGuard.maxLatencyDriftMs ??
        Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(maxLatencyDriftMs)) {
      applyThresholdCheck(checks, {
        checkId: "subject-latency-drift-ms",
        observed: context.latestCostObservation.latencyDriftMs,
        threshold: maxLatencyDriftMs,
        messagePass:
          "Observed latency drift remains inside the active model guard.",
        messageFail: "Observed latency drift exceeded the active model guard.",
      });
    }
    checks.push(
      check(
        "subject-reconciliation",
        context.latestCostObservation.reconciliationStatus === "passed"
          ? "pass"
          : "blocked",
        context.latestCostObservation.reconciliationStatus === "passed"
          ? "Observed reconciliation still passes for the subject."
          : "Observed reconciliation drift requires intervention.",
        context.latestCostObservation.reconciliationStatus,
        "passed",
      ),
    );
  }

  if (request.subjectKind === "asset" && context.assetRecord) {
    const listingState = context.assetRecord.listingState;
    checks.push(
      check(
        "asset-listing-state",
        listingState === "shadow" ||
          listingState === "live" ||
          listingState === "paper"
          ? "pass"
          : "blocked",
        listingState === "shadow" ||
          listingState === "live" ||
          listingState === "paper"
          ? "Asset listing state is still compatible with bounded monitoring."
          : "Asset listing state is no longer compatible with bounded monitoring.",
        listingState,
        "shadow|live|paper",
      ),
    );
  }
}

function recommendAction(input: {
  subjectKind: RuntimeStrategyLabSubjectKind;
  currentState?: RuntimeStrategyLabPromotionState;
  status: RuntimeStrategyLabPromotionStatus;
  checks: RuntimeStrategyLabCheck[];
}): RuntimeResearchPostLiveRecommendation {
  if (input.status === "pass") {
    return { action: "observe" };
  }

  if (input.status === "requires_human_approval") {
    return { action: "revalidate" };
  }

  if (input.subjectKind !== "strategy") {
    return { action: "disable_subject" };
  }

  const catastrophicCheckIds = new Set([
    "strategy-feature-age-ms",
    "strategy-feature-coverage",
    "strategy-linked-canary",
    "venue-control",
    "asset-control",
    "subject-canary",
  ]);
  const hasCatastrophicFailure = input.checks.some(
    (check) =>
      check.status === "blocked" && catastrophicCheckIds.has(check.checkId),
  );

  if (hasCatastrophicFailure || input.currentState === "paused") {
    return { action: "pause", targetState: "paused" };
  }

  if (input.currentState === "broad_live") {
    return { action: "demote", targetState: "limited_live" };
  }

  if (input.currentState === "limited_live") {
    return { action: "demote", targetState: "paper" };
  }

  return { action: "pause", targetState: "paused" };
}

function buildSummary(input: {
  subjectKind: RuntimeStrategyLabSubjectKind;
  subjectKey: string;
  status: RuntimeStrategyLabPromotionStatus;
  recommendation: RuntimeResearchPostLiveRecommendation;
}): string {
  if (input.status === "pass") {
    return `Post-live review is healthy for ${input.subjectKind}:${input.subjectKey}.`;
  }
  if (input.status === "requires_human_approval") {
    return `Post-live review needs human revalidation for ${input.subjectKind}:${input.subjectKey}.`;
  }
  if (input.recommendation.targetState) {
    return `Post-live review flagged drift for ${input.subjectKind}:${input.subjectKey} and recommends ${input.recommendation.action} -> ${input.recommendation.targetState}.`;
  }
  return `Post-live review flagged drift for ${input.subjectKind}:${input.subjectKey} and recommends ${input.recommendation.action}.`;
}

export function buildRuntimeResearchPostLiveReview(input: {
  request: RuntimeResearchPostLiveRequest;
  context: RuntimeResearchPostLiveContext;
}): {
  artifact: RuntimeStrategyLabPostLiveArtifact;
  markdown: string;
} {
  const checks: RuntimeStrategyLabCheck[] = [];
  const evidenceRefs = [...(input.request.evidenceRefs ?? [])];
  const currentState = input.context.currentState ?? input.request.currentState;

  pushEvidenceRef(
    evidenceRefs,
    input.context.linkedPromotionId
      ? { kind: "promotion", ref: input.context.linkedPromotionId }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    input.context.latestReadinessArtifact
      ? {
          kind: "readiness_artifact",
          ref: input.context.latestReadinessArtifact.readinessId,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    input.context.latestCanaryRun
      ? {
          kind: "readiness_canary",
          ref: input.context.latestCanaryRun.runId,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    input.context.scorecard
      ? {
          kind: "runtime_scorecard",
          ref: input.context.scorecard.deploymentId,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    input.context.latestCostObservation
      ? {
          kind: "cost_observation",
          ref: input.context.latestCostObservation.observationId,
        }
      : null,
  );
  pushEvidenceRef(
    evidenceRefs,
    input.context.linkedControlRef
      ? { kind: "subject_control", ref: input.context.linkedControlRef }
      : null,
  );

  if (input.request.subjectKind === "strategy") {
    buildStrategyChecks({
      request: input.request,
      context: input.context,
      checks,
    });
  } else {
    buildReadinessSubjectChecks({
      request: input.request,
      context: input.context,
      checks,
    });
  }

  checks.push(...(input.request.externalChecks ?? []));

  const reviewStatus = statusFromChecks(checks);
  const recommendation = recommendAction({
    subjectKind: input.request.subjectKind,
    currentState,
    status: reviewStatus,
    checks,
  });
  const finalStatus =
    input.request.applyAction === true &&
    recommendation.action !== "observe" &&
    recommendation.action !== "revalidate"
      ? "applied"
      : reviewStatus;
  const nowIso = new Date().toISOString();
  const artifact = parseRuntimeStrategyLabPostLiveArtifact({
    schemaVersion: "v1",
    postLiveId: `postlive_${hash(
      JSON.stringify({
        subjectKind: input.request.subjectKind,
        subjectKey: input.request.subjectKey,
        deploymentId: input.request.deploymentId ?? null,
        currentState: currentState ?? null,
        finalStatus,
      }),
    )}`,
    subjectKind: input.request.subjectKind,
    subjectKey: input.request.subjectKey,
    ...(currentState ? { currentState } : {}),
    ...(input.request.deploymentId
      ? { deploymentId: input.request.deploymentId }
      : {}),
    ...(input.request.venueKey ? { venueKey: input.request.venueKey } : {}),
    ...(input.request.assetKey ? { assetKey: input.request.assetKey } : {}),
    ...(input.request.pairSymbol
      ? { pairSymbol: input.request.pairSymbol }
      : {}),
    status: finalStatus,
    summary: buildSummary({
      subjectKind: input.request.subjectKind,
      subjectKey: input.request.subjectKey,
      status: reviewStatus,
      recommendation,
    }),
    recommendedAction: recommendation.action,
    ...(recommendation.targetState
      ? { recommendedTargetState: recommendation.targetState }
      : {}),
    checks,
    evidenceRefs: dedupeEvidenceRefs(evidenceRefs),
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(input.request.metadata ? { metadata: input.request.metadata } : {}),
  });

  return {
    artifact,
    markdown: buildRuntimeResearchPostLiveMarkdown(artifact),
  };
}

export function buildRuntimeResearchPostLiveMarkdown(
  artifact: RuntimeStrategyLabPostLiveArtifact,
): string {
  const lines = [
    `# Strategy-lab post-live review for ${artifact.subjectKind}:${artifact.subjectKey}`,
    "",
    `- Review id: ${artifact.postLiveId}`,
    `- Status: ${artifact.status}`,
    `- Recommended action: ${artifact.recommendedAction}${artifact.recommendedTargetState ? ` -> ${artifact.recommendedTargetState}` : ""}`,
    `- Created at: ${artifact.createdAt}`,
    `- Summary: ${artifact.summary}`,
  ];

  if (artifact.currentState) {
    lines.push(`- Current state: ${artifact.currentState}`);
  }
  if (artifact.deploymentId) {
    lines.push(`- Deployment: ${artifact.deploymentId}`);
  }
  if (artifact.followUpPromotionId) {
    lines.push(`- Follow-up promotion: ${artifact.followUpPromotionId}`);
  }
  if (artifact.followUpControlRef) {
    lines.push(`- Follow-up control: ${artifact.followUpControlRef}`);
  }

  lines.push("", "## Evidence", "");
  if (artifact.evidenceRefs.length === 0) {
    lines.push("- none");
  } else {
    for (const ref of artifact.evidenceRefs) {
      lines.push(`- ${ref.kind}: ${ref.ref}`);
    }
  }

  lines.push("", "## Checks", "");
  for (const item of artifact.checks) {
    const observed = item.observedValue
      ? ` observed=${item.observedValue}`
      : "";
    const threshold = item.thresholdValue
      ? ` threshold=${item.thresholdValue}`
      : "";
    lines.push(
      `- ${item.checkId}: ${item.status}${observed}${threshold} (${item.message})`,
    );
  }

  return lines.join("\n");
}
