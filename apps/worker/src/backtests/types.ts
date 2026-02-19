import type {
  DataSourcesConfig,
  StrategyConfig,
  ValidationProfile,
} from "../types";

export type BacktestRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type BacktestRunKind = "validation" | "strategy_json";

export type BacktestSummaryMetrics = {
  netReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
};

export type BacktestRunSummary = BacktestSummaryMetrics & {
  strategyLabel: string;
  validationStatus?: "passed" | "failed";
};

export type ValidationBacktestRequest = {
  kind: "validation";
  fixturePattern?: "uptrend" | "downtrend" | "whipsaw";
};

export type StrategyJsonBacktestSpec = {
  strategy: StrategyConfig;
  market: {
    baseMint: string;
    quoteMint: string;
  };
  validation?: {
    lookbackDays?: number;
    profile?: ValidationProfile;
    minTrades?: number;
    effectiveCostBps?: number;
    endMs?: number;
  };
  dataSources?: DataSourcesConfig;
};

export type StrategyJsonBacktestRequest = {
  kind: "strategy_json";
  spec: StrategyJsonBacktestSpec;
};

export type BacktestRunRequest =
  | ValidationBacktestRequest
  | StrategyJsonBacktestRequest;

export type BacktestRunRow = {
  id: number;
  runId: string;
  tenantId: string;
  status: BacktestRunStatus;
  kind: BacktestRunKind;
  request: BacktestRunRequest;
  summary: BacktestRunSummary | null;
  resultRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type BacktestRunEvent = {
  id: number;
  runId: string;
  tenantId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type BacktestRunDetail = {
  run: BacktestRunRow;
  result: Record<string, unknown> | null;
  events: BacktestRunEvent[];
};

export type BacktestListItem = {
  runId: string;
  status: BacktestRunStatus;
  kind: BacktestRunKind;
  strategyLabel: string;
  summary: BacktestSummaryMetrics | null;
  validationStatus?: "passed" | "failed";
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
