import { createHash } from "node:crypto";
import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchPolicyGateArtifact,
  parseRuntimeResearchReproducibilityBundleRecord,
  parseRuntimeStrategySpec,
  type RuntimeAssetListingState,
  type RuntimeAssetRecord,
  type RuntimeBacktestReport,
  type RuntimeOnboardingState,
  type RuntimeResearchEvidenceBundleRecord,
  type RuntimeResearchHumanApprovalRecord,
  type RuntimeResearchPolicyGateArtifact,
  type RuntimeResearchPolicyGateStatus,
  type RuntimeResearchPolicyTargetMode,
  type RuntimeResearchReproducibilityBundleRecord,
  type RuntimeStrategySpec,
} from "../contracts/autonomous_runtime.js";
import {
  getRuntimeVenueCapability,
  runtimeVenueSupportsMode,
} from "../venues/catalog.js";
import type {
  RuntimeResearchImplementationPlan,
  RuntimeResearchSynthesisArtifact,
  RuntimeResearchSynthesisEvaluationPlan,
} from "./synthesis.js";
import type { RuntimeResearchCandidateTriageArtifact } from "./triage.js";

export type RuntimeResearchPolicyGateRequest = {
  synthesis: RuntimeResearchSynthesisArtifact;
  triage: RuntimeResearchCandidateTriageArtifact;
  assetRecords?: RuntimeAssetRecord[];
  backtestReport?: RuntimeBacktestReport;
  reproducibilityBundle?: RuntimeResearchReproducibilityBundleRecord;
  evidenceBundles?: RuntimeResearchEvidenceBundleRecord[];
  approvals?: RuntimeResearchHumanApprovalRecord[];
  limitedLiveCanaryPassed?: boolean;
  limitedLiveSoakPassed?: boolean;
};

type RuntimeResearchPolicyGateCheck =
  RuntimeResearchPolicyGateArtifact["gates"][number]["checks"][number];
type RuntimeResearchPolicyGateDecision =
  RuntimeResearchPolicyGateArtifact["gates"][number];

type RequiredVenueStateMap = Record<
  RuntimeResearchPolicyTargetMode,
  RuntimeOnboardingState
>;
type RequiredAssetStateMap = Record<
  RuntimeResearchPolicyTargetMode,
  RuntimeAssetListingState
>;

const VENUE_ONBOARDING_ORDER: RuntimeOnboardingState[] = [
  "candidate",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
  "paused",
  "deprecated",
];

const ASSET_LISTING_ORDER: RuntimeAssetListingState[] = [
  "candidate",
  "shadow",
  "paper",
  "live",
  "paused",
  "deprecated",
];

const REQUIRED_VENUE_STATE: RequiredVenueStateMap = {
  shadow: "shadow_ready",
  paper: "paper_ready",
  limited_live: "limited_live_ready",
  broad_live: "broad_live_ready",
};

const REQUIRED_ASSET_STATE: RequiredAssetStateMap = {
  shadow: "shadow",
  paper: "paper",
  limited_live: "live",
  broad_live: "live",
};

const HUMAN_APPROVAL_TARGETS = new Set<RuntimeResearchPolicyTargetMode>([
  "paper",
  "limited_live",
  "broad_live",
]);

const UNSAFE_PATTERN_RULES = [
  {
    id: "martingale",
    pattern: /\bmartingale\b|doubling down|double-down/i,
    reason:
      "Martingale or doubling-down strategies are not allowed for agent-generated promotion.",
  },
  {
    id: "unbounded_leverage",
    pattern: /unbounded leverage|infinite leverage|leveraged loop/i,
    reason:
      "Unbounded leverage strategies are not allowed for agent-generated promotion.",
  },
  {
    id: "guaranteed_edge",
    pattern: /guaranteed alpha|risk[- ]free/i,
    reason: "Claims of guaranteed or risk-free returns fail policy review.",
  },
] as const;

export function parseRuntimeResearchPolicyGateRequest(
  input: unknown,
): RuntimeResearchPolicyGateRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-policy-gate-request");
  }

  const synthesis = parseRuntimeResearchSynthesisArtifact(input.synthesis);
  const triage = parseRuntimeResearchCandidateTriageArtifact(input.triage);

  return {
    synthesis,
    triage,
    ...(Array.isArray(input.assetRecords)
      ? {
          assetRecords: input.assetRecords.map((entry) =>
            parseRuntimeAssetRecord(entry),
          ),
        }
      : {}),
    ...(input.backtestReport
      ? { backtestReport: parseRuntimeBacktestReport(input.backtestReport) }
      : {}),
    ...(input.reproducibilityBundle
      ? {
          reproducibilityBundle:
            parseRuntimeResearchReproducibilityBundleRecord(
              input.reproducibilityBundle,
            ),
        }
      : {}),
    ...(Array.isArray(input.evidenceBundles)
      ? {
          evidenceBundles: input.evidenceBundles.map((entry) =>
            parseRuntimeResearchEvidenceBundleRecord(entry),
          ),
        }
      : {}),
    ...(Array.isArray(input.approvals)
      ? {
          approvals: input.approvals.map((entry) =>
            parseRuntimeResearchHumanApprovalRecord(entry),
          ),
        }
      : {}),
    ...(typeof input.limitedLiveCanaryPassed === "boolean"
      ? { limitedLiveCanaryPassed: input.limitedLiveCanaryPassed }
      : {}),
    ...(typeof input.limitedLiveSoakPassed === "boolean"
      ? { limitedLiveSoakPassed: input.limitedLiveSoakPassed }
      : {}),
  };
}

export function buildRuntimeResearchPolicyGate(input: {
  request: RuntimeResearchPolicyGateRequest;
}): RuntimeResearchPolicyGateArtifact {
  const { request } = input;
  const synthesis = request.synthesis;
  const spec = synthesis.strategySpecDraft;
  const approvals = new Map(
    (request.approvals ?? []).map((approval) => [
      approval.targetMode,
      approval,
    ]),
  );
  const bannedPatterns = collectBannedPatterns(synthesis);
  const paperEvidence = findEvidenceBundle(request.evidenceBundles, {
    strategyKey: spec.strategyKey,
    promotionTarget: "paper",
    acceptedStatuses: new Set(["ready_for_review", "approved"]),
  });
  const limitedLiveEvidence = findEvidenceBundle(request.evidenceBundles, {
    strategyKey: spec.strategyKey,
    promotionTarget: "limited_live",
    acceptedStatuses: new Set(["approved"]),
  });

  const shadowChecks = [
    buildTriageCheck(request.triage),
    buildCitationCheck(synthesis),
    buildUnsafePatternCheck(bannedPatterns),
    buildStrategyModeCheck(spec, "shadow"),
    buildVenueCapabilityCheck(synthesis, spec, "shadow"),
    buildVenueOnboardingCheck(spec, "shadow"),
    buildAssetReadinessCheck(
      request.assetRecords ?? [],
      synthesis,
      spec,
      "shadow",
    ),
  ];
  const shadowGate = finalizeGate({
    targetMode: "shadow",
    checks: shadowChecks,
    approval: approvals.get("shadow"),
  });

  const paperChecks = [
    buildPrerequisiteGateCheck("shadow-gate", "shadow", shadowGate),
    buildStrategyModeCheck(spec, "paper"),
    buildVenueCapabilityCheck(synthesis, spec, "paper"),
    buildVenueOnboardingCheck(spec, "paper"),
    buildAssetReadinessCheck(
      request.assetRecords ?? [],
      synthesis,
      spec,
      "paper",
    ),
    buildBacktestCheck(request.backtestReport),
    buildBacktestPromotionCheck(request.backtestReport),
    buildReproducibilityCheck(request.reproducibilityBundle),
    buildPaperEvidenceCheck(paperEvidence),
  ];
  const paperGate = finalizeGate({
    targetMode: "paper",
    checks: paperChecks,
    approval: approvals.get("paper"),
  });

  const limitedLiveChecks = [
    buildPrerequisiteGateCheck("paper-gate", "paper", paperGate),
    buildStrategyModeCheck(spec, "limited_live"),
    buildVenueCapabilityCheck(synthesis, spec, "limited_live"),
    buildVenueOnboardingCheck(spec, "limited_live"),
    buildAssetReadinessCheck(
      request.assetRecords ?? [],
      synthesis,
      spec,
      "limited_live",
    ),
    buildLaneAllowlistCheck(spec),
    buildHumanApprovalPolicyCheck(spec),
    buildLimitedLiveConstraintCheck(spec),
    buildLimitedLiveEvidenceCheck(limitedLiveEvidence),
  ];
  const limitedLiveGate = finalizeGate({
    targetMode: "limited_live",
    checks: limitedLiveChecks,
    approval: approvals.get("limited_live"),
  });

  const broadLiveChecks = [
    buildPrerequisiteGateCheck(
      "limited-live-gate",
      "limited_live",
      limitedLiveGate,
    ),
    buildStrategyModeCheck(spec, "broad_live"),
    buildVenueCapabilityCheck(synthesis, spec, "broad_live"),
    buildVenueOnboardingCheck(spec, "broad_live"),
    buildAssetReadinessCheck(
      request.assetRecords ?? [],
      synthesis,
      spec,
      "broad_live",
    ),
    buildLimitedLiveCanaryCheck(request.limitedLiveCanaryPassed === true),
    buildLimitedLiveSoakCheck(request.limitedLiveSoakPassed === true),
  ];
  const broadLiveGate = finalizeGate({
    targetMode: "broad_live",
    checks: broadLiveChecks,
    approval: approvals.get("broad_live"),
  });

  const summary = buildSummary([
    shadowGate,
    paperGate,
    limitedLiveGate,
    broadLiveGate,
  ]);
  const policyGateId = `policy_${hash(
    JSON.stringify({
      synthesisId: synthesis.synthesisId,
      triageId: request.triage.triageId,
      gateStatuses: [
        shadowGate.status,
        paperGate.status,
        limitedLiveGate.status,
        broadLiveGate.status,
      ],
    }),
  )}`;

  return parseRuntimeResearchPolicyGateArtifact({
    schemaVersion: "v1",
    policyGateId,
    generatedAt: new Date().toISOString(),
    synthesisId: synthesis.synthesisId,
    hypothesisId: synthesis.hypothesis.hypothesisId,
    triageId: request.triage.triageId,
    candidateDisposition: request.triage.disposition,
    bannedPatterns,
    gates: [shadowGate, paperGate, limitedLiveGate, broadLiveGate],
    summary,
  });
}

export function buildRuntimeResearchPolicyGateMarkdown(
  artifact: RuntimeResearchPolicyGateArtifact,
): string {
  const lines = [
    `# Strategy policy gate for ${artifact.hypothesisId}`,
    "",
    `- Policy gate id: ${artifact.policyGateId}`,
    `- Generated at: ${artifact.generatedAt}`,
    `- Candidate disposition: ${artifact.candidateDisposition}`,
    `- Banned patterns: ${artifact.bannedPatterns.length > 0 ? artifact.bannedPatterns.join(", ") : "none"}`,
    "",
    "## Summary",
    "",
  ];

  for (const entry of artifact.summary) {
    lines.push(`- ${entry}`);
  }

  for (const gate of artifact.gates) {
    lines.push(
      "",
      `## ${formatTargetMode(gate.targetMode)}`,
      "",
      `- Status: ${gate.status}`,
      `- Automated checks passed: ${gate.automatedChecksPassed ? "yes" : "no"}`,
      `- Requires human approval: ${gate.requiresHumanApproval ? "yes" : "no"}`,
      `- Eligible: ${gate.eligible ? "yes" : "no"}`,
      `- Summary: ${gate.summary}`,
    );
    if (gate.approval) {
      lines.push(
        `- Approval: ${gate.approval.approvedBy} at ${gate.approval.approvedAt}`,
      );
    }
    lines.push("", "### Checks", "");
    for (const check of gate.checks) {
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
  }

  return lines.join("\n");
}

export function requireRuntimeResearchPolicyGatePass(input: {
  artifact: RuntimeResearchPolicyGateArtifact;
  targetMode: RuntimeResearchPolicyTargetMode;
}): RuntimeResearchPolicyGateArtifact["gates"][number] {
  const gate = input.artifact.gates.find(
    (entry) => entry.targetMode === input.targetMode,
  );
  if (!gate || gate.status !== "pass") {
    throw new Error(
      `runtime-research-policy-blocked:${input.targetMode}:${gate?.status ?? "missing"}`,
    );
  }
  return gate;
}

function buildSummary(
  gates: RuntimeResearchPolicyGateArtifact["gates"],
): string[] {
  return gates.map(
    (gate) =>
      `${formatTargetMode(gate.targetMode)}: ${gate.status} (${gate.summary})`,
  );
}

function buildTriageCheck(
  triage: RuntimeResearchCandidateTriageArtifact,
): RuntimeResearchPolicyGateCheck {
  return triage.disposition === "archive"
    ? blockedCheck(
        "triage-disposition",
        triage.disposition,
        "promote_to_candidate|review",
        "Archived candidates cannot progress into runtime validation.",
      )
    : passCheck(
        "triage-disposition",
        triage.disposition,
        "promote_to_candidate|review",
        "Candidate cleared triage and remains eligible for bounded progression.",
      );
}

function buildCitationCheck(
  synthesis: RuntimeResearchSynthesisArtifact,
): RuntimeResearchPolicyGateCheck {
  return synthesis.hypothesis.sourceCitations.length > 0
    ? passCheck(
        "source-provenance",
        String(synthesis.hypothesis.sourceCitations.length),
        ">=1 citations",
        "Candidate includes source provenance for the underlying hypothesis.",
      )
    : blockedCheck(
        "source-provenance",
        "0",
        ">=1 citations",
        "Candidates without source provenance fail closed before shadow activation.",
      );
}

function buildUnsafePatternCheck(
  bannedPatterns: string[],
): RuntimeResearchPolicyGateCheck {
  return bannedPatterns.length === 0
    ? passCheck(
        "unsafe-patterns",
        "none",
        "none",
        "No banned strategy classes or unsafe claims were detected.",
      )
    : blockedCheck(
        "unsafe-patterns",
        bannedPatterns.join(", "),
        "none",
        "Unsafe or unsupported strategy classes are blocked from promotion.",
      );
}

function buildStrategyModeCheck(
  spec: RuntimeStrategySpec,
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeResearchPolicyGateCheck {
  const requiredMode = toRuntimeMode(targetMode);
  return spec.supportedModes.includes(requiredMode)
    ? passCheck(
        "strategy-supported-mode",
        spec.supportedModes.join(", "),
        requiredMode,
        `StrategySpec explicitly supports ${requiredMode}.`,
      )
    : blockedCheck(
        "strategy-supported-mode",
        spec.supportedModes.join(", ") || "none",
        requiredMode,
        `StrategySpec does not support ${requiredMode}, so promotion fails closed.`,
      );
}

function buildVenueCapabilityCheck(
  synthesis: RuntimeResearchSynthesisArtifact,
  spec: RuntimeStrategySpec,
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeResearchPolicyGateCheck {
  const reasons: string[] = [];
  for (const venue of spec.supportedVenues) {
    const capability = getRuntimeVenueCapability(venue.venueKey);
    if (!capability) {
      reasons.push(`missing-capability:${venue.venueKey}`);
      continue;
    }
    if (!capability.marketTypes.includes(synthesis.evaluationPlan.marketType)) {
      reasons.push(
        `unsupported-market-type:${venue.venueKey}:${synthesis.evaluationPlan.marketType}`,
      );
    }
    if (!runtimeVenueSupportsMode(capability, toRuntimeMode(targetMode))) {
      reasons.push(
        `unsupported-mode:${venue.venueKey}:${toRuntimeMode(targetMode)}`,
      );
    }
  }
  return reasons.length === 0
    ? passCheck(
        "venue-capability",
        spec.supportedVenues.map((entry) => entry.venueKey).join(", "),
        `${synthesis.evaluationPlan.marketType}/${toRuntimeMode(targetMode)}`,
        "All supported venues advertise the required market type and runtime mode.",
      )
    : blockedCheck(
        "venue-capability",
        reasons.join(", "),
        `${synthesis.evaluationPlan.marketType}/${toRuntimeMode(targetMode)}`,
        "Unsupported venue or market-type combinations are blocked automatically.",
      );
}

function buildVenueOnboardingCheck(
  spec: RuntimeStrategySpec,
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeResearchPolicyGateCheck {
  const requiredState = REQUIRED_VENUE_STATE[targetMode];
  const reasons = spec.supportedVenues
    .filter(
      (venue) =>
        !stateAtLeast(
          VENUE_ONBOARDING_ORDER,
          venue.onboardingState,
          requiredState,
        ),
    )
    .map((venue) => `${venue.venueKey}:${venue.onboardingState}`);

  return reasons.length === 0
    ? passCheck(
        "venue-onboarding",
        spec.supportedVenues
          .map((venue) => `${venue.venueKey}:${venue.onboardingState}`)
          .join(", "),
        requiredState,
        `Venue onboarding states satisfy the ${targetMode} threshold.`,
      )
    : blockedCheck(
        "venue-onboarding",
        reasons.join(", "),
        requiredState,
        `Venues below ${requiredState} cannot progress to ${targetMode}.`,
      );
}

function buildAssetReadinessCheck(
  assetRecords: RuntimeAssetRecord[],
  synthesis: RuntimeResearchSynthesisArtifact,
  spec: RuntimeStrategySpec,
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeResearchPolicyGateCheck {
  const requiredState = REQUIRED_ASSET_STATE[targetMode];
  const requestedAssets = synthesis.evaluationPlan.assetKeys;
  const recordMap = new Map(
    assetRecords.map((record) => [record.assetKey, record]),
  );
  const reasons: string[] = [];

  for (const assetKey of requestedAssets) {
    const record = recordMap.get(assetKey);
    if (!record) {
      reasons.push(`missing:${assetKey}`);
      continue;
    }
    if (
      !stateAtLeast(ASSET_LISTING_ORDER, record.listingState, requiredState)
    ) {
      reasons.push(`asset:${assetKey}:${record.listingState}`);
    }
    for (const venue of spec.supportedVenues) {
      const mapping = record.venueMappings.find(
        (entry) => entry.venueKey === venue.venueKey,
      );
      if (!mapping) {
        reasons.push(`mapping-missing:${assetKey}:${venue.venueKey}`);
        continue;
      }
      if (
        !stateAtLeast(ASSET_LISTING_ORDER, mapping.listingState, requiredState)
      ) {
        reasons.push(
          `mapping:${assetKey}:${venue.venueKey}:${mapping.listingState}`,
        );
      }
    }
  }

  return reasons.length === 0
    ? passCheck(
        "asset-readiness",
        requestedAssets.join(", "),
        requiredState,
        `Asset registry coverage satisfies the ${targetMode} threshold.`,
      )
    : blockedCheck(
        "asset-readiness",
        reasons.join(", "),
        requiredState,
        `Unsupported or unready asset and venue mappings fail closed for ${targetMode}.`,
      );
}

function buildBacktestCheck(
  backtestReport: RuntimeBacktestReport | undefined,
): RuntimeResearchPolicyGateCheck {
  return backtestReport
    ? passCheck(
        "backtest-report",
        backtestReport.reportId,
        "candidate-specific backtest",
        "A candidate-specific backtest report is available.",
      )
    : blockedCheck(
        "backtest-report",
        "missing",
        "candidate-specific backtest",
        "Paper and live consideration require a candidate-specific backtest report.",
      );
}

function buildBacktestPromotionCheck(
  backtestReport: RuntimeBacktestReport | undefined,
): RuntimeResearchPolicyGateCheck {
  if (!backtestReport) {
    return blockedCheck(
      "backtest-promotion-eligible",
      "missing",
      "true",
      "Promotion cannot proceed without a backtest verdict.",
    );
  }

  return backtestReport.promotionEligible
    ? passCheck(
        "backtest-promotion-eligible",
        "true",
        "true",
        "Backtest report cleared the promotion gate.",
      )
    : blockedCheck(
        "backtest-promotion-eligible",
        "false",
        "true",
        `Backtest report remains blocked: ${joinReasons(backtestReport.blockingReasons)}`,
      );
}

function buildReproducibilityCheck(
  reproducibilityBundle: RuntimeResearchReproducibilityBundleRecord | undefined,
): RuntimeResearchPolicyGateCheck {
  if (!reproducibilityBundle) {
    return blockedCheck(
      "reproducibility",
      "missing",
      "latest verification passed",
      "Promotion requires a reproducibility bundle with a passing verification result.",
    );
  }
  const passed = reproducibilityBundle.latestVerification?.passed === true;
  return passed
    ? passCheck(
        "reproducibility",
        reproducibilityBundle.reproducibilityBundleId,
        "latest verification passed",
        "Reproducibility verification passed for the candidate evidence bundle.",
      )
    : blockedCheck(
        "reproducibility",
        reproducibilityBundle.reproducibilityBundleId,
        "latest verification passed",
        "Reproducibility verification has not passed yet.",
      );
}

function buildPaperEvidenceCheck(
  evidenceBundle: RuntimeResearchEvidenceBundleRecord | undefined,
): RuntimeResearchPolicyGateCheck {
  return evidenceBundle
    ? passCheck(
        "paper-evidence-bundle",
        `${evidenceBundle.evidenceBundleId}:${evidenceBundle.status}`,
        "ready_for_review|approved",
        "Paper promotion has an auditable evidence bundle attached.",
      )
    : blockedCheck(
        "paper-evidence-bundle",
        "missing",
        "ready_for_review|approved",
        "Paper consideration requires a shadow-to-paper evidence bundle.",
      );
}

function buildLaneAllowlistCheck(
  spec: RuntimeStrategySpec,
): RuntimeResearchPolicyGateCheck {
  return spec.promotionPolicy.liveLaneAllowlist.length > 0
    ? passCheck(
        "live-lane-allowlist",
        spec.promotionPolicy.liveLaneAllowlist.join(", "),
        ">=1 lane",
        "Live-capable candidates are restricted to explicit allowlisted lanes.",
      )
    : blockedCheck(
        "live-lane-allowlist",
        "none",
        ">=1 lane",
        "Real-money promotion requires an explicit live lane allowlist.",
      );
}

function buildHumanApprovalPolicyCheck(
  spec: RuntimeStrategySpec,
): RuntimeResearchPolicyGateCheck {
  return spec.promotionPolicy.requiresHumanApproval
    ? passCheck(
        "human-approval-policy",
        "true",
        "true",
        "Strategy promotion policy preserves human approval at money-state boundaries.",
      )
    : blockedCheck(
        "human-approval-policy",
        "false",
        "true",
        "Agent-generated strategies must require human approval before real-money promotion.",
      );
}

function buildLimitedLiveConstraintCheck(
  spec: RuntimeStrategySpec,
): RuntimeResearchPolicyGateCheck {
  return spec.promotionPolicy.limitedLiveOnly
    ? passCheck(
        "limited-live-only",
        "true",
        "true",
        "Candidate remains bounded to limited-live posture by policy.",
      )
    : blockedCheck(
        "limited-live-only",
        "false",
        "true",
        "Newly generated strategies cannot skip bounded limited-live validation.",
      );
}

function buildLimitedLiveEvidenceCheck(
  evidenceBundle: RuntimeResearchEvidenceBundleRecord | undefined,
): RuntimeResearchPolicyGateCheck {
  return evidenceBundle
    ? passCheck(
        "limited-live-evidence-bundle",
        `${evidenceBundle.evidenceBundleId}:${evidenceBundle.status}`,
        "approved",
        "Limited-live consideration has an approved evidence bundle.",
      )
    : blockedCheck(
        "limited-live-evidence-bundle",
        "missing",
        "approved",
        "Limited-live consideration requires an approved evidence bundle.",
      );
}

function buildLimitedLiveCanaryCheck(
  passed: boolean,
): RuntimeResearchPolicyGateCheck {
  return passed
    ? passCheck(
        "limited-live-canary",
        "passed",
        "passed",
        "A bounded limited-live canary has completed successfully.",
      )
    : blockedCheck(
        "limited-live-canary",
        "missing_or_failed",
        "passed",
        "Broad-live promotion requires a successful limited-live canary.",
      );
}

function buildLimitedLiveSoakCheck(
  passed: boolean,
): RuntimeResearchPolicyGateCheck {
  return passed
    ? passCheck(
        "limited-live-soak",
        "passed",
        "passed",
        "Limited-live soak evidence is available for broader rollout review.",
      )
    : blockedCheck(
        "limited-live-soak",
        "missing_or_failed",
        "passed",
        "Broad-live promotion requires a successful limited-live soak.",
      );
}

function buildPrerequisiteGateCheck(
  checkId: string,
  targetMode: RuntimeResearchPolicyTargetMode,
  gate: RuntimeResearchPolicyGateDecision,
): RuntimeResearchPolicyGateCheck {
  return gate.status === "pass"
    ? passCheck(
        checkId,
        gate.status,
        "pass",
        `${formatTargetMode(targetMode)} gate already passed.`,
      )
    : blockedCheck(
        checkId,
        gate.status,
        "pass",
        `${formatTargetMode(targetMode)} gate must pass before continuing.`,
      );
}

function finalizeGate(input: {
  targetMode: RuntimeResearchPolicyTargetMode;
  checks: RuntimeResearchPolicyGateCheck[];
  approval?: RuntimeResearchHumanApprovalRecord;
}): RuntimeResearchPolicyGateDecision {
  const automatedChecksPassed = input.checks.every(
    (check) => check.status === "pass",
  );
  const requiresHumanApproval = HUMAN_APPROVAL_TARGETS.has(input.targetMode);
  const approval = input.approval;
  const checks = requiresHumanApproval
    ? [
        ...input.checks,
        approval
          ? passCheck(
              "human-approval",
              `${approval.approvedBy}:${approval.approvedAt}`,
              "recorded",
              `${formatTargetMode(input.targetMode)} approval has been recorded.`,
            )
          : requiresHumanApprovalCheck(input.targetMode),
      ]
    : input.checks;

  let status: RuntimeResearchPolicyGateStatus = automatedChecksPassed
    ? "pass"
    : "blocked";
  if (automatedChecksPassed && requiresHumanApproval && !approval) {
    status = "requires_human_approval";
  }

  const summary =
    status === "pass"
      ? `${formatTargetMode(input.targetMode)} is cleared under current policy.`
      : status === "requires_human_approval"
        ? `${formatTargetMode(input.targetMode)} passed automated checks but still requires explicit human approval.`
        : `${formatTargetMode(input.targetMode)} is blocked by policy gates.`;

  return {
    targetMode: input.targetMode,
    automatedChecksPassed,
    requiresHumanApproval,
    eligible: status === "pass",
    status,
    summary,
    checks,
    ...(approval ? { approval } : {}),
  };
}

function findEvidenceBundle(
  evidenceBundles: RuntimeResearchEvidenceBundleRecord[] | undefined,
  input: {
    strategyKey: string;
    promotionTarget: string;
    acceptedStatuses: Set<RuntimeResearchEvidenceBundleRecord["status"]>;
  },
): RuntimeResearchEvidenceBundleRecord | undefined {
  const candidates = (evidenceBundles ?? [])
    .filter(
      (bundle) =>
        bundle.strategyKey === input.strategyKey &&
        bundle.promotionTarget === input.promotionTarget &&
        input.acceptedStatuses.has(bundle.status),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return candidates[0];
}

function collectBannedPatterns(
  synthesis: RuntimeResearchSynthesisArtifact,
): string[] {
  const searchable = [
    synthesis.briefTitle,
    synthesis.expectedMechanism,
    synthesis.hypothesis.title,
    synthesis.hypothesis.thesis,
    synthesis.strategySpecDraft.summary,
    ...synthesis.hypothesis.tags,
    ...synthesis.strategySpecDraft.tags,
  ].join("\n");
  const matches = UNSAFE_PATTERN_RULES.filter((rule) =>
    rule.pattern.test(searchable),
  ).map((rule) => rule.id);
  return Array.from(new Set(matches)).slice(0, 16);
}

function requiresHumanApprovalCheck(
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeResearchPolicyGateCheck {
  return {
    checkId: "human-approval",
    status: "requires_human_approval",
    observedValue: "missing",
    thresholdValue: "recorded",
    message: `${formatTargetMode(targetMode)} requires explicit human approval before promotion.`,
  };
}

function passCheck(
  checkId: string,
  observedValue: string,
  thresholdValue: string,
  message: string,
): RuntimeResearchPolicyGateCheck {
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
): RuntimeResearchPolicyGateCheck {
  return {
    checkId,
    status: "blocked",
    observedValue,
    thresholdValue,
    message,
  };
}

function stateAtLeast<T extends string>(
  order: readonly T[],
  actual: T,
  minimum: T,
): boolean {
  return order.indexOf(actual) >= order.indexOf(minimum);
}

function toRuntimeMode(
  targetMode: RuntimeResearchPolicyTargetMode,
): RuntimeStrategySpec["supportedModes"][number] {
  if (targetMode === "shadow") return "shadow";
  if (targetMode === "paper") return "paper";
  return "live";
}

function formatTargetMode(targetMode: RuntimeResearchPolicyTargetMode): string {
  return targetMode
    .split("_")
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function joinReasons(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join(", ") : "none";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function parseRuntimeResearchCandidateTriageArtifact(
  input: unknown,
): RuntimeResearchCandidateTriageArtifact {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-artifact");
  }
  return {
    triageId: readRequiredString(input.triageId, "triageId"),
    generatedAt: readRequiredString(input.generatedAt, "generatedAt"),
    synthesisId: readRequiredString(input.synthesisId, "synthesisId"),
    hypothesisId: readRequiredString(input.hypothesisId, "hypothesisId"),
    disposition: readRequiredString(
      input.disposition,
      "disposition",
    ) as RuntimeResearchCandidateTriageArtifact["disposition"],
    recommendedHypothesisStatus: readRequiredString(
      input.recommendedHypothesisStatus,
      "recommendedHypothesisStatus",
    ) as RuntimeResearchCandidateTriageArtifact["recommendedHypothesisStatus"],
    noveltyScoreBps: readRequiredNumber(
      input.noveltyScoreBps,
      "noveltyScoreBps",
    ),
    evidenceScoreBps: readRequiredNumber(
      input.evidenceScoreBps,
      "evidenceScoreBps",
    ),
    venueFitScoreBps: readRequiredNumber(
      input.venueFitScoreBps,
      "venueFitScoreBps",
    ),
    implementationCostScoreBps: readRequiredNumber(
      input.implementationCostScoreBps,
      "implementationCostScoreBps",
    ),
    priorityScoreBps: readRequiredNumber(
      input.priorityScoreBps,
      "priorityScoreBps",
    ),
    duplicateMatches: Array.isArray(input.duplicateMatches)
      ? input.duplicateMatches.map((entry) => parseDuplicateMatch(entry))
      : [],
    rationale: normalizeStringArray(input.rationale),
    ...(typeof input.archivedHypothesisId === "string" &&
    input.archivedHypothesisId.trim()
      ? { archivedHypothesisId: input.archivedHypothesisId.trim() }
      : {}),
  };
}

function parseDuplicateMatch(
  input: unknown,
): RuntimeResearchCandidateTriageArtifact["duplicateMatches"][number] {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-triage-duplicate-match");
  }
  return {
    matchType: readRequiredString(
      input.matchType,
      "duplicateMatches.matchType",
    ) as RuntimeResearchCandidateTriageArtifact["duplicateMatches"][number]["matchType"],
    source: readRequiredString(
      input.source,
      "duplicateMatches.source",
    ) as RuntimeResearchCandidateTriageArtifact["duplicateMatches"][number]["source"],
    strategyKey: readRequiredString(
      input.strategyKey,
      "duplicateMatches.strategyKey",
    ),
    similarityBps: readRequiredNumber(
      input.similarityBps,
      "duplicateMatches.similarityBps",
    ),
    reasons: normalizeStringArray(input.reasons),
  };
}

function parseRuntimeResearchSynthesisArtifact(
  input: unknown,
): RuntimeResearchSynthesisArtifact {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-synthesis-artifact");
  }
  return {
    synthesisId: readRequiredString(input.synthesisId, "synthesisId"),
    generatedAt: readRequiredString(input.generatedAt, "generatedAt"),
    briefId: readRequiredString(input.briefId, "briefId"),
    briefTitle: readRequiredString(input.briefTitle, "briefTitle"),
    expectedMechanism: readRequiredString(
      input.expectedMechanism,
      "expectedMechanism",
    ),
    hypothesis: parseRuntimeResearchHypothesisRecord(input.hypothesis),
    strategySpecDraft: parseRuntimeStrategySpec(input.strategySpecDraft),
    evaluationPlan: parseEvaluationPlan(input.evaluationPlan),
    implementationPlan: parseImplementationPlan(input.implementationPlan),
    riskNotes: normalizeStringArray(input.riskNotes),
    citations: Array.isArray(input.citations)
      ? input.citations.map((entry) => parseCitation(entry))
      : [],
  };
}

function parseEvaluationPlan(
  input: unknown,
): RuntimeResearchSynthesisEvaluationPlan {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-policy-evaluation-plan");
  }
  return {
    marketType: readRequiredString(
      input.marketType,
      "evaluationPlan.marketType",
    ) as RuntimeResearchSynthesisEvaluationPlan["marketType"],
    venueKey: readRequiredString(input.venueKey, "evaluationPlan.venueKey"),
    pairSymbol: readRequiredString(
      input.pairSymbol,
      "evaluationPlan.pairSymbol",
    ),
    assetKeys: normalizeStringArray(input.assetKeys),
    datasetRequirements: normalizeStringArray(input.datasetRequirements),
    requiredFeatureKeys: normalizeStringArray(input.requiredFeatureKeys),
    requiredRegimeKeys: normalizeStringArray(input.requiredRegimeKeys),
    backtestPlan: isRecord(input.backtestPlan)
      ? {
          windowMode: "rolling",
          trainingWindowObservations: readRequiredNumber(
            input.backtestPlan.trainingWindowObservations,
            "evaluationPlan.backtestPlan.trainingWindowObservations",
          ),
          testingWindowObservations: readRequiredNumber(
            input.backtestPlan.testingWindowObservations,
            "evaluationPlan.backtestPlan.testingWindowObservations",
          ),
          stepObservations: readRequiredNumber(
            input.backtestPlan.stepObservations,
            "evaluationPlan.backtestPlan.stepObservations",
          ),
          purgeObservations: readRequiredNumber(
            input.backtestPlan.purgeObservations,
            "evaluationPlan.backtestPlan.purgeObservations",
          ),
          baselineStrategies: normalizeStringArray(
            input.backtestPlan.baselineStrategies,
          ),
        }
      : (() => {
          throw new Error("invalid-runtime-research-policy-backtest-plan");
        })(),
    paperPlan: isRecord(input.paperPlan)
      ? {
          required: true,
          minPaperRuns: readRequiredNumber(
            input.paperPlan.minPaperRuns,
            "evaluationPlan.paperPlan.minPaperRuns",
          ),
          notes: normalizeStringArray(input.paperPlan.notes),
        }
      : (() => {
          throw new Error("invalid-runtime-research-policy-paper-plan");
        })(),
    successCriteria: normalizeStringArray(input.successCriteria),
    failureModes: normalizeStringArray(input.failureModes),
  };
}

function parseImplementationPlan(
  input: unknown,
): RuntimeResearchImplementationPlan {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-policy-implementation-plan");
  }
  return {
    branchName: readRequiredString(
      input.branchName,
      "implementationPlan.branchName",
    ),
    issueTitle: readRequiredString(
      input.issueTitle,
      "implementationPlan.issueTitle",
    ),
    issueBody: readRequiredString(
      input.issueBody,
      "implementationPlan.issueBody",
    ),
    scaffoldFiles: Array.isArray(input.scaffoldFiles)
      ? input.scaffoldFiles.map((entry) =>
          parsePlanEntry(entry, "scaffoldFiles"),
        )
      : [],
    testFiles: Array.isArray(input.testFiles)
      ? input.testFiles.map((entry) => parsePlanEntry(entry, "testFiles"))
      : [],
    validationCommands: normalizeStringArray(input.validationCommands),
  };
}

function parsePlanEntry(
  input: unknown,
  path: string,
): RuntimeResearchImplementationPlan["scaffoldFiles"][number] {
  if (!isRecord(input)) {
    throw new Error(`invalid-runtime-research-policy-${path}-entry`);
  }
  return {
    path: readRequiredString(input.path, `${path}.path`),
    purpose: readRequiredString(input.purpose, `${path}.purpose`),
  };
}

function parseCitation(
  input: unknown,
): RuntimeResearchSynthesisArtifact["citations"][number] {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-policy-citation");
  }
  return {
    sourceId: readRequiredString(input.sourceId, "citations.sourceId"),
    title: readRequiredString(input.title, "citations.title"),
    canonicalUrl: readRequiredString(
      input.canonicalUrl,
      "citations.canonicalUrl",
    ),
  };
}

function parseRuntimeResearchHumanApprovalRecord(
  input: unknown,
): RuntimeResearchHumanApprovalRecord {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-human-approval-record");
  }
  return {
    targetMode: readRequiredString(
      input.targetMode,
      "approvals.targetMode",
    ) as RuntimeResearchHumanApprovalRecord["targetMode"],
    approvedBy: readRequiredString(input.approvedBy, "approvals.approvedBy"),
    approvedAt: readRequiredString(input.approvedAt, "approvals.approvedAt"),
    ...(typeof input.notes === "string" && input.notes.trim()
      ? { notes: input.notes.trim() }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(value: unknown, path: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`missing-runtime-research-policy-field:${path}`);
  }
  return normalized;
}

function readRequiredNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`invalid-runtime-research-policy-number:${path}`);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}
