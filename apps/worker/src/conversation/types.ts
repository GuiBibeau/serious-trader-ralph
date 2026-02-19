import type { BacktestListItem } from "../backtests/types";
import type { BotLogEvent } from "../bot_events";
import type { BotRunLifecycleState } from "../agents_runtime/runtime_repo";
import type { StrategyConversationDescriptor } from "../strategy_validation/descriptors";
import type {
  StrategyEventRow,
  StrategyValidationRun,
} from "../strategy_validation/repo";
import type { TradeIndexResult } from "../trade_index";
import type { LoopConfig, StrategyRuntimeStateRow } from "../types";

export type ConversationActor = "user" | "admin";
export type ConversationRole = "user" | "assistant";

export type ConversationSource = {
  type:
    | "validation"
    | "strategy-event"
    | "trade"
    | "log"
    | "runtime"
    | "config"
    | "error";
  id?: string;
  label: string;
  hint?: string;
};

export type ConversationMessage = {
  id: number;
  tenantId: string;
  role: ConversationRole;
  actor: ConversationActor;
  question: string | null;
  answer: string | null;
  model: string | null;
  sources: ConversationSource[];
  createdAt: string;
  error: string | null;
};

export type TelemetrySnapshot = {
  tenantId: string;
  strategyDescriptor: StrategyConversationDescriptor;
  config: LoopConfig;
  runtimeState: StrategyRuntimeStateRow | null;
  latestValidation: StrategyValidationRun | null;
  validationRuns: StrategyValidationRun[];
  botEvents: BotLogEvent[];
  strategyEvents: StrategyEventRow[];
  trades: TradeIndexResult[];
  startGate: {
    ok: boolean;
    reason?: "strategy-not-validated" | "strategy-validation-stale";
    strategyHash?: string;
    overrideAllowed?: boolean;
  };
  backtests: {
    runningCount: number;
    latestRuns: BacktestListItem[];
  };
  agentRun: {
    state: BotRunLifecycleState;
    blockedReason: string | null;
    currentRunId: string | null;
    lastTickAt: string | null;
    nextTickAt: string | null;
    provider: {
      baseUrlHash: string | null;
      model: string | null;
      pingAgeMs: number | null;
      resolutionSource: "bot_config" | null;
    };
    steering: {
      pendingCount: number;
      lastAppliedId: number | null;
    };
    context: {
      compactedAt: string | null;
      compactedCount: number;
      messageWindowCount: number;
    };
  };
};

export type ConversationRequest = {
  message: string;
  includeSources?: string[];
  limit?: number;
  explain?: boolean;
};
