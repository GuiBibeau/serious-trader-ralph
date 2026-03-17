import type {
  RuntimeStrategyDeskExecutionRecipe,
  RuntimeStrategyDeskPromotionHandoff,
  RuntimeStrategyDeskPromotionHandoffEvent,
  RuntimeStrategyDeskScenarioManifest,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "../../../lib/runtime-strategy-desk";

export type StrategyDeskExecuteRunKind = "shadow" | "paper";
export type StrategyDeskStudyRunKind = "replay" | "backtest";
export type StrategyDeskStudySelectionMetric =
  | "net_return_bps"
  | "excess_vs_flat_cash_bps";

export type StrategyDeskApiPayload = {
  ok: boolean;
  snapshot: {
    scenarios: RuntimeStrategyDeskScenarioManifest[];
    selectedScenarioId: string | null;
    selectedScenario: RuntimeStrategyDeskScenarioManifest | null;
    runs: RuntimeStrategyDeskScenarioRun[];
    reports: RuntimeStrategyDeskScenarioReport[];
    handoffs: RuntimeStrategyDeskPromotionHandoff[];
    activeHandoff: RuntimeStrategyDeskPromotionHandoff | null;
    latestHandoff: RuntimeStrategyDeskPromotionHandoff | null;
    handoffEvents: RuntimeStrategyDeskPromotionHandoffEvent[];
    executionRecipes: RuntimeStrategyDeskExecutionRecipe[];
    latestRun: RuntimeStrategyDeskScenarioRun | null;
    latestReport: RuntimeStrategyDeskScenarioReport | null;
  };
};

export type StrategyDeskTransitionHandoffAction =
  | "submit"
  | "approve"
  | "reject"
  | "apply"
  | "pause"
  | "kill"
  | "demote"
  | "archive";

function hasHandoffStatus(
  handoff: RuntimeStrategyDeskPromotionHandoff | null | undefined,
  statuses: readonly string[],
): handoff is RuntimeStrategyDeskPromotionHandoff {
  return Boolean(handoff && statuses.includes(handoff.status));
}

export function selectStrategyDeskHandoffForAction(
  snapshot: StrategyDeskApiPayload["snapshot"] | null | undefined,
  action: StrategyDeskTransitionHandoffAction,
): RuntimeStrategyDeskPromotionHandoff | null {
  const activeHandoff = snapshot?.activeHandoff ?? null;
  const latestHandoff = snapshot?.latestHandoff ?? null;

  switch (action) {
    case "submit":
      return hasHandoffStatus(latestHandoff, ["draft"]) ? latestHandoff : null;
    case "approve":
    case "reject":
      if (hasHandoffStatus(activeHandoff, ["awaiting_review"])) {
        return activeHandoff;
      }
      return hasHandoffStatus(latestHandoff, ["awaiting_review"])
        ? latestHandoff
        : null;
    case "apply":
      if (hasHandoffStatus(activeHandoff, ["approved"])) {
        return activeHandoff;
      }
      return hasHandoffStatus(latestHandoff, ["approved"])
        ? latestHandoff
        : null;
    case "pause":
    case "kill":
      return hasHandoffStatus(activeHandoff, ["applied"])
        ? activeHandoff
        : null;
    case "demote":
      if (hasHandoffStatus(activeHandoff, ["approved", "applied"])) {
        return activeHandoff;
      }
      return hasHandoffStatus(latestHandoff, ["approved", "applied"])
        ? latestHandoff
        : null;
    case "archive":
      return latestHandoff ?? activeHandoff;
    default: {
      const exhaustiveCheck: never = action;
      return exhaustiveCheck;
    }
  }
}

export function selectStrategyDeskFocusHandoff(
  snapshot: StrategyDeskApiPayload["snapshot"] | null | undefined,
): RuntimeStrategyDeskPromotionHandoff | null {
  return snapshot?.activeHandoff ?? snapshot?.latestHandoff ?? null;
}

export type StrategyDeskMutationResult = {
  ok: boolean;
  scenario?: RuntimeStrategyDeskScenarioManifest;
  run?: RuntimeStrategyDeskScenarioRun;
  report?: RuntimeStrategyDeskScenarioReport;
  handoff?: RuntimeStrategyDeskPromotionHandoff;
  events?: RuntimeStrategyDeskPromotionHandoffEvent[];
  executionRecipes?: RuntimeStrategyDeskExecutionRecipe[];
  error?: string;
};
