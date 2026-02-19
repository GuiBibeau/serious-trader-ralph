import {
  countPendingSteeringMessages,
  getBotRunState,
} from "../agents_runtime/runtime_repo";
import { countBacktestRunsByStatus, listBacktestRuns } from "../backtests/repo";
import type { BotLogEvent } from "../bot_events";
import { listRecentBotEvents } from "../bot_events";
import { getLoopConfig } from "../config";
import { normalizePolicy } from "../policy";
import { describeStrategyState } from "../strategy_validation/descriptors";
import {
  evaluateStartGate,
  normalizeValidationConfig,
} from "../strategy_validation/engine";
import { computeStrategyHash } from "../strategy_validation/hash";
import type { StrategyEventRow } from "../strategy_validation/repo";
import {
  getLatestValidation,
  getLatestValidationForHash,
  getRuntimeState,
  listStrategyEvents,
  listValidationRuns,
  type StrategyValidationRun,
} from "../strategy_validation/repo";
import type { TradeIndexResult } from "../trade_index";
import { listTrades } from "../trade_index";
import type { Env, StrategyRuntimeStateRow } from "../types";
import type { TelemetrySnapshot } from "./types";

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampLimit(rawLimit: unknown, fallback: number, max: number): number {
  const limit = clampInt(rawLimit, max, 1, max);
  return limit === max && rawLimit === undefined ? fallback : limit;
}

function clampIncludeSource(value: string | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  const allowed = new Set([
    "bot-events",
    "strategy-events",
    "trades",
    "validation-runs",
    "runtime",
    "config",
  ]);
  return allowed.has(normalized) ? normalized : "";
}

export type ContextQueryOptions = {
  includeSources?: string[];
  limit?: {
    botEvents?: number;
    strategyEvents?: number;
    trades?: number;
    validationRuns?: number;
  };
};

export type ConversationContext = {
  telemetry: TelemetrySnapshot;
  includeSources: Set<string>;
};

export async function buildConversationContext(
  env: Env,
  tenantId: string,
  options: ContextQueryOptions = {},
): Promise<ConversationContext> {
  const config = await getLoopConfig(env, tenantId);
  const runtimeState: StrategyRuntimeStateRow = await getRuntimeState(
    env,
    tenantId,
  );
  const latestValidation = await getLatestValidation(env, tenantId);

  const rawIncludeSources =
    options.includeSources && options.includeSources.length > 0
      ? options.includeSources
      : [
          "bot-events",
          "strategy-events",
          "validation-runs",
          "trades",
          "runtime",
          "config",
        ];
  const includeSources = new Set(
    rawIncludeSources
      .map((source) => clampIncludeSource(source))
      .filter((source) => source.length > 0),
  );

  const includeBotEvents = includeSources.has("bot-events");
  const includeStrategyEvents = includeSources.has("strategy-events");
  const includeTrades = includeSources.has("trades");
  const includeValidation =
    includeSources.has("validation-runs") || includeSources.has("runtime");

  const botEventsLimit = clampLimit(
    options.limit?.botEvents,
    includeBotEvents ? 60 : 0,
    120,
  );
  const strategyEventsLimit = clampLimit(
    options.limit?.strategyEvents,
    includeStrategyEvents ? 40 : 0,
    120,
  );
  const tradesLimit = clampLimit(
    options.limit?.trades,
    includeTrades ? 40 : 0,
    120,
  );
  const validationLimit = clampLimit(
    options.limit?.validationRuns,
    includeValidation ? 12 : 0,
    80,
  );

  const botEventsPromise: Promise<BotLogEvent[]> = includeBotEvents
    ? listRecentBotEvents(env, { tenantId, limit: botEventsLimit })
    : Promise.resolve([]);
  const strategyEventsPromise: Promise<StrategyEventRow[]> =
    includeStrategyEvents
      ? listStrategyEvents(env, tenantId, strategyEventsLimit)
      : Promise.resolve([]);
  const tradePromise: Promise<TradeIndexResult[]> = includeTrades
    ? listTrades(env, tenantId, tradesLimit)
    : Promise.resolve([]);
  const validationPromise: Promise<StrategyValidationRun[]> = includeValidation
    ? listValidationRuns(env, tenantId, validationLimit)
    : Promise.resolve([]);

  const [botEvents, strategyEvents, trades, validationRuns] = await Promise.all(
    [botEventsPromise, strategyEventsPromise, tradePromise, validationPromise],
  );

  const [runningBacktests, latestBacktests, runState, steeringPendingCount] =
    await Promise.all([
      countBacktestRunsByStatus(env, tenantId, ["queued", "running"]).catch(
        () => 0,
      ),
      listBacktestRuns(env, tenantId, { limit: 20 }).catch(() => []),
      getBotRunState(env, tenantId).catch(() => null),
      countPendingSteeringMessages(env, tenantId).catch(() => 0),
    ]);

  const normalizedPolicy = normalizePolicy(config.policy);
  const strategyType = config.strategy?.type;
  const strategy =
    strategyType &&
    typeof config.strategy === "object" &&
    !Array.isArray(config.strategy)
      ? config.strategy
      : { type: "noop" as const };
  const strategyDescriptor = describeStrategyState({
    strategy,
    config,
    runtimeState,
    latestValidation,
  });

  const validationCfg = normalizeValidationConfig(config.validation);
  const startGateInput = await (() => {
    if (strategyType === "noop") {
      return Promise.resolve({
        ok: true,
        overrideAllowed: false,
        strategyHash: undefined,
      });
    }

    if (!strategyType || strategyType === "noop") {
      return Promise.resolve({
        ok: true,
        overrideAllowed: false,
        strategyHash: undefined,
      });
    }

    return (async () => {
      const strategyHash = await computeStrategyHash(config);
      const latestForHash = await getLatestValidationForHash(
        env,
        tenantId,
        strategyHash,
      );

      const gate = evaluateStartGate({
        validation: validationCfg,
        strategyHash,
        latest: latestForHash
          ? {
              status: latestForHash.status,
              completedAt: latestForHash.completedAt,
              createdAt: latestForHash.createdAt,
            }
          : null,
      });
      return {
        ...gate,
        strategyHash,
      };
    })();
  })();

  const gate = await startGateInput;

  const telemetry: TelemetrySnapshot = {
    tenantId,
    strategyDescriptor,
    config: {
      ...config,
      policy: normalizedPolicy,
    },
    runtimeState,
    latestValidation,
    validationRuns,
    botEvents: includeBotEvents ? botEvents : [],
    strategyEvents: includeStrategyEvents ? strategyEvents : [],
    trades: includeTrades ? trades : [],
    startGate: {
      ok: gate.ok,
      reason: gate.reason,
      strategyHash: (gate as { strategyHash?: string }).strategyHash,
      overrideAllowed: gate.overrideAllowed,
    },
    backtests: {
      runningCount: runningBacktests,
      latestRuns: latestBacktests,
    },
    agentRun: {
      state: runState?.state ?? "idle",
      blockedReason: runState?.blockedReason ?? null,
      currentRunId: runState?.currentRunId ?? null,
      lastTickAt: runState?.lastTickAt ?? null,
      nextTickAt: runState?.nextTickAt ?? null,
      provider: {
        baseUrlHash: runState?.providerBaseUrlHash ?? null,
        model: runState?.providerModel ?? null,
        pingAgeMs: runState?.providerPingAgeMs ?? null,
        resolutionSource: runState?.resolutionSource ?? null,
      },
      steering: {
        pendingCount: steeringPendingCount,
        lastAppliedId: runState?.steeringLastAppliedId ?? null,
      },
      context: {
        compactedAt: runState?.compactedAt ?? null,
        compactedCount: runState?.compactedCount ?? 0,
        messageWindowCount: runState?.messageWindowCount ?? 0,
      },
    },
  };

  return { telemetry, includeSources };
}

export function summarizeLatestValidation(
  validation: StrategyValidationRun | null,
): string {
  if (!validation) return "No validation run recorded yet.";
  const metrics = validation.metrics;
  if (!metrics) return `Validation #${validation.id} is ${validation.status}.`;
  return `${validation.status.toUpperCase()} status=${validation.status} (${validation.profile}, ${validation.lookbackDays}d); trades=${metrics.tradeCount}, net=${metrics.netReturnPct.toFixed(2)}%, DD=${metrics.maxDrawdownPct.toFixed(2)}%, PF=${metrics.profitFactor.toFixed(2)}`;
}

export function maskSensitiveSources(
  context: TelemetrySnapshot,
): TelemetrySnapshot {
  return {
    ...context,
    config: {
      ...context.config,
      execution: context.config.execution
        ? {
            ...context.config.execution,
            params: context.config.execution.params
              ? { ...context.config.execution.params }
              : undefined,
          }
        : context.config.execution,
    },
  };
}
