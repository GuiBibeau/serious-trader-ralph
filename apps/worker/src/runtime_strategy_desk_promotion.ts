import {
  canTransitionRuntimeStrategyDeskPromotionHandoffState,
  canTransitionRuntimeStrategyDeskScenarioState,
  parseRuntimeDeploymentRecord,
  parseRuntimeStrategyDeskPromotionHandoff,
  parseRuntimeStrategyLabPromotionEvent,
  parseRuntimeStrategyLabPromotionRecord,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import type {
  RuntimeStrategyDeskPromotionHandoff,
  RuntimeStrategyDeskScenarioLeg,
  RuntimeStrategyDeskScenarioManifest,
} from "./runtime_contracts";
import {
  applyRuntimeDeploymentControl,
  upsertRuntimeDeployment,
} from "./runtime_internal";
import {
  getRuntimeStrategyDeskScenarioReportWorkflow,
  getRuntimeStrategyDeskScenarioWorkflow,
} from "./runtime_strategy_desk";
import {
  appendStrategyDeskPromotionHandoffEvent,
  getStrategyDeskExecutionRecipeForBinding,
  getStrategyDeskPromotionHandoff,
  listStrategyDeskExecutionRecipes,
  listStrategyDeskPromotionHandoffEvents,
  listStrategyDeskPromotionHandoffs,
  type StrategyDeskExecutionRecipeRecord,
  type StrategyDeskPromotionHandoffEvent,
  writeStrategyDeskExecutionRecipe,
  writeStrategyDeskPromotionHandoff,
} from "./strategy_desk_handoff_repository";
import { updateStrategyDeskScenarioReviewState } from "./strategy_desk_repository";
import {
  appendStrategyLabPromotionEvent,
  writeStrategyLabPromotion,
} from "./strategy_lab_promotion_repository";
import {
  getStrategyLabSubjectControl,
  writeStrategyLabSubjectControl,
} from "./strategy_lab_readiness_repository";
import type { Env } from "./types";

type StrategyDeskPrepareTargetMode = "limited_live";

type StrategyDeskPromotionAction =
  | "submit"
  | "approve"
  | "reject"
  | "apply"
  | "pause"
  | "kill"
  | "demote"
  | "archive";

type StrategyDeskPromotionBinding =
  RuntimeStrategyDeskPromotionHandoff["bindings"][number];

type StrategyDeskPromotionResult = {
  scenario: RuntimeStrategyDeskScenarioManifest;
  handoff: RuntimeStrategyDeskPromotionHandoff;
  events: StrategyDeskPromotionHandoffEvent[];
  executionRecipes: StrategyDeskExecutionRecipeRecord[];
};

type PromotionDeps = {
  now?: () => string;
  createId?: (prefix: string) => string;
};

const DESK_PROMOTION_SUMMARY_MAX = 3;

function nowIso(deps?: PromotionDeps): string {
  return deps?.now ? deps.now() : new Date().toISOString();
}

function createDeskId(prefix: string, deps?: PromotionDeps): string {
  if (deps?.createId) return deps.createId(prefix);
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function stringOrNull(value: unknown): string | null {
  const parsed = String(value ?? "").trim();
  return parsed ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDecimalToMicros(value: string): bigint {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([0-9]+)(?:\.([0-9]+))?$/);
  if (!match) return 0n;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fraction || "0");
}

function formatMicros(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0");
  return fraction === "000000"
    ? `${whole}`
    : `${whole}.${fraction.replace(/0+$/, "")}`;
}

function addDecimalStrings(values: Array<string | null | undefined>): string {
  const total = values.reduce(
    (sum, value) => sum + parseDecimalToMicros(value ?? "0"),
    0n,
  );
  return formatMicros(total);
}

function summarizeLabels(labels: string[]): string {
  if (labels.length === 0) return "no live legs";
  if (labels.length <= DESK_PROMOTION_SUMMARY_MAX) return labels.join(", ");
  return `${labels.slice(0, DESK_PROMOTION_SUMMARY_MAX).join(", ")} +${labels.length - DESK_PROMOTION_SUMMARY_MAX}`;
}

function legAllowsLimitedLive(leg: RuntimeStrategyDeskScenarioLeg): boolean {
  return (
    leg.enabledModes.includes("live") ||
    leg.enabledModes.includes("limited_live")
  );
}

function buildBindingForLeg(
  scenario: RuntimeStrategyDeskScenarioManifest,
  leg: RuntimeStrategyDeskScenarioLeg,
  targetMode: StrategyDeskPrepareTargetMode,
): StrategyDeskPromotionBinding {
  if (
    legAllowsLimitedLive(leg) &&
    leg.intentFamily === "spot_swap" &&
    leg.pair
  ) {
    return {
      bindingId: `binding_${leg.legId}_runtime`,
      bindingKind: "runtime_deployment",
      legIds: [leg.legId],
      venueKey: leg.venueKey,
      pair: leg.pair,
      targetMode,
      deploymentId: `dep_${scenario.scenarioId}_${leg.legId}_${targetMode}`,
      lane: "safe",
      notes: "Primary spot leg is eligible for bounded live arming.",
    };
  }

  if (
    leg.intentFamily === "prediction_order" ||
    leg.marketType === "prediction"
  ) {
    return {
      bindingId: `binding_${leg.legId}_control`,
      bindingKind: "subject_control",
      legIds: [leg.legId],
      venueKey: leg.venueKey,
      ...(leg.instrumentId ? { instrumentId: leg.instrumentId } : {}),
      targetMode: "paper",
      notes: "Prediction overlay stays paper-bound during bounded live arming.",
    };
  }

  return {
    bindingId: `binding_${leg.legId}_recipe`,
    bindingKind: "worker_execution_recipe",
    legIds: [leg.legId],
    venueKey: leg.venueKey,
    ...(leg.pair ? { pair: leg.pair } : {}),
    ...(leg.instrumentId ? { instrumentId: leg.instrumentId } : {}),
    targetMode: "paper",
    notes:
      "Non-spot execution remains desk-managed and paper-bound for the first live arming pass.",
  };
}

function firstLegForBinding(
  scenario: RuntimeStrategyDeskScenarioManifest,
  binding: StrategyDeskPromotionBinding,
): RuntimeStrategyDeskScenarioLeg {
  const leg = scenario.legs.find((candidate) =>
    binding.legIds.includes(candidate.legId),
  );
  if (!leg) {
    throw new Error(
      `runtime-strategy-desk-handoff-leg-missing:${binding.bindingId}`,
    );
  }
  return leg;
}

function buildBudgetForBinding(
  scenario: RuntimeStrategyDeskScenarioManifest,
  binding: StrategyDeskPromotionBinding,
): Record<string, unknown> {
  const legs = scenario.legs.filter((leg) =>
    binding.legIds.includes(leg.legId),
  );
  return {
    targetNotionalUsd: addDecimalStrings(
      legs.map((leg) => stringOrNull(leg.sizing.targetNotionalUsd)),
    ),
    maxNotionalUsd: addDecimalStrings(
      legs.map((leg) => stringOrNull(leg.sizing.maxNotionalUsd)),
    ),
    reserveUsd: addDecimalStrings(
      legs.map((leg) => stringOrNull(leg.sizing.reserveUsd)),
    ),
    legBudgets: legs.map((leg) => ({
      legId: leg.legId,
      targetNotionalUsd: stringOrNull(leg.sizing.targetNotionalUsd) ?? "0",
      maxNotionalUsd: stringOrNull(leg.sizing.maxNotionalUsd) ?? "0",
      reserveUsd: stringOrNull(leg.sizing.reserveUsd) ?? "0",
    })),
  };
}

function buildRuntimeDeploymentPayload(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  binding: StrategyDeskPromotionBinding;
  leg: RuntimeStrategyDeskScenarioLeg;
  now: string;
}) {
  const budget = buildBudgetForBinding(input.scenario, input.binding);
  const maxNotionalUsd = String(budget.maxNotionalUsd ?? "25");
  const reserveUsd = String(budget.reserveUsd ?? maxNotionalUsd);
  const allocatedUsd = addDecimalStrings([
    reserveUsd,
    String(input.scenario.riskLimits?.maxReservedCapitalUsd ?? "0"),
  ]);
  return parseRuntimeDeploymentRecord({
    schemaVersion: "v1",
    deploymentId: input.binding.deploymentId,
    strategyKey: input.scenario.strategyKey,
    sleeveId:
      input.scenario.sleeveId ?? `desk_sleeve_${input.scenario.scenarioId}`,
    ownerUserId: input.scenario.ownerUserId,
    venueKey: input.binding.venueKey,
    pair: input.binding.pair,
    mode: "live",
    state: "live",
    lane: input.binding.lane ?? "safe",
    createdAt: input.now,
    updatedAt: input.now,
    promotedAt: input.now,
    policy: {
      maxNotionalUsd,
      dailyLossLimitUsd: String(
        input.scenario.riskLimits?.maxDrawdownBps
          ? Math.max(
              1,
              Math.round(
                Number(input.scenario.riskLimits.maxDrawdownBps) / 100,
              ),
            )
          : 10,
      ),
      maxSlippageBps: Number(input.leg.sizing.maxSlippageBps ?? 50),
      maxConcurrentRuns: 1,
      rebalanceToleranceBps: 125,
    },
    capital: {
      allocatedUsd: allocatedUsd === "0" ? reserveUsd : allocatedUsd,
      reservedUsd: reserveUsd,
      availableUsd: reserveUsd,
    },
    tags: [
      "strategy-desk",
      "bounded-arming",
      input.binding.bindingId,
      input.binding.targetMode,
    ],
  });
}

function flattenEvidenceRefs(
  report: Awaited<
    ReturnType<typeof getRuntimeStrategyDeskScenarioReportWorkflow>
  >["report"],
): RuntimeStrategyDeskPromotionHandoff["evidenceRefs"] {
  const refs: RuntimeStrategyDeskPromotionHandoff["evidenceRefs"] = [
    {
      kind: "strategy_desk_report",
      ref: report.reportId,
    },
  ];
  for (const bucket of report.evidence) {
    const evidenceRefs = Array.isArray(bucket.evidenceRefs)
      ? bucket.evidenceRefs
      : [];
    for (const entry of evidenceRefs) {
      const kind = stringOrNull(isRecord(entry) ? entry.kind : null);
      const ref = stringOrNull(isRecord(entry) ? entry.ref : null);
      const notes = isRecord(entry) ? stringOrNull(entry.notes) : null;
      if (kind && ref) {
        refs.push({ kind, ref, ...(notes ? { notes } : {}) });
      }
    }
  }

  const seen = new Set<string>();
  return refs.filter((entry) => {
    const key = `${entry.kind}:${entry.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readImplementationReference(
  scenario: RuntimeStrategyDeskScenarioManifest,
): RuntimeStrategyDeskPromotionHandoff["implementationReference"] | undefined {
  const candidate = scenario.implementationReferences[0];
  if (!isRecord(candidate)) return undefined;
  const kind = stringOrNull(candidate.kind);
  const ref = stringOrNull(candidate.ref);
  if (!kind || !ref) return undefined;
  if (!["pull_request", "issue", "commit"].includes(kind)) return undefined;
  return {
    kind: kind as "pull_request" | "issue" | "commit",
    ref,
    ...(stringOrNull(candidate.mergedAt)
      ? { mergedAt: String(candidate.mergedAt) }
      : {}),
    ...(stringOrNull(candidate.revision)
      ? { revision: String(candidate.revision) }
      : {}),
    ...(stringOrNull(candidate.notes)
      ? { notes: String(candidate.notes) }
      : {}),
  };
}

function buildChecks(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  report: Awaited<
    ReturnType<typeof getRuntimeStrategyDeskScenarioReportWorkflow>
  >["report"];
  bindings: StrategyDeskPromotionBinding[];
}): RuntimeStrategyDeskPromotionHandoff["checks"] {
  const liveBindings = input.bindings.filter(
    (binding) => binding.bindingKind === "runtime_deployment",
  );
  return [
    {
      checkId: "paper-report-pass",
      status:
        input.report.stage === "paper" && input.report.status === "pass"
          ? "pass"
          : "blocked",
      message:
        input.report.stage === "paper" && input.report.status === "pass"
          ? "Paper report is green and ready for operator review."
          : "Bounded execution handoff requires a passing paper report.",
    },
    {
      checkId: "bounded-live-live-leg",
      status: liveBindings.length > 0 ? "pass" : "blocked",
      observedValue: String(liveBindings.length),
      thresholdValue: ">=1",
      message:
        liveBindings.length > 0
          ? "At least one live-eligible leg is present for bounded execution."
          : "No live-eligible leg is present for bounded execution.",
    },
    {
      checkId: "limited-live-human-approval",
      status: "requires_human_approval",
      message:
        "Limited-live promotion remains human-gated even when the desk report is green.",
    },
  ];
}

function buildActions(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  bindings: StrategyDeskPromotionBinding[];
  now: string;
}): RuntimeStrategyDeskPromotionHandoff["actions"] {
  const actions: RuntimeStrategyDeskPromotionHandoff["actions"] = [
    {
      actionId: "record-desk-state",
      actionType: "record_state_transition",
      summary: "Move the scenario into operator review before arming.",
      required: true,
      payload: {
        scenarioId: input.scenario.scenarioId,
        targetState: "operator_review",
      },
    },
  ];

  for (const binding of input.bindings) {
    if (binding.bindingKind !== "runtime_deployment") continue;
    const leg = firstLegForBinding(input.scenario, binding);
    const deployment = buildRuntimeDeploymentPayload({
      scenario: input.scenario,
      binding,
      leg,
      now: input.now,
    });
    actions.push({
      actionId: `upsert-${binding.bindingId}`,
      actionType: "upsert_runtime_deployment",
      summary: `Create or update the bounded deployment for ${leg.label}.`,
      required: true,
      payload: {
        bindingId: binding.bindingId,
        deployment,
      },
    });
    actions.push({
      actionId: `allowlist-${binding.bindingId}`,
      actionType: "record_allowlist_change",
      summary: `Record the bounded live allowlist change for ${leg.label}.`,
      required: true,
      payload: {
        bindingId: binding.bindingId,
        deploymentId: binding.deploymentId,
        lane: binding.lane ?? "safe",
        targetMode: binding.targetMode,
        venueKey: binding.venueKey,
      },
    });
  }

  return actions;
}

function buildHandoffSummary(bindings: StrategyDeskPromotionBinding[]): string {
  const liveLabels = bindings
    .filter((binding) => binding.bindingKind === "runtime_deployment")
    .map((binding) => binding.bindingId.replace(/^binding_/, ""));
  const paperLabels = bindings
    .filter((binding) => binding.bindingKind !== "runtime_deployment")
    .map((binding) => binding.bindingId.replace(/^binding_/, ""));
  return `Bound ${summarizeLabels(liveLabels)} to limited live while keeping ${summarizeLabels(paperLabels)} under paper-bound desk controls.`;
}

function assertNoBlockedChecks(
  handoff: RuntimeStrategyDeskPromotionHandoff,
): void {
  const blockedCheckIds = handoff.checks
    .filter((check) => check.status === "blocked")
    .map((check) => check.checkId);
  if (blockedCheckIds.length === 0) return;
  throw new Error(
    `runtime-strategy-desk-handoff-checks-blocked:${handoff.handoffId}:${blockedCheckIds.join(",")}`,
  );
}

function buildDefaultHandoff(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  report: Awaited<
    ReturnType<typeof getRuntimeStrategyDeskScenarioReportWorkflow>
  >["report"];
  requestedBy: string;
  targetMode: StrategyDeskPrepareTargetMode;
  now: string;
  deps?: PromotionDeps;
}): RuntimeStrategyDeskPromotionHandoff {
  const bindings = input.scenario.legs.map((leg) =>
    buildBindingForLeg(input.scenario, leg, input.targetMode),
  );
  const checks = buildChecks({
    scenario: input.scenario,
    report: input.report,
    bindings,
  });
  return parseRuntimeStrategyDeskPromotionHandoff({
    schemaVersion: "v1",
    handoffId: createDeskId("desk_handoff", input.deps),
    scenarioId: input.scenario.scenarioId,
    currentState: input.scenario.state,
    targetMode: input.targetMode,
    status: "draft",
    summary: buildHandoffSummary(bindings),
    requestedBy: input.requestedBy,
    createdAt: input.now,
    updatedAt: input.now,
    ...(readImplementationReference(input.scenario)
      ? { implementationReference: readImplementationReference(input.scenario) }
      : {}),
    evidenceRefs: flattenEvidenceRefs(input.report),
    checks,
    approvals: [],
    bindings,
    actions: buildActions({
      scenario: input.scenario,
      bindings,
      now: input.now,
    }),
    metadata: {
      sourceReportId: input.report.reportId,
      generatedBy: "runtime_strategy_desk_promotion",
    },
  });
}

function assertScenarioStateTransition(
  scenario: RuntimeStrategyDeskScenarioManifest,
  nextState: RuntimeStrategyDeskScenarioManifest["state"],
): void {
  if (scenario.state === nextState) return;
  if (
    !canTransitionRuntimeStrategyDeskScenarioState(scenario.state, nextState)
  ) {
    throw new Error(
      `runtime-strategy-desk-scenario-transition-invalid:${scenario.state}:${nextState}`,
    );
  }
}

function assertHandoffStateTransition(
  handoff: RuntimeStrategyDeskPromotionHandoff,
  nextStatus: RuntimeStrategyDeskPromotionHandoff["status"],
): void {
  if (handoff.status === nextStatus) return;
  if (
    !canTransitionRuntimeStrategyDeskPromotionHandoffState(
      handoff.status,
      nextStatus,
    )
  ) {
    throw new Error(
      `runtime-strategy-desk-handoff-transition-invalid:${handoff.status}:${nextStatus}`,
    );
  }
}

function assertScenarioActiveHandoff(
  scenario: RuntimeStrategyDeskScenarioManifest,
  handoff: RuntimeStrategyDeskPromotionHandoff,
  action: "apply" | "pause" | "kill" | "demote",
): void {
  if (scenario.activeHandoffId === handoff.handoffId) {
    return;
  }
  throw new Error(
    `runtime-strategy-desk-handoff-not-active:${action}:${scenario.activeHandoffId ?? "none"}`,
  );
}

function subjectControlKeyForBinding(
  scenario: RuntimeStrategyDeskScenarioManifest,
  binding: StrategyDeskPromotionBinding,
): string {
  return `${scenario.strategyKey}:${binding.bindingId}`;
}

async function upsertPaperBoundBindingObjects(input: {
  env: Env;
  scenario: RuntimeStrategyDeskScenarioManifest;
  handoff: RuntimeStrategyDeskPromotionHandoff;
  binding: StrategyDeskPromotionBinding;
  actor: string;
  now: string;
}): Promise<void> {
  if (input.binding.bindingKind === "subject_control") {
    await writeStrategyLabSubjectControl(input.env.WAITLIST_DB, {
      schemaVersion: "v1",
      subjectKind: "strategy",
      subjectKey: subjectControlKeyForBinding(input.scenario, input.binding),
      liveAllowed: false,
      killSwitchEnabled: false,
      disabledReason: "paper-bound strategy desk control",
      updatedAt: input.now,
      updatedBy: input.actor,
      metadata: {
        source: "strategy_desk_handoff",
        scenarioId: input.scenario.scenarioId,
        handoffId: input.handoff.handoffId,
        bindingId: input.binding.bindingId,
        venueKey: input.binding.venueKey,
        legIds: input.binding.legIds,
      },
    });
    return;
  }

  if (input.binding.bindingKind === "worker_execution_recipe") {
    const existing = await getStrategyDeskExecutionRecipeForBinding(
      input.env.WAITLIST_DB,
      input.handoff.handoffId,
      input.binding.bindingId,
    );
    await writeStrategyDeskExecutionRecipe(input.env.WAITLIST_DB, {
      recipeId: existing?.recipeId ?? createDeskId("desk_recipe", undefined),
      scenarioId: input.scenario.scenarioId,
      handoffId: input.handoff.handoffId,
      bindingId: input.binding.bindingId,
      schemaVersion: existing?.schemaVersion ?? "v1",
      status: "paper",
      venueKey: input.binding.venueKey,
      ...(input.binding.instrumentId
        ? { instrumentId: input.binding.instrumentId }
        : {}),
      ...(input.binding.pair ? { pair: input.binding.pair } : {}),
      targetMode: input.binding.targetMode,
      ...(input.binding.lane ? { lane: input.binding.lane } : {}),
      legIds: [...input.binding.legIds],
      budget: buildBudgetForBinding(input.scenario, input.binding),
      ...(input.binding.notes ? { notes: input.binding.notes } : {}),
      metadata: {
        source: "strategy_desk_handoff",
        actor: input.actor,
      },
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    });
  }
}

async function applyRuntimeBindingActions(input: {
  env: Env;
  handoff: RuntimeStrategyDeskPromotionHandoff;
}): Promise<void> {
  for (const action of input.handoff.actions) {
    if (!action.required) continue;
    if (action.actionType === "record_state_transition") continue;
    if (action.actionType === "record_allowlist_change") continue;

    const payload =
      isRecord(action.payload) && !Array.isArray(action.payload)
        ? action.payload
        : {};
    if (action.actionType === "upsert_runtime_deployment") {
      const deployment = parseRuntimeDeploymentRecord(payload.deployment);
      const result = await upsertRuntimeDeployment(input.env, deployment);
      if (!result.ok) {
        throw new Error(
          String(
            result.payload.error ??
              "runtime-strategy-desk-handoff-upsert-deployment-failed",
          ),
        );
      }
      continue;
    }
    if (action.actionType === "apply_runtime_control") {
      const deploymentId = stringOrNull(payload.deploymentId);
      const controlAction = stringOrNull(payload.action);
      if (
        !deploymentId ||
        !controlAction ||
        !["pause", "resume", "kill"].includes(controlAction)
      ) {
        throw new Error(
          "runtime-strategy-desk-handoff-invalid-runtime-control-action",
        );
      }
      const result = await applyRuntimeDeploymentControl({
        env: input.env,
        deploymentId,
        action: controlAction as "pause" | "resume" | "kill",
      });
      if (!result.ok) {
        throw new Error(
          String(
            result.payload.error ??
              "runtime-strategy-desk-handoff-runtime-control-failed",
          ),
        );
      }
    }
  }
}

async function applyControlToMaterializedObjects(input: {
  env: Env;
  scenario: RuntimeStrategyDeskScenarioManifest;
  handoff: RuntimeStrategyDeskPromotionHandoff;
  actor: string;
  now: string;
  control: "pause" | "kill" | "demote";
}): Promise<void> {
  for (const binding of input.handoff.bindings) {
    if (binding.bindingKind === "runtime_deployment" && binding.deploymentId) {
      const action = input.control === "kill" ? "kill" : "pause";
      const result = await applyRuntimeDeploymentControl({
        env: input.env,
        deploymentId: binding.deploymentId,
        action,
      });
      if (!result.ok) {
        throw new Error(
          String(
            result.payload.error ??
              "runtime-strategy-desk-handoff-control-runtime-deployment-failed",
          ),
        );
      }
      continue;
    }

    if (binding.bindingKind === "worker_execution_recipe") {
      const existing = await getStrategyDeskExecutionRecipeForBinding(
        input.env.WAITLIST_DB,
        input.handoff.handoffId,
        binding.bindingId,
      );
      if (!existing) continue;
      await writeStrategyDeskExecutionRecipe(input.env.WAITLIST_DB, {
        ...existing,
        status:
          input.control === "pause"
            ? "paused"
            : input.control === "kill"
              ? "killed"
              : "archived",
        metadata: {
          ...(existing.metadata ?? {}),
          lastControl: input.control,
          lastControlledBy: input.actor,
        },
        updatedAt: input.now,
      });
      continue;
    }

    const subjectKey = subjectControlKeyForBinding(input.scenario, binding);
    const existingControl = await getStrategyLabSubjectControl(
      input.env.WAITLIST_DB,
      "strategy",
      subjectKey,
    );
    await writeStrategyLabSubjectControl(input.env.WAITLIST_DB, {
      schemaVersion: "v1",
      subjectKind: "strategy",
      subjectKey,
      liveAllowed: false,
      killSwitchEnabled:
        input.control === "pause" ? true : input.control === "kill",
      disabledReason:
        input.control === "demote"
          ? "demoted to paper"
          : input.control === "kill"
            ? "killed from strategy desk"
            : "paused from strategy desk",
      updatedAt: input.now,
      updatedBy: input.actor,
      metadata: {
        ...(existingControl?.metadata ?? {}),
        source: "strategy_desk_handoff",
        handoffId: input.handoff.handoffId,
        lastControl: input.control,
      },
    });
  }
}

function buildStrategyLabPromotionArtifacts(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  handoff: RuntimeStrategyDeskPromotionHandoff;
  actor: string;
  now: string;
}) {
  const deploymentId =
    input.handoff.bindings.find(
      (binding) => binding.bindingKind === "runtime_deployment",
    )?.deploymentId ?? undefined;
  const promotionId = createDeskId("promotion");
  const promotion = parseRuntimeStrategyLabPromotionRecord({
    schemaVersion: "v1",
    promotionId,
    subjectKind: "strategy",
    subjectKey: input.scenario.strategyKey,
    currentState: "paper",
    targetState: "limited_live",
    transitionType: "promote",
    status: "applied",
    summary: input.handoff.summary,
    requestedBy: input.actor,
    createdAt: input.handoff.createdAt,
    updatedAt: input.now,
    appliedAt: input.now,
    ...(deploymentId ? { deploymentId } : {}),
    ...(input.handoff.implementationReference
      ? { implementationReference: input.handoff.implementationReference }
      : {}),
    evidenceRefs: [
      ...input.handoff.evidenceRefs,
      {
        kind: "strategy_desk_handoff",
        ref: input.handoff.handoffId,
      },
    ],
    checks: input.handoff.checks,
    actions: input.handoff.actions,
    approvals: input.handoff.approvals,
    metadata: {
      source: "strategy_desk_handoff",
      scenarioId: input.scenario.scenarioId,
      handoffId: input.handoff.handoffId,
      handoffRequestedBy: input.handoff.requestedBy,
    },
  });
  const event = parseRuntimeStrategyLabPromotionEvent({
    schemaVersion: "v1",
    eventId: createDeskId("promoevt"),
    promotionId,
    eventType: "applied",
    actor: input.actor,
    fromState: "paper",
    toState: "limited_live",
    summary: "Strategy desk bounded execution handoff applied.",
    details: {
      scenarioId: input.scenario.scenarioId,
      handoffId: input.handoff.handoffId,
      targetMode: input.handoff.targetMode,
    },
    createdAt: input.now,
  });
  return { promotion, event };
}

async function hydratePromotionResult(input: {
  env: Env;
  scenarioId: string;
  handoffId: string;
}): Promise<StrategyDeskPromotionResult> {
  const scenario = (
    await getRuntimeStrategyDeskScenarioWorkflow({
      env: input.env,
      scenarioId: input.scenarioId,
    })
  ).scenario;
  const handoff = await getStrategyDeskPromotionHandoff(
    input.env.WAITLIST_DB,
    input.handoffId,
  );
  if (!handoff) {
    throw new Error(
      `runtime-strategy-desk-handoff-not-found:${input.handoffId}`,
    );
  }
  return {
    scenario,
    handoff,
    events: await listStrategyDeskPromotionHandoffEvents(
      input.env.WAITLIST_DB,
      handoff.handoffId,
    ),
    executionRecipes: await listStrategyDeskExecutionRecipes(
      input.env.WAITLIST_DB,
      { handoffId: handoff.handoffId, limit: 20 },
    ),
  };
}

export async function prepareRuntimeStrategyDeskPromotionHandoffWorkflow(
  input: {
    env: Env;
    scenarioId: string;
    requestedBy: string;
    targetMode?: StrategyDeskPrepareTargetMode;
  },
  deps?: PromotionDeps,
): Promise<StrategyDeskPromotionResult> {
  const scenario = (
    await getRuntimeStrategyDeskScenarioWorkflow({
      env: input.env,
      scenarioId: input.scenarioId,
    })
  ).scenario;
  if (
    scenario.state !== "paper_ready" &&
    scenario.state !== "operator_review" &&
    scenario.state !== "execution_ready" &&
    scenario.state !== "execution_bound"
  ) {
    throw new Error(
      `runtime-strategy-desk-handoff-scenario-not-ready:${scenario.state}`,
    );
  }
  if (!scenario.latestReportId) {
    throw new Error(
      `runtime-strategy-desk-handoff-report-missing:${scenario.scenarioId}`,
    );
  }
  const report = (
    await getRuntimeStrategyDeskScenarioReportWorkflow({
      env: input.env,
      reportId: scenario.latestReportId,
    })
  ).report;
  const now = nowIso(deps);
  const targetMode = input.targetMode ?? "limited_live";
  const handoff = buildDefaultHandoff({
    scenario,
    report,
    requestedBy: input.requestedBy,
    targetMode,
    now,
    deps,
  });

  await writeStrategyDeskPromotionHandoff(input.env.WAITLIST_DB, handoff);
  await appendStrategyDeskPromotionHandoffEvent(input.env.WAITLIST_DB, {
    eventId: createDeskId("desk_handoff_evt", deps),
    handoffId: handoff.handoffId,
    eventType: "prepared",
    actor: input.requestedBy,
    summary:
      "Prepared a bounded execution handoff draft from the current paper evidence.",
    details: {
      targetMode,
      sourceReportId: report.reportId,
    },
    createdAt: now,
  });

  return hydratePromotionResult({
    env: input.env,
    scenarioId: scenario.scenarioId,
    handoffId: handoff.handoffId,
  });
}

export async function upsertRuntimeStrategyDeskPromotionHandoffWorkflow(input: {
  env: Env;
  handoff: RuntimeStrategyDeskPromotionHandoff;
}): Promise<{ handoff: RuntimeStrategyDeskPromotionHandoff }> {
  const scenario = (
    await getRuntimeStrategyDeskScenarioWorkflow({
      env: input.env,
      scenarioId: input.handoff.scenarioId,
    })
  ).scenario;
  const existing = await getStrategyDeskPromotionHandoff(
    input.env.WAITLIST_DB,
    input.handoff.handoffId,
  );
  if (existing) {
    assertHandoffStateTransition(existing, input.handoff.status);
  }
  if (
    scenario.activeHandoffId &&
    scenario.activeHandoffId !== input.handoff.handoffId
  ) {
    throw new Error(
      `runtime-strategy-desk-handoff-active-mismatch:${scenario.activeHandoffId}`,
    );
  }
  return {
    handoff: await writeStrategyDeskPromotionHandoff(
      input.env.WAITLIST_DB,
      input.handoff,
    ),
  };
}

export async function getRuntimeStrategyDeskPromotionHandoffWorkflow(input: {
  env: Env;
  handoffId: string;
}): Promise<{
  handoff: RuntimeStrategyDeskPromotionHandoff;
  events: StrategyDeskPromotionHandoffEvent[];
  executionRecipes: StrategyDeskExecutionRecipeRecord[];
}> {
  const handoff = await getStrategyDeskPromotionHandoff(
    input.env.WAITLIST_DB,
    input.handoffId,
  );
  if (!handoff) {
    throw new Error(
      `runtime-strategy-desk-handoff-not-found:${input.handoffId}`,
    );
  }
  return {
    handoff,
    events: await listStrategyDeskPromotionHandoffEvents(
      input.env.WAITLIST_DB,
      input.handoffId,
    ),
    executionRecipes: await listStrategyDeskExecutionRecipes(
      input.env.WAITLIST_DB,
      { handoffId: input.handoffId, limit: 20 },
    ),
  };
}

export async function listRuntimeStrategyDeskPromotionHandoffsWorkflow(input: {
  env: Env;
  handoffId?: string;
  scenarioId?: string;
  status?: string;
  limit?: number;
}): Promise<{
  handoffs: RuntimeStrategyDeskPromotionHandoff[];
}> {
  return {
    handoffs: await listStrategyDeskPromotionHandoffs(input.env.WAITLIST_DB, {
      handoffId: input.handoffId,
      scenarioId: input.scenarioId,
      status: input.status,
      limit: input.limit,
    }),
  };
}

export async function transitionRuntimeStrategyDeskPromotionHandoffWorkflow(
  input: {
    env: Env;
    handoffId: string;
    action: StrategyDeskPromotionAction;
    actor: string;
    notes?: string;
  },
  deps?: PromotionDeps,
): Promise<StrategyDeskPromotionResult> {
  const handoff = await getStrategyDeskPromotionHandoff(
    input.env.WAITLIST_DB,
    input.handoffId,
  );
  if (!handoff) {
    throw new Error(
      `runtime-strategy-desk-handoff-not-found:${input.handoffId}`,
    );
  }
  const scenario = (
    await getRuntimeStrategyDeskScenarioWorkflow({
      env: input.env,
      scenarioId: handoff.scenarioId,
    })
  ).scenario;
  const now = nowIso(deps);

  let nextStatus = handoff.status;
  let nextScenarioState = scenario.state;
  let nextActiveHandoffId: string | null | undefined = scenario.activeHandoffId;
  let nextApprovals = [...handoff.approvals];
  let nextAppliedAt = handoff.appliedAt;
  let eventType: StrategyDeskPromotionHandoffEvent["eventType"];
  let summary: string;

  switch (input.action) {
    case "submit": {
      assertHandoffStateTransition(handoff, "awaiting_review");
      assertScenarioStateTransition(scenario, "operator_review");
      nextStatus = "awaiting_review";
      nextScenarioState = "operator_review";
      nextActiveHandoffId = handoff.handoffId;
      eventType = "submitted";
      summary = "Submitted bounded execution handoff for operator review.";
      break;
    }
    case "approve": {
      assertHandoffStateTransition(handoff, "approved");
      assertScenarioStateTransition(scenario, "execution_ready");
      nextStatus = "approved";
      nextScenarioState = "execution_ready";
      nextActiveHandoffId = handoff.handoffId;
      nextApprovals = [
        ...handoff.approvals.filter(
          (approval) => approval.approvedBy !== input.actor,
        ),
        {
          targetMode: handoff.targetMode,
          approvedBy: input.actor,
          approvedAt: now,
          ...(input.notes ? { notes: input.notes } : {}),
        },
      ];
      eventType = "approved";
      summary = "Approved bounded execution handoff.";
      break;
    }
    case "reject": {
      assertHandoffStateTransition(handoff, "rejected");
      assertScenarioStateTransition(scenario, "paper_ready");
      nextStatus = "rejected";
      nextScenarioState = "paper_ready";
      nextActiveHandoffId = null;
      eventType = "rejected";
      summary =
        "Rejected bounded execution handoff and returned scenario to paper readiness.";
      break;
    }
    case "apply": {
      if (handoff.status === "applied") {
        throw new Error(
          `runtime-strategy-desk-handoff-already-applied:${handoff.handoffId}`,
        );
      }
      assertScenarioActiveHandoff(scenario, handoff, "apply");
      assertNoBlockedChecks(handoff);
      if (handoff.approvals.length === 0 && nextApprovals.length === 0) {
        throw new Error(
          "runtime-strategy-desk-handoff-human-approval-required",
        );
      }
      assertHandoffStateTransition(handoff, "applied");
      assertScenarioStateTransition(scenario, "execution_bound");
      await applyRuntimeBindingActions({
        env: input.env,
        handoff,
      });
      for (const binding of handoff.bindings) {
        if (binding.bindingKind === "runtime_deployment") {
          continue;
        }
        await upsertPaperBoundBindingObjects({
          env: input.env,
          scenario,
          handoff,
          binding,
          actor: input.actor,
          now,
        });
      }
      nextStatus = "applied";
      nextScenarioState = "execution_bound";
      nextActiveHandoffId = handoff.handoffId;
      nextAppliedAt = now;
      const { promotion, event } = buildStrategyLabPromotionArtifacts({
        scenario,
        handoff: {
          ...handoff,
          approvals:
            nextApprovals.length > 0 ? nextApprovals : handoff.approvals,
          status: "applied",
          appliedAt: now,
        },
        actor: input.actor,
        now,
      });
      await writeStrategyLabPromotion(input.env.WAITLIST_DB, promotion);
      await appendStrategyLabPromotionEvent(input.env.WAITLIST_DB, event);
      eventType = "applied";
      summary =
        "Applied bounded execution handoff and materialized execution objects.";
      break;
    }
    case "pause": {
      if (handoff.status !== "applied") {
        throw new Error(
          `runtime-strategy-desk-handoff-control-not-applied:${handoff.status}`,
        );
      }
      assertScenarioActiveHandoff(scenario, handoff, "pause");
      assertScenarioStateTransition(scenario, "paused");
      await applyControlToMaterializedObjects({
        env: input.env,
        scenario,
        handoff,
        actor: input.actor,
        now,
        control: "pause",
      });
      nextScenarioState = "paused";
      nextActiveHandoffId = handoff.handoffId;
      eventType = "paused";
      summary =
        "Paused bounded execution from the strategy desk operator boundary.";
      break;
    }
    case "kill": {
      if (handoff.status !== "applied") {
        throw new Error(
          `runtime-strategy-desk-handoff-control-not-applied:${handoff.status}`,
        );
      }
      assertScenarioActiveHandoff(scenario, handoff, "kill");
      assertScenarioStateTransition(scenario, "paused");
      await applyControlToMaterializedObjects({
        env: input.env,
        scenario,
        handoff,
        actor: input.actor,
        now,
        control: "kill",
      });
      nextScenarioState = "paused";
      nextActiveHandoffId = handoff.handoffId;
      eventType = "killed";
      summary =
        "Killed bounded execution from the strategy desk operator boundary.";
      break;
    }
    case "demote": {
      if (handoff.status !== "applied" && handoff.status !== "approved") {
        throw new Error(
          `runtime-strategy-desk-handoff-demote-not-ready:${handoff.status}`,
        );
      }
      assertScenarioActiveHandoff(scenario, handoff, "demote");
      assertScenarioStateTransition(scenario, "paper_ready");
      if (handoff.status === "applied") {
        await applyControlToMaterializedObjects({
          env: input.env,
          scenario,
          handoff,
          actor: input.actor,
          now,
          control: "demote",
        });
      }
      nextScenarioState = "paper_ready";
      nextActiveHandoffId = null;
      if (handoff.status === "approved" || handoff.status === "applied") {
        assertHandoffStateTransition(handoff, "archived");
        nextStatus = "archived";
      }
      eventType = "demoted";
      summary =
        "Demoted the scenario back to paper readiness and archived bounded execution bindings.";
      break;
    }
    case "archive": {
      assertHandoffStateTransition(handoff, "archived");
      nextStatus = "archived";
      nextActiveHandoffId =
        scenario.activeHandoffId === handoff.handoffId
          ? null
          : scenario.activeHandoffId;
      eventType = "archived";
      summary = "Archived the bounded execution handoff.";
      break;
    }
    default: {
      const exhaustiveCheck: never = input.action;
      throw new Error(
        `runtime-strategy-desk-handoff-action-unknown:${exhaustiveCheck}`,
      );
    }
  }

  const nextHandoff = parseRuntimeStrategyDeskPromotionHandoff({
    ...handoff,
    status: nextStatus,
    ...(nextApprovals.length > 0 ? { approvals: nextApprovals } : {}),
    updatedAt: now,
    ...(nextAppliedAt ? { appliedAt: nextAppliedAt } : {}),
  });
  await writeStrategyDeskPromotionHandoff(input.env.WAITLIST_DB, nextHandoff);
  await updateStrategyDeskScenarioReviewState(input.env.WAITLIST_DB, {
    scenarioId: scenario.scenarioId,
    state: nextScenarioState,
    activeHandoffId: nextActiveHandoffId,
    reviewedAt: now,
    updatedAt: now,
  });
  await appendStrategyDeskPromotionHandoffEvent(input.env.WAITLIST_DB, {
    eventId: createDeskId("desk_handoff_evt", deps),
    handoffId: handoff.handoffId,
    eventType,
    actor: input.actor,
    ...(handoff.status !== nextStatus ? { fromStatus: handoff.status } : {}),
    ...(handoff.status !== nextStatus ? { toStatus: nextStatus } : {}),
    summary,
    details: {
      scenarioId: scenario.scenarioId,
      nextScenarioState,
      ...(input.notes ? { notes: input.notes } : {}),
    },
    createdAt: now,
  });

  return hydratePromotionResult({
    env: input.env,
    scenarioId: scenario.scenarioId,
    handoffId: handoff.handoffId,
  });
}
