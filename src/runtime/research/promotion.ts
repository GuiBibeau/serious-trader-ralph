import { createHash } from "node:crypto";
import {
  canTransitionRuntimeStrategyLabReadinessState,
  canTransitionRuntimeStrategyLabStrategyState,
  parseRuntimeDeploymentRecord,
  parseRuntimeResearchPolicyGateArtifact,
  parseRuntimeStrategyLabPromotionEvent,
  parseRuntimeStrategyLabPromotionRecord,
  type RuntimeDeploymentRecord,
  type RuntimeResearchHumanApprovalRecord,
  type RuntimeResearchPolicyGateArtifact,
  type RuntimeResearchPolicyTargetMode,
  type RuntimeStrategyLabEvidenceRef,
  type RuntimeStrategyLabPromotionEvent,
  type RuntimeStrategyLabPromotionRecord,
  type RuntimeStrategyLabPromotionState,
  type RuntimeStrategyLabPromotionStatus,
  type RuntimeStrategyLabStrategyState,
  type RuntimeStrategyLabSubjectKind,
  type RuntimeStrategyLabTransitionType,
} from "../contracts/autonomous_runtime.js";
import type { RuntimeResearchSynthesisArtifact } from "./synthesis.js";
import type { RuntimeResearchCandidateTriageArtifact } from "./triage.js";

type RuntimePromotionCheck =
  RuntimeStrategyLabPromotionRecord["checks"][number];
type RuntimePromotionAction =
  RuntimeStrategyLabPromotionRecord["actions"][number];

export type RuntimeScorecardGate = {
  sourceMode?: string;
  targetMode?: string;
  status?: string;
};

export type RuntimeResearchPromotionRequest = {
  subjectKind: RuntimeStrategyLabSubjectKind;
  subjectKey: string;
  currentState: RuntimeStrategyLabPromotionState;
  targetState: RuntimeStrategyLabPromotionState;
  requestedBy: string;
  issueNumber?: number;
  pullRequestNumber?: number;
  evidenceRefs?: RuntimeStrategyLabEvidenceRef[];
  implementationReference?: {
    kind: "pull_request" | "issue" | "commit";
    ref: string;
    mergedAt?: string;
    revision?: string;
    notes?: string;
  };
  synthesis?: RuntimeResearchSynthesisArtifact;
  triage?: RuntimeResearchCandidateTriageArtifact;
  policyGate?: RuntimeResearchPolicyGateArtifact;
  approvals?: RuntimeResearchHumanApprovalRecord[];
  deployment?: RuntimeDeploymentRecord;
  runtimeScorecard?: {
    promotionGates?: RuntimeScorecardGate[];
  };
  limitedLiveCanaryPassed?: boolean;
  limitedLiveCanaryRef?: string;
  limitedLiveSoakPassed?: boolean;
  limitedLiveSoakRef?: string;
  readinessArtifactIds?: string[];
  applyTransition?: boolean;
  activateEvaluation?: boolean;
  metadata?: Record<string, unknown>;
};

const STRATEGY_STATE_ORDER: RuntimeStrategyLabStrategyState[] = [
  "candidate",
  "draft",
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
];

const READINESS_STATE_ORDER: Array<
  Exclude<
    RuntimeStrategyLabPromotionState,
    | "draft"
    | "shadow"
    | "paper"
    | "limited_live"
    | "broad_live"
    | "paused"
    | "deprecated"
  >
> = [
  "candidate",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
];

const STRATEGY_STATES = new Set<RuntimeStrategyLabPromotionState>([
  "candidate",
  "draft",
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
  "paused",
  "deprecated",
]);

const READINESS_STATES = new Set<RuntimeStrategyLabPromotionState>([
  "candidate",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
  "paused",
  "deprecated",
]);

export function parseRuntimeResearchPromotionRequest(
  input: unknown,
): RuntimeResearchPromotionRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-promotion-request");
  }

  const subjectKind = readEnum(input.subjectKind, "subjectKind", [
    "strategy",
    "venue",
    "asset",
  ]) as RuntimeStrategyLabSubjectKind;
  const currentState = readState(input.currentState, "currentState");
  const targetState = readState(input.targetState, "targetState");
  const requestedBy = readRequiredString(input.requestedBy, "requestedBy");
  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? input.evidenceRefs.map(parseEvidenceRef)
    : [];
  const approvals = Array.isArray(input.approvals)
    ? input.approvals.map(parseApproval)
    : [];

  return {
    subjectKind,
    subjectKey: readRequiredString(input.subjectKey, "subjectKey"),
    currentState,
    targetState,
    requestedBy,
    ...(typeof input.issueNumber === "number" &&
    Number.isInteger(input.issueNumber)
      ? { issueNumber: input.issueNumber }
      : {}),
    ...(typeof input.pullRequestNumber === "number" &&
    Number.isInteger(input.pullRequestNumber)
      ? { pullRequestNumber: input.pullRequestNumber }
      : {}),
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
    ...(input.implementationReference
      ? {
          implementationReference: parseImplementationReference(
            input.implementationReference,
          ),
        }
      : {}),
    ...(input.synthesis
      ? { synthesis: input.synthesis as RuntimeResearchSynthesisArtifact }
      : {}),
    ...(input.triage
      ? { triage: input.triage as RuntimeResearchCandidateTriageArtifact }
      : {}),
    ...(input.policyGate
      ? { policyGate: parseRuntimeResearchPolicyGateArtifact(input.policyGate) }
      : {}),
    ...(approvals.length > 0 ? { approvals } : {}),
    ...(input.deployment
      ? { deployment: parseRuntimeDeploymentRecord(input.deployment) }
      : {}),
    ...(isRecord(input.runtimeScorecard)
      ? {
          runtimeScorecard: {
            promotionGates: Array.isArray(input.runtimeScorecard.promotionGates)
              ? input.runtimeScorecard.promotionGates.map((gate) =>
                  parseRuntimeScorecardGate(gate),
                )
              : [],
          },
        }
      : {}),
    ...(typeof input.limitedLiveCanaryPassed === "boolean"
      ? { limitedLiveCanaryPassed: input.limitedLiveCanaryPassed }
      : {}),
    ...(typeof input.limitedLiveCanaryRef === "string" &&
    input.limitedLiveCanaryRef.trim()
      ? { limitedLiveCanaryRef: input.limitedLiveCanaryRef.trim() }
      : {}),
    ...(typeof input.limitedLiveSoakPassed === "boolean"
      ? { limitedLiveSoakPassed: input.limitedLiveSoakPassed }
      : {}),
    ...(typeof input.limitedLiveSoakRef === "string" &&
    input.limitedLiveSoakRef.trim()
      ? { limitedLiveSoakRef: input.limitedLiveSoakRef.trim() }
      : {}),
    ...(Array.isArray(input.readinessArtifactIds)
      ? {
          readinessArtifactIds: input.readinessArtifactIds
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0),
        }
      : {}),
    ...(typeof input.applyTransition === "boolean"
      ? { applyTransition: input.applyTransition }
      : {}),
    ...(typeof input.activateEvaluation === "boolean"
      ? { activateEvaluation: input.activateEvaluation }
      : {}),
    ...(isRecord(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  };
}

export function buildRuntimeResearchPromotion(input: {
  request: RuntimeResearchPromotionRequest;
}): {
  promotion: RuntimeStrategyLabPromotionRecord;
  event: RuntimeStrategyLabPromotionEvent;
} {
  const request = input.request;
  const nowIso = new Date().toISOString();
  const checks: RuntimePromotionCheck[] = [];
  const actions: RuntimePromotionAction[] = [
    action("record-state-transition", "record_state_transition", {
      summary: "Persist the strategy-lab transition audit record.",
      required: true,
      payload: {
        subjectKind: request.subjectKind,
        subjectKey: request.subjectKey,
        currentState: request.currentState,
        targetState: request.targetState,
      },
    }),
  ];
  const evidenceRefs = collectEvidenceRefs(request);
  const approvalMap = new Map(
    (request.approvals ?? []).map((approval) => [
      approval.targetMode,
      approval,
    ]),
  );

  const transitionType = classifyTransitionType(
    request.subjectKind,
    request.currentState,
    request.targetState,
  );

  if (request.subjectKind === "strategy") {
    buildStrategyChecks({
      request,
      checks,
      actions,
      evidenceRefs,
      approvalMap,
      nowIso,
    });
  } else {
    buildReadinessChecks({
      request,
      checks,
      actions,
      evidenceRefs,
      approvalMap,
    });
  }

  const status = finalizeStatus(checks, request.applyTransition === true);
  const summary = buildSummary(request, status, transitionType);
  const promotionId = `promotion_${hash(
    JSON.stringify({
      subjectKind: request.subjectKind,
      subjectKey: request.subjectKey,
      currentState: request.currentState,
      targetState: request.targetState,
      transitionType,
      status,
      issueNumber: request.issueNumber ?? null,
      pullRequestNumber: request.pullRequestNumber ?? null,
    }),
  )}`;

  const promotion = parseRuntimeStrategyLabPromotionRecord({
    schemaVersion: "v1",
    promotionId,
    subjectKind: request.subjectKind,
    subjectKey: request.subjectKey,
    currentState: request.currentState,
    targetState: request.targetState,
    transitionType,
    status,
    summary,
    requestedBy: request.requestedBy,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(status === "applied" ? { appliedAt: nowIso } : {}),
    ...(request.issueNumber ? { issueNumber: request.issueNumber } : {}),
    ...(request.pullRequestNumber
      ? { pullRequestNumber: request.pullRequestNumber }
      : {}),
    ...(request.deployment
      ? { deploymentId: request.deployment.deploymentId }
      : {}),
    ...(request.policyGate
      ? { policyGateId: request.policyGate.policyGateId }
      : {}),
    ...(request.synthesis
      ? { synthesisId: request.synthesis.synthesisId }
      : {}),
    ...(request.triage ? { triageId: request.triage.triageId } : {}),
    ...(request.implementationReference
      ? { implementationReference: request.implementationReference }
      : {}),
    evidenceRefs,
    checks,
    actions,
    approvals: Array.from(approvalMap.values()),
    ...(request.metadata ? { metadata: request.metadata } : {}),
  });

  const event = parseRuntimeStrategyLabPromotionEvent({
    schemaVersion: "v1",
    eventId: `promoevt_${hash(`${promotionId}:${nowIso}:${status}`)}`,
    promotionId,
    eventType: status === "applied" ? "applied" : "evaluated",
    actor: request.requestedBy,
    fromState: request.currentState,
    toState: request.targetState,
    summary,
    details: {
      status,
      transitionType,
      subjectKind: request.subjectKind,
      subjectKey: request.subjectKey,
    },
    createdAt: nowIso,
  });

  return { promotion, event };
}

export function buildRuntimeResearchPromotionMarkdown(
  promotion: RuntimeStrategyLabPromotionRecord,
): string {
  const lines = [
    `# Strategy-lab transition for ${promotion.subjectKind}:${promotion.subjectKey}`,
    "",
    `- Promotion id: ${promotion.promotionId}`,
    `- Status: ${promotion.status}`,
    `- Transition: ${promotion.currentState} -> ${promotion.targetState} (${promotion.transitionType})`,
    `- Requested by: ${promotion.requestedBy}`,
    `- Created at: ${promotion.createdAt}`,
    `- Summary: ${promotion.summary}`,
  ];

  if (promotion.issueNumber) {
    lines.push(`- Issue: #${promotion.issueNumber}`);
  }
  if (promotion.pullRequestNumber) {
    lines.push(`- PR: #${promotion.pullRequestNumber}`);
  }
  if (promotion.deploymentId) {
    lines.push(`- Deployment: ${promotion.deploymentId}`);
  }

  lines.push("", "## Evidence", "");
  if (promotion.evidenceRefs.length === 0) {
    lines.push("- none");
  } else {
    for (const ref of promotion.evidenceRefs) {
      lines.push(`- ${ref.kind}: ${ref.ref}`);
    }
  }

  lines.push("", "## Checks", "");
  for (const check of promotion.checks) {
    const observed = check.observedValue
      ? ` observed=${check.observedValue}`
      : "";
    const threshold = check.thresholdValue
      ? ` threshold=${check.thresholdValue}`
      : "";
    lines.push(
      `- ${check.checkId}: ${check.status}${observed}${threshold} (${check.message})`,
    );
  }

  lines.push("", "## Actions", "");
  for (const action of promotion.actions) {
    lines.push(
      `- ${action.actionType}${action.required ? " [required]" : ""}: ${action.summary}`,
    );
  }

  return lines.join("\n");
}

function buildStrategyChecks(input: {
  request: RuntimeResearchPromotionRequest;
  checks: RuntimePromotionCheck[];
  actions: RuntimePromotionAction[];
  evidenceRefs: RuntimeStrategyLabEvidenceRef[];
  approvalMap: Map<
    RuntimeResearchPolicyTargetMode,
    RuntimeResearchHumanApprovalRecord
  >;
  nowIso: string;
}): void {
  const { request, checks, actions, evidenceRefs } = input;
  const currentState = asStrategyState(request.currentState);
  const targetState = asStrategyState(request.targetState);
  if (!currentState || !targetState) {
    checks.push(
      blockedCheck(
        "strategy-state-family",
        `${request.currentState}->${request.targetState}`,
        "strategy-state transition",
        "Strategy promotions must use the strategy-lifecycle state family.",
      ),
    );
    return;
  }

  checks.push(
    canTransitionRuntimeStrategyLabStrategyState(currentState, targetState)
      ? passCheck(
          "allowed-transition",
          `${currentState}->${targetState}`,
          "supported",
          "Transition is part of the strategy-lab strategy state machine.",
        )
      : blockedCheck(
          "allowed-transition",
          `${currentState}->${targetState}`,
          "supported",
          "Requested strategy transition is not allowed by the orchestration state machine.",
        ),
  );

  if (isRollbackLike(currentState, targetState)) {
    maybeAddApplyAction({ request, actions });
    return;
  }

  if (targetState === "draft") {
    checks.push(
      request.synthesis
        ? passCheck(
            "candidate-synthesis",
            request.synthesis.synthesisId,
            "present",
            "Candidate draft promotion is backed by a synthesis artifact.",
          )
        : blockedCheck(
            "candidate-synthesis",
            "missing",
            "present",
            "Candidate-to-draft promotion requires a synthesis artifact.",
          ),
    );
    checks.push(
      request.triage
        ? passCheck(
            "candidate-triage",
            request.triage.triageId,
            "present",
            "Candidate draft promotion is backed by a triage artifact.",
          )
        : blockedCheck(
            "candidate-triage",
            "missing",
            "present",
            "Candidate-to-draft promotion requires a triage artifact.",
          ),
    );
    checks.push(
      request.triage && request.triage.disposition !== "archive"
        ? passCheck(
            "candidate-disposition",
            request.triage.disposition,
            "promote_to_candidate|review",
            "Archived candidates cannot progress to draft.",
          )
        : blockedCheck(
            "candidate-disposition",
            request.triage?.disposition ?? "missing",
            "promote_to_candidate|review",
            "Archived or missing triage blocks candidate-to-draft promotion.",
          ),
    );
    return;
  }

  const policyTarget = toPolicyTarget(targetState);
  const gate = request.policyGate?.gates.find(
    (entry) => entry.targetMode === policyTarget,
  );
  checks.push(
    gate?.status === "pass"
      ? passCheck(
          "policy-gate",
          gate.status,
          "pass",
          `${formatPolicyTarget(policyTarget)} policy gate passed.`,
        )
      : gate?.status === "requires_human_approval"
        ? approvalCheck(
            "policy-gate",
            gate.status,
            "pass",
            `${formatPolicyTarget(policyTarget)} policy gate still requires human approval.`,
          )
        : blockedCheck(
            "policy-gate",
            gate?.status ?? "missing",
            "pass",
            `${formatPolicyTarget(policyTarget)} policy gate must pass before promotion.`,
          ),
  );

  checks.push(
    request.implementationReference
      ? passCheck(
          "implementation-reference",
          request.implementationReference.ref,
          "present",
          "Implementation reference is attached to the transition record.",
        )
      : blockedCheck(
          "implementation-reference",
          "missing",
          "present",
          "Strategy promotion beyond draft requires a merged implementation reference.",
        ),
  );

  if (
    targetState === "shadow" ||
    targetState === "paper" ||
    targetState === "limited_live" ||
    targetState === "broad_live"
  ) {
    checks.push(deploymentRecordCheck(request.deployment, targetState));
  }

  if (targetState === "paper") {
    checks.push(
      scorecardGateCheck(request.runtimeScorecard, "shadow", "paper"),
    );
  }

  if (targetState === "limited_live") {
    checks.push(scorecardGateCheck(request.runtimeScorecard, "paper", "live"));
    checks.push(
      hasEvidenceKind(evidenceRefs, "allocator_review")
        ? passCheck(
            "allocator-review",
            "present",
            "allocator_review",
            "Allocator review is attached for bounded live promotion.",
          )
        : blockedCheck(
            "allocator-review",
            "missing",
            "allocator_review",
            "Limited-live promotion requires allocator review evidence.",
          ),
    );
    checks.push(
      hasEvidenceKind(evidenceRefs, "limited_live_canary_plan")
        ? passCheck(
            "limited-live-canary-plan",
            "present",
            "limited_live_canary_plan",
            "Bounded canary plan is attached for limited-live promotion.",
          )
        : blockedCheck(
            "limited-live-canary-plan",
            "missing",
            "limited_live_canary_plan",
            "Limited-live promotion requires a bounded canary plan.",
          ),
    );
  }

  if (targetState === "broad_live") {
    checks.push(
      request.limitedLiveCanaryPassed
        ? passCheck(
            "limited-live-canary",
            request.limitedLiveCanaryRef ?? "passed",
            "passed",
            "Limited-live canary passed for broader rollout.",
          )
        : blockedCheck(
            "limited-live-canary",
            "missing_or_failed",
            "passed",
            "Broad-live promotion requires a successful limited-live canary.",
          ),
    );
    checks.push(
      request.limitedLiveSoakPassed
        ? passCheck(
            "limited-live-soak",
            request.limitedLiveSoakRef ?? "passed",
            "passed",
            "Limited-live soak passed for broader rollout.",
          )
        : blockedCheck(
            "limited-live-soak",
            "missing_or_failed",
            "passed",
            "Broad-live promotion requires a successful limited-live soak.",
          ),
    );
  }

  maybeAddApplyAction({ request, actions });
  if (
    request.applyTransition === true &&
    request.activateEvaluation === true &&
    request.deployment &&
    targetState === "shadow"
  ) {
    actions.push(
      action("evaluate-shadow", "evaluate_runtime_deployment", {
        summary:
          "Kick off a bounded shadow evaluation after the deployment is upserted.",
        required: true,
        payload: {
          deploymentId: request.deployment.deploymentId,
          body: {
            trigger: "strategy-lab-promotion",
            promotedAt: input.nowIso,
          },
        },
      }),
    );
  }
}

function buildReadinessChecks(input: {
  request: RuntimeResearchPromotionRequest;
  checks: RuntimePromotionCheck[];
  actions: RuntimePromotionAction[];
  evidenceRefs: RuntimeStrategyLabEvidenceRef[];
  approvalMap: Map<
    RuntimeResearchPolicyTargetMode,
    RuntimeResearchHumanApprovalRecord
  >;
}): void {
  const { request, checks, actions, evidenceRefs, approvalMap } = input;
  if (
    !READINESS_STATES.has(request.currentState) ||
    !READINESS_STATES.has(request.targetState)
  ) {
    checks.push(
      blockedCheck(
        "readiness-state-family",
        `${request.currentState}->${request.targetState}`,
        "readiness-state transition",
        "Venue and asset promotion must use onboarding readiness states.",
      ),
    );
    return;
  }

  checks.push(
    canTransitionRuntimeStrategyLabReadinessState(
      request.currentState as Exclude<
        RuntimeStrategyLabPromotionState,
        "draft" | "shadow" | "paper" | "limited_live" | "broad_live"
      >,
      request.targetState,
    )
      ? passCheck(
          "allowed-transition",
          `${request.currentState}->${request.targetState}`,
          "supported",
          "Transition is part of the venue/asset readiness state machine.",
        )
      : blockedCheck(
          "allowed-transition",
          `${request.currentState}->${request.targetState}`,
          "supported",
          "Requested readiness transition is not allowed by the orchestration state machine.",
        ),
  );

  if (isRollbackLike(request.currentState, request.targetState)) {
    return;
  }

  if (request.targetState === "integrated") {
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "metadata_draft",
      "candidate-integrated-metadata",
    );
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "mapping_coverage",
      "candidate-integrated-mappings",
    );
    return;
  }

  if (request.targetState === "shadow_ready") {
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "replay_fixture",
      "shadow-ready-replay",
    );
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "adapter_validation",
      "shadow-ready-adapter",
    );
    return;
  }

  if (request.targetState === "paper_ready") {
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "cost_model_coverage",
      "paper-ready-cost-model",
    );
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "paper_lifecycle_coverage",
      "paper-ready-paper-lifecycle",
    );
    return;
  }

  if (request.targetState === "limited_live_ready") {
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "bounded_canary_plan",
      "limited-live-ready-canary-plan",
    );
    requireEvidenceKind(
      checks,
      evidenceRefs,
      "allowlist_change",
      "limited-live-ready-allowlist",
    );
    checks.push(
      approvalMap.has("limited_live")
        ? passCheck(
            "human-approval",
            approvalMap.get("limited_live")?.approvedBy ?? "present",
            "recorded",
            "Limited-live readiness requires explicit human approval.",
          )
        : approvalCheck(
            "human-approval",
            "missing",
            "recorded",
            "Limited-live readiness requires explicit human approval.",
          ),
    );
    actions.push(
      action("record-allowlist-change", "record_allowlist_change", {
        summary:
          "Record the allowlist change needed for bounded live readiness.",
        required: true,
      }),
    );
    return;
  }

  if (request.targetState === "broad_live_ready") {
    checks.push(
      request.limitedLiveCanaryPassed
        ? passCheck(
            "limited-live-canary",
            request.limitedLiveCanaryRef ?? "passed",
            "passed",
            "Limited-live canary evidence is attached for readiness widening.",
          )
        : blockedCheck(
            "limited-live-canary",
            "missing_or_failed",
            "passed",
            "Broad-live readiness requires a successful limited-live canary.",
          ),
    );
    checks.push(
      request.limitedLiveSoakPassed
        ? passCheck(
            "limited-live-soak",
            request.limitedLiveSoakRef ?? "passed",
            "passed",
            "Limited-live soak evidence is attached for readiness widening.",
          )
        : blockedCheck(
            "limited-live-soak",
            "missing_or_failed",
            "passed",
            "Broad-live readiness requires a successful limited-live soak.",
          ),
    );
    checks.push(
      approvalMap.has("broad_live")
        ? passCheck(
            "human-approval",
            approvalMap.get("broad_live")?.approvedBy ?? "present",
            "recorded",
            "Broad-live readiness requires explicit human approval.",
          )
        : approvalCheck(
            "human-approval",
            "missing",
            "recorded",
            "Broad-live readiness requires explicit human approval.",
          ),
    );
  }
}

function scorecardGateCheck(
  runtimeScorecard:
    | RuntimeResearchPromotionRequest["runtimeScorecard"]
    | undefined,
  sourceMode: "shadow" | "paper",
  targetMode: "paper" | "live",
): RuntimePromotionCheck {
  const gate = (runtimeScorecard?.promotionGates ?? []).find(
    (entry) =>
      entry.sourceMode?.toLowerCase() === sourceMode &&
      entry.targetMode?.toLowerCase() === targetMode,
  );
  return String(gate?.status ?? "").toLowerCase() === "pass"
    ? passCheck(
        "runtime-scorecard",
        `${sourceMode}->${targetMode}:pass`,
        "pass",
        "Runtime scorecard cleared the required promotion gate.",
      )
    : blockedCheck(
        "runtime-scorecard",
        gate?.status ?? "missing",
        "pass",
        "Runtime scorecard must clear the required promotion gate before progression.",
      );
}

function maybeAddApplyAction(input: {
  request: RuntimeResearchPromotionRequest;
  actions: RuntimePromotionAction[];
}): void {
  const { request, actions } = input;
  if (request.applyTransition !== true) {
    return;
  }

  if (request.subjectKind !== "strategy") {
    return;
  }

  if (request.targetState === "paused") {
    const deploymentId = request.deployment?.deploymentId ?? request.subjectKey;
    actions.push(
      action("pause-runtime-deployment", "apply_runtime_control", {
        summary: "Pause the runtime deployment for this strategy transition.",
        required: true,
        payload: {
          deploymentId,
          action: "pause",
        },
      }),
    );
    return;
  }

  if (
    request.deployment &&
    (request.targetState === "shadow" ||
      request.targetState === "paper" ||
      request.targetState === "limited_live")
  ) {
    actions.push(
      action("upsert-runtime-deployment", "upsert_runtime_deployment", {
        summary:
          "Upsert the runtime deployment into the target execution mode.",
        required: true,
        payload: {
          deployment: request.deployment,
        },
      }),
    );
  }
}

function deploymentRecordCheck(
  deployment: RuntimeDeploymentRecord | undefined,
  targetState: RuntimeStrategyLabStrategyState,
): RuntimePromotionCheck {
  const expected = expectedDeploymentRecord(targetState);
  const threshold = `${expected.mode}:${expected.state}`;
  if (!deployment) {
    return blockedCheck(
      "deployment-record",
      "missing",
      threshold,
      "Apply-time promotion requires a runtime deployment record in the target mode.",
    );
  }

  const observed = `${deployment.mode}:${deployment.state}`;
  if (
    deployment.mode !== expected.mode ||
    deployment.state !== expected.state
  ) {
    return blockedCheck(
      "deployment-record",
      observed,
      threshold,
      "Runtime deployment record must already reflect the requested target mode and state.",
    );
  }

  return passCheck(
    "deployment-record",
    observed,
    threshold,
    "Runtime deployment record is attached for apply-time orchestration.",
  );
}

function requireEvidenceKind(
  checks: RuntimePromotionCheck[],
  evidenceRefs: RuntimeStrategyLabEvidenceRef[],
  kind: string,
  checkId: string,
): void {
  checks.push(
    hasEvidenceKind(evidenceRefs, kind)
      ? passCheck(
          checkId,
          "present",
          kind,
          `Evidence of kind ${kind} is attached to the transition.`,
        )
      : blockedCheck(
          checkId,
          "missing",
          kind,
          `Transition requires evidence of kind ${kind}.`,
        ),
  );
}

function collectEvidenceRefs(
  request: RuntimeResearchPromotionRequest,
): RuntimeStrategyLabEvidenceRef[] {
  const refs = [...(request.evidenceRefs ?? [])];
  if (request.synthesis) {
    refs.push({
      kind: "synthesis",
      ref: request.synthesis.synthesisId,
    });
  }
  if (request.triage) {
    refs.push({
      kind: "triage",
      ref: request.triage.triageId,
    });
  }
  if (request.policyGate) {
    refs.push({
      kind: "policy_gate",
      ref: request.policyGate.policyGateId,
    });
  }
  if (request.implementationReference) {
    refs.push({
      kind: "implementation_reference",
      ref: request.implementationReference.ref,
      ...(request.implementationReference.notes
        ? { notes: request.implementationReference.notes }
        : {}),
    });
  }
  if (request.runtimeScorecard?.promotionGates?.length) {
    refs.push({
      kind: "runtime_scorecard",
      ref: request.deployment?.deploymentId ?? request.subjectKey,
    });
  }
  if (request.limitedLiveCanaryPassed) {
    refs.push({
      kind: "limited_live_canary",
      ref: request.limitedLiveCanaryRef ?? "passed",
    });
  }
  if (request.limitedLiveSoakPassed) {
    refs.push({
      kind: "limited_live_soak",
      ref: request.limitedLiveSoakRef ?? "passed",
    });
  }

  const deduped = new Map<string, RuntimeStrategyLabEvidenceRef>();
  for (const ref of refs) {
    deduped.set(`${ref.kind}:${ref.ref}`, ref);
  }
  return Array.from(deduped.values());
}

function finalizeStatus(
  checks: RuntimePromotionCheck[],
  applyTransition: boolean,
): RuntimeStrategyLabPromotionStatus {
  if (checks.some((check) => check.status === "blocked")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "requires_human_approval")) {
    return "requires_human_approval";
  }
  return applyTransition ? "applied" : "pass";
}

function buildSummary(
  request: RuntimeResearchPromotionRequest,
  status: RuntimeStrategyLabPromotionStatus,
  transitionType: RuntimeStrategyLabTransitionType,
): string {
  const transition = `${request.currentState} -> ${request.targetState}`;
  switch (status) {
    case "applied":
      return `${transitionType} transition ${transition} was applied.`;
    case "pass":
      return `${transitionType} transition ${transition} is eligible and ready to apply.`;
    case "requires_human_approval":
      return `${transitionType} transition ${transition} is gated on explicit human approval.`;
    default:
      return `${transitionType} transition ${transition} is blocked by orchestration checks.`;
  }
}

function classifyTransitionType(
  subjectKind: RuntimeStrategyLabSubjectKind,
  currentState: RuntimeStrategyLabPromotionState,
  targetState: RuntimeStrategyLabPromotionState,
): RuntimeStrategyLabTransitionType {
  if (targetState === "paused") return "pause";
  if (currentState === "paused") return "resume";
  if (targetState === "deprecated") return "archive";

  const order =
    subjectKind === "strategy" ? STRATEGY_STATE_ORDER : READINESS_STATE_ORDER;
  const currentIndex = order.indexOf(currentState as never);
  const targetIndex = order.indexOf(targetState as never);
  if (currentIndex >= 0 && targetIndex >= 0 && targetIndex > currentIndex) {
    return "promote";
  }
  return "demote";
}

function isRollbackLike(
  currentState: RuntimeStrategyLabPromotionState,
  targetState: RuntimeStrategyLabPromotionState,
): boolean {
  if (targetState === "paused" || targetState === "deprecated") {
    return true;
  }
  if (currentState === "paused") {
    return false;
  }
  const currentStrategyIndex = STRATEGY_STATE_ORDER.indexOf(
    currentState as RuntimeStrategyLabStrategyState,
  );
  const targetStrategyIndex = STRATEGY_STATE_ORDER.indexOf(
    targetState as RuntimeStrategyLabStrategyState,
  );
  if (
    currentStrategyIndex >= 0 &&
    targetStrategyIndex >= 0 &&
    targetStrategyIndex < currentStrategyIndex
  ) {
    return true;
  }
  const currentReadinessIndex = READINESS_STATE_ORDER.indexOf(
    currentState as never,
  );
  const targetReadinessIndex = READINESS_STATE_ORDER.indexOf(
    targetState as never,
  );
  return (
    currentReadinessIndex >= 0 &&
    targetReadinessIndex >= 0 &&
    targetReadinessIndex < currentReadinessIndex
  );
}

function toPolicyTarget(
  targetState: RuntimeStrategyLabStrategyState,
): RuntimeResearchPolicyTargetMode {
  switch (targetState) {
    case "shadow":
      return "shadow";
    case "paper":
      return "paper";
    case "limited_live":
      return "limited_live";
    case "broad_live":
      return "broad_live";
    default:
      return "shadow";
  }
}

function expectedDeploymentRecord(
  targetState: RuntimeStrategyLabStrategyState,
): Pick<RuntimeDeploymentRecord, "mode" | "state"> {
  switch (targetState) {
    case "shadow":
      return { mode: "shadow", state: "shadow" };
    case "paper":
      return { mode: "paper", state: "paper" };
    case "limited_live":
    case "broad_live":
      return { mode: "live", state: "live" };
    case "paused":
      return { mode: "live", state: "paused" };
    default:
      return { mode: "shadow", state: "draft" };
  }
}

function formatPolicyTarget(target: RuntimeResearchPolicyTargetMode): string {
  switch (target) {
    case "limited_live":
      return "Limited Live";
    case "broad_live":
      return "Broad Live";
    case "paper":
      return "Paper";
    default:
      return "Shadow";
  }
}

function hasEvidenceKind(
  evidenceRefs: RuntimeStrategyLabEvidenceRef[],
  kind: string,
): boolean {
  return evidenceRefs.some((ref) => ref.kind === kind);
}

function asStrategyState(
  state: RuntimeStrategyLabPromotionState,
): RuntimeStrategyLabStrategyState | null {
  return STRATEGY_STATES.has(state)
    ? (state as RuntimeStrategyLabStrategyState)
    : null;
}

function action(
  actionId: string,
  actionType: RuntimePromotionAction["actionType"],
  input: Omit<RuntimePromotionAction, "actionId" | "actionType">,
): RuntimePromotionAction {
  return {
    actionId,
    actionType,
    ...input,
  };
}

function passCheck(
  checkId: string,
  observedValue: string,
  thresholdValue: string,
  message: string,
): RuntimePromotionCheck {
  return {
    checkId,
    status: "pass",
    observedValue,
    thresholdValue,
    message,
  };
}

function blockedCheck(
  checkId: string,
  observedValue: string,
  thresholdValue: string,
  message: string,
): RuntimePromotionCheck {
  return {
    checkId,
    status: "blocked",
    observedValue,
    thresholdValue,
    message,
  };
}

function approvalCheck(
  checkId: string,
  observedValue: string,
  thresholdValue: string,
  message: string,
): RuntimePromotionCheck {
  return {
    checkId,
    status: "requires_human_approval",
    observedValue,
    thresholdValue,
    message,
  };
}

function parseEvidenceRef(input: unknown): RuntimeStrategyLabEvidenceRef {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-evidence-ref");
  }
  return {
    kind: readRequiredString(input.kind, "evidenceRefs.kind"),
    ref: readRequiredString(input.ref, "evidenceRefs.ref"),
    ...(typeof input.notes === "string" && input.notes.trim()
      ? { notes: input.notes.trim() }
      : {}),
  };
}

function parseImplementationReference(
  input: unknown,
): RuntimeResearchPromotionRequest["implementationReference"] {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-implementation-reference");
  }
  return {
    kind: readEnum(input.kind, "implementationReference.kind", [
      "pull_request",
      "issue",
      "commit",
    ]) as "pull_request" | "issue" | "commit",
    ref: readRequiredString(input.ref, "implementationReference.ref"),
    ...(typeof input.mergedAt === "string" && input.mergedAt.trim()
      ? { mergedAt: input.mergedAt.trim() }
      : {}),
    ...(typeof input.revision === "string" && input.revision.trim()
      ? { revision: input.revision.trim() }
      : {}),
    ...(typeof input.notes === "string" && input.notes.trim()
      ? { notes: input.notes.trim() }
      : {}),
  };
}

function parseApproval(input: unknown): RuntimeResearchHumanApprovalRecord {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-strategy-lab-approval");
  }
  return {
    targetMode: readEnum(input.targetMode, "approvals.targetMode", [
      "shadow",
      "paper",
      "limited_live",
      "broad_live",
    ]) as RuntimeResearchPolicyTargetMode,
    approvedBy: readRequiredString(input.approvedBy, "approvals.approvedBy"),
    approvedAt: readRequiredString(input.approvedAt, "approvals.approvedAt"),
    ...(typeof input.notes === "string" && input.notes.trim()
      ? { notes: input.notes.trim() }
      : {}),
  };
}

function parseRuntimeScorecardGate(input: unknown): RuntimeScorecardGate {
  if (!isRecord(input)) {
    return {};
  }
  return {
    ...(typeof input.sourceMode === "string"
      ? { sourceMode: input.sourceMode }
      : {}),
    ...(typeof input.targetMode === "string"
      ? { targetMode: input.targetMode }
      : {}),
    ...(typeof input.status === "string" ? { status: input.status } : {}),
  };
}

function readState(
  value: unknown,
  field: string,
): RuntimeStrategyLabPromotionState {
  return readEnum(value, field, [
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
  ]) as RuntimeStrategyLabPromotionState;
}

function readEnum(value: unknown, field: string, allowed: string[]): string {
  const parsed = readRequiredString(value, field);
  if (!allowed.includes(parsed)) {
    throw new Error(`invalid-runtime-strategy-lab-${field}`);
  }
  return parsed;
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = String(value ?? "").trim();
  if (!parsed) {
    throw new Error(`invalid-runtime-strategy-lab-${field}`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
