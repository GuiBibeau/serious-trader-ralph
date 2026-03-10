import type {
  RuntimeDeploymentRecord,
  RuntimeLedgerSnapshot,
  RuntimeRunRecord,
} from "../../../../worker/src/runtime_contracts";

export type RuntimeControlAction = "pause" | "resume" | "kill";

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
  deployments: RuntimeDeploymentRecord[];
  controls: RuntimeOperatorControls;
  canary: Record<string, unknown> | null;
  error: string | null;
};

export type RuntimeOperatorDetail = {
  deploymentId: string;
  deployment: RuntimeDeploymentRecord | null;
  runs: RuntimeRunRecord[];
  positions: RuntimeLedgerSnapshot | null;
  pnl: {
    asOf: string | null;
    totals: RuntimeLedgerSnapshot["totals"];
  } | null;
  scorecard: Record<string, unknown> | null;
};

export type RuntimeOperatorApiPayload = {
  ok: boolean;
  runtime: RuntimeOperatorSnapshot;
  selectedDeploymentId: string | null;
  detail: RuntimeOperatorDetail | null;
  detailError: string | null;
};
