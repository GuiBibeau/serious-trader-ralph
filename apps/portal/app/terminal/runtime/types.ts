import type {
  RuntimeDeploymentRecord,
  RuntimeLedgerSnapshot,
  RuntimeRunRecord,
} from "../../../lib/runtime-contracts";
import type { RuntimeOperatorProgramMatrixEntry } from "./program-matrix";

export type { RuntimeOperatorProgramMatrixEntry } from "./program-matrix";

export type RuntimeControlAction = "pause" | "resume" | "kill";
export type RuntimeSubjectKind = "venue" | "asset";

export type RuntimeOperatorSubjectControlInput = {
  subjectKind: RuntimeSubjectKind;
  subjectKey: string;
  liveAllowed?: boolean;
  killSwitchEnabled?: boolean;
  disabledReason?: string | null;
};

export type RuntimeOperatorReadinessCanaryInput = {
  subjectKind: RuntimeSubjectKind;
  subjectKey: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  adapterKey?: string;
  targetNotionalUsd?: string;
};

export type RuntimeOperatorVenueTxSmokeInput = {
  subjectKind: "venue";
  subjectKey: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  adapterKey?: string;
  targetNotionalUsd?: string;
  smokeIntentFamily?: "spot_swap" | "conditional_spot_order" | "clob_order";
  smokeOrderSide?: "buy" | "sell";
  tightenOnFailure?: boolean;
  failureControlMode?: "disable_live" | "engage_kill_switch";
  killDrillNotes?: string[];
};

export type RuntimeOperatorControls = {
  enabled: boolean;
  disabledReason: string | null;
  shadowOnly: boolean;
  shadowOnlyReason: string | null;
};

export type RuntimeOperatorSnapshot = {
  ok: boolean;
  source: string;
  integration: Record<string, unknown>;
  health: Record<string, unknown> | null;
  routes: Record<string, unknown> | null;
  deployments: RuntimeDeploymentRecord[];
  controls: RuntimeOperatorControls;
  canary: Record<string, unknown> | null;
  leaderboard: Record<string, unknown> | null;
  error: string | null;
};

export type RuntimeOperatorDetail = {
  deploymentId: string;
  deployment: RuntimeDeploymentRecord | null;
  runs: RuntimeRunRecord[];
  allocator: Record<string, unknown> | null;
  positions: RuntimeLedgerSnapshot | null;
  pnl: {
    asOf: string | null;
    totals: RuntimeLedgerSnapshot["totals"];
  } | null;
  scorecard: Record<string, unknown> | null;
  lab: {
    research: {
      hypotheses: Record<string, unknown>[];
      sources: Record<string, unknown>[];
      experiments: Record<string, unknown>[];
      evidenceBundles: Record<string, unknown>[];
      reproducibilityBundles: Record<string, unknown>[];
      error: string | null;
    };
    promotions: {
      strategy: Record<string, unknown>[];
      venue: Record<string, unknown>[];
      asset: Record<string, unknown>[];
      error: string | null;
    };
    readiness: {
      venue: {
        subjectKind: RuntimeSubjectKind;
        subjectKey: string;
        artifacts: Record<string, unknown>[];
        controls: Record<string, unknown>[];
        canaryRuns: Record<string, unknown>[];
        canaryState: Record<string, unknown> | null;
        error: string | null;
      } | null;
      asset: {
        subjectKind: RuntimeSubjectKind;
        subjectKey: string;
        artifacts: Record<string, unknown>[];
        controls: Record<string, unknown>[];
        canaryRuns: Record<string, unknown>[];
        canaryState: Record<string, unknown> | null;
        error: string | null;
      } | null;
    };
  } | null;
};

export type RuntimeOperatorApiPayload = {
  ok: boolean;
  runtime: RuntimeOperatorSnapshot;
  program: {
    matrix: RuntimeOperatorProgramMatrixEntry[];
    nextIssueOrder: number[];
  };
  selectedDeploymentId: string | null;
  detail: RuntimeOperatorDetail | null;
  detailError: string | null;
};
