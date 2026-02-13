import type { StrategyRuntimeStateRow, LoopConfig } from "../types";
import type { StrategyValidationRun } from "../strategy_validation/repo";
import type { BotLogEvent } from "../bot_events";
import type { StrategyEventRow } from "../strategy_validation/repo";
import type { TradeIndexResult } from "../trade_index";
import type { StrategyConversationDescriptor } from "../strategy_validation/descriptors";

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
};

export type ConversationRequest = {
  message: string;
  includeSources?: string[];
  limit?: number;
  explain?: boolean;
};
