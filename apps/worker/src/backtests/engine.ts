import { getLoopConfig } from "../config";
import { createDataSourceRegistry } from "../data_sources/registry";
import type { FixturePattern } from "../data_sources/types";
import {
  normalizeValidationConfig,
  runValidationForTenant,
  simulateStrategyForValidation,
} from "../strategy_validation/engine";
import type {
  DataSourcesConfig,
  Env,
  StrategyConfig,
  ValidationProfile,
} from "../types";
import { appendBacktestRunEvent } from "./repo";
import type {
  BacktestRunRequest,
  BacktestRunRow,
  BacktestRunSummary,
  StrategyJsonBacktestSpec,
} from "./types";

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

function normalizeFixturePattern(value: unknown): FixturePattern | undefined {
  const raw = String(value ?? "").trim();
  if (raw === "uptrend" || raw === "downtrend" || raw === "whipsaw") {
    return raw;
  }
  return undefined;
}

function normalizeValidationProfile(value: unknown): ValidationProfile {
  const raw = String(value ?? "balanced").trim();
  if (raw === "strict" || raw === "loose" || raw === "balanced") {
    return raw;
  }
  return "balanced";
}

function normalizeStrategyJsonSpec(input: unknown): StrategyJsonBacktestSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-backtest-spec");
  }
  const spec = input as Record<string, unknown>;

  const strategyRaw = spec.strategy;
  if (
    !strategyRaw ||
    typeof strategyRaw !== "object" ||
    Array.isArray(strategyRaw)
  ) {
    throw new Error("invalid-backtest-strategy");
  }
  const strategy = strategyRaw as StrategyConfig;
  const strategyType = String(
    (strategyRaw as Record<string, unknown>).type ?? "",
  ).trim();
  if (!strategyType) {
    throw new Error("invalid-backtest-strategy-type");
  }

  const marketRaw = spec.market;
  if (!marketRaw || typeof marketRaw !== "object" || Array.isArray(marketRaw)) {
    throw new Error("invalid-backtest-market");
  }
  const market = marketRaw as Record<string, unknown>;
  const baseMint = String(market.baseMint ?? "").trim();
  const quoteMint = String(market.quoteMint ?? "").trim();
  if (!baseMint || !quoteMint) {
    throw new Error("invalid-backtest-market-mints");
  }

  const validationRaw =
    spec.validation &&
    typeof spec.validation === "object" &&
    !Array.isArray(spec.validation)
      ? (spec.validation as Record<string, unknown>)
      : {};

  const dataSourcesRaw =
    spec.dataSources &&
    typeof spec.dataSources === "object" &&
    !Array.isArray(spec.dataSources)
      ? (spec.dataSources as DataSourcesConfig)
      : undefined;

  return {
    strategy,
    market: {
      baseMint,
      quoteMint,
    },
    validation: {
      lookbackDays: clampInt(validationRaw.lookbackDays, 45, 7, 120),
      profile: normalizeValidationProfile(validationRaw.profile),
      minTrades: clampInt(validationRaw.minTrades, 8, 1, 500),
      effectiveCostBps: clampInt(validationRaw.effectiveCostBps, 55, 0, 10_000),
      endMs: clampInt(
        validationRaw.endMs,
        Date.now(),
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    dataSources: dataSourcesRaw,
  };
}

export function normalizeBacktestRunRequest(
  payload: Record<string, unknown>,
): BacktestRunRequest {
  const kindRaw = String(payload.kind ?? "validation").trim();
  if (kindRaw === "validation") {
    return {
      kind: "validation",
      fixturePattern: normalizeFixturePattern(payload.fixturePattern),
    };
  }

  if (kindRaw === "strategy_json") {
    return {
      kind: "strategy_json",
      spec: normalizeStrategyJsonSpec(payload.spec),
    };
  }

  throw new Error("invalid-backtest-kind");
}

export function newBacktestRunId(): string {
  return crypto.randomUUID();
}

export type ExecutedBacktest = {
  summary: BacktestRunSummary;
  result: Record<string, unknown>;
};

export async function executeBacktestRun(
  env: Env,
  run: BacktestRunRow,
): Promise<ExecutedBacktest> {
  if (run.request.kind === "validation") {
    await appendBacktestRunEvent(env, {
      runId: run.runId,
      tenantId: run.tenantId,
      level: "info",
      message: "validation-backtest-started",
      meta: {
        fixturePattern: run.request.fixturePattern ?? null,
      },
    });

    const result = await runValidationForTenant(env, run.tenantId, {
      actor: "user",
      reason: "backtest-queue",
      fixturePattern: run.request.fixturePattern,
      autoEnableOnPass: false,
    });

    const summary: BacktestRunSummary = {
      strategyLabel: `validation:${result.strategyType}`,
      netReturnPct: result.metrics.netReturnPct,
      maxDrawdownPct: result.metrics.maxDrawdownPct,
      tradeCount: result.metrics.tradeCount,
      validationStatus: result.status,
    };

    return {
      summary,
      result: {
        kind: "validation",
        validation: result,
      },
    };
  }

  const config = await getLoopConfig(env, run.tenantId);
  const spec = run.request.spec;
  const validationCfg = normalizeValidationConfig(config.validation);
  const lookbackDays = clampInt(
    spec.validation?.lookbackDays,
    validationCfg.lookbackDays,
    7,
    120,
  );
  const profile = normalizeValidationProfile(
    spec.validation?.profile ?? validationCfg.profile,
  );
  const minTrades = clampInt(
    spec.validation?.minTrades,
    validationCfg.minTrades,
    1,
    500,
  );
  const effectiveCostBps = clampInt(
    spec.validation?.effectiveCostBps,
    Number(config.policy?.slippageBps ?? 50) + 5,
    0,
    10_000,
  );
  const endMs = clampInt(
    spec.validation?.endMs,
    Date.now(),
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const startMs = endMs - lookbackDays * 24 * 60 * 60 * 1000;

  const registry = createDataSourceRegistry(env, {
    ...(config.dataSources ?? {}),
    ...(spec.dataSources ?? {}),
  });

  await appendBacktestRunEvent(env, {
    runId: run.runId,
    tenantId: run.tenantId,
    level: "info",
    message: "strategy-json-backtest-started",
    meta: {
      lookbackDays,
      profile,
      minTrades,
      effectiveCostBps,
    },
  });

  const bars = await registry.fetchHourlyBars({
    baseMint: spec.market.baseMint,
    quoteMint: spec.market.quoteMint,
    startMs,
    endMs,
    resolutionMinutes: 60,
  });

  if (bars.length < 48) {
    throw new Error("not-enough-bars");
  }

  const sim = simulateStrategyForValidation({
    strategy: spec.strategy,
    bars,
    effectiveCostBps,
    profile,
    minTrades,
  });

  const strategyTypeRaw =
    spec.strategy &&
    typeof spec.strategy === "object" &&
    !Array.isArray(spec.strategy)
      ? String(
          (spec.strategy as Record<string, unknown>).type ?? "strategy_json",
        )
      : "strategy_json";

  const summary: BacktestRunSummary = {
    strategyLabel: strategyTypeRaw || "strategy_json",
    netReturnPct: sim.metrics.netReturnPct,
    maxDrawdownPct: sim.metrics.maxDrawdownPct,
    tradeCount: sim.metrics.tradeCount,
    validationStatus: sim.status,
  };

  return {
    summary,
    result: {
      kind: "strategy_json",
      market: spec.market,
      strategy: spec.strategy,
      barsCount: bars.length,
      lookbackDays,
      profile,
      minTrades,
      effectiveCostBps,
      simulation: sim,
    },
  };
}
