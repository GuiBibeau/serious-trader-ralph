import type {
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
    latestRun: RuntimeStrategyDeskScenarioRun | null;
    latestReport: RuntimeStrategyDeskScenarioReport | null;
  };
};

export type StrategyDeskMutationResult = {
  ok: boolean;
  scenario?: RuntimeStrategyDeskScenarioManifest;
  run?: RuntimeStrategyDeskScenarioRun;
  report?: RuntimeStrategyDeskScenarioReport;
  error?: string;
};
