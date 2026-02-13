import { getLoopConfig, updateLoopConfig } from "../config";
import { SOL_MINT, USDC_MINT } from "../defaults";
import type {
  DataSourcesConfig,
  DcaStrategy,
  Env,
  LoopAutotuneConfig,
  LoopConfig,
  LoopValidationConfig,
  RebalanceStrategy,
  StrategyConfig,
  StrategyRuntimeStateRow,
  ValidationGateMode,
  ValidationProfile,
} from "../types";
import { createDataSourceRegistry } from "../data_sources/registry";
import type { FixturePattern, PriceBar } from "../data_sources/types";
import { computeStrategyHash } from "./hash";
import { computeValidationMetrics, type ValidationMetrics } from "./metrics";
import { getValidationThresholds, type ValidationThresholds } from "./profiles";
import {
  completeValidationRun,
  createValidationRun,
  getLatestValidationForHash,
  getRuntimeState,
  recordStrategyEvent,
  updateRuntimeState,
} from "./repo";
import {
  applyValidationOutcome,
  markActiveState,
  markCandidateState,
} from "./state_machine";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type SimulatedSeries = {
  metrics: ValidationMetrics;
  equityCurve: number[];
  tradeReturns: number[];
};

export type StrategyRunner<T extends StrategyConfig = StrategyConfig> = {
  id: string;
  supports(strategy: StrategyConfig): strategy is T;
  simulate(
    strategy: T,
    bars: PriceBar[],
    effectiveCostBps: number,
  ): SimulatedSeries;
};

const CUSTOM_STRATEGY_RUNNERS: StrategyRunner[] = [];

export function registerStrategyRunner(runner: StrategyRunner): void {
  CUSTOM_STRATEGY_RUNNERS.unshift(runner);
}

export type NormalizedValidationConfig = {
  enabled: boolean;
  lookbackDays: number;
  profile: ValidationProfile;
  gateMode: ValidationGateMode;
  minTrades: number;
  autoEnableOnPass: boolean;
  overrideAllowed: boolean;
};

export type NormalizedAutotuneConfig = {
  enabled: boolean;
  mode: "conservative" | "off";
  cooldownHours: number;
  maxChangePctPerTune: number;
  rails: {
    dca: {
      everyMinutesMin: number;
      everyMinutesMax: number;
      amountMinRatio: number;
      amountMaxRatio: number;
    };
    rebalance: {
      thresholdPctMin: number;
      thresholdPctMax: number;
    };
  };
};

export type StrategyValidationResult = {
  validationId: number;
  tenantId: string;
  strategyHash: string;
  strategyType: "dca" | "rebalance";
  status: "passed" | "failed";
  metrics: ValidationMetrics;
  thresholds: ValidationThresholds;
  summary: string;
  lookbackDays: number;
  profile: ValidationProfile;
};

export type StartGateCheck = {
  ok: boolean;
  reason?: "strategy-not-validated" | "strategy-validation-stale";
  strategyHash?: string;
  overrideAllowed?: boolean;
};

export type StartGateLatestValidation = {
  status: string;
  completedAt?: string | null;
  createdAt: string;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampFloat(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeValidationConfig(
  input?: LoopValidationConfig,
): NormalizedValidationConfig {
  const profileRaw = input?.profile;
  const profile: ValidationProfile =
    profileRaw === "strict" || profileRaw === "loose" || profileRaw === "balanced"
      ? profileRaw
      : "balanced";
  const gateModeRaw = input?.gateMode;
  const gateMode: ValidationGateMode =
    gateModeRaw === "soft" || gateModeRaw === "hard" ? gateModeRaw : "hard";

  return {
    enabled: input?.enabled ?? true,
    lookbackDays: clampInt(input?.lookbackDays, 45, 7, 120),
    profile,
    gateMode,
    minTrades: clampInt(input?.minTrades, 8, 1, 5000),
    autoEnableOnPass: input?.autoEnableOnPass ?? true,
    overrideAllowed: input?.overrideAllowed ?? true,
  };
}

export function normalizeAutotuneConfig(
  input?: LoopAutotuneConfig,
): NormalizedAutotuneConfig {
  const mode = input?.mode === "off" ? "off" : "conservative";
  return {
    enabled: input?.enabled ?? true,
    mode,
    cooldownHours: clampInt(input?.cooldownHours, 24, 1, 24 * 30),
    maxChangePctPerTune: clampFloat(input?.maxChangePctPerTune, 10, 1, 50),
    rails: {
      dca: {
        everyMinutesMin: clampInt(input?.rails?.dca?.everyMinutesMin, 15, 1, 10_000),
        everyMinutesMax: clampInt(input?.rails?.dca?.everyMinutesMax, 240, 1, 10_000),
        amountMinRatio: clampFloat(0.5, 0.5, 0.1, 2),
        amountMaxRatio: clampFloat(1.5, 1.5, 0.1, 5),
      },
      rebalance: {
        thresholdPctMin: clampFloat(input?.rails?.rebalance?.thresholdPctMin, 0.005, 0.001, 1),
        thresholdPctMax: clampFloat(input?.rails?.rebalance?.thresholdPctMax, 0.05, 0.001, 1),
      },
    },
  };
}

function supportsQuantValidation(strategy: StrategyConfig | undefined): strategy is DcaStrategy | RebalanceStrategy {
  return (
    !!strategy &&
    typeof strategy === "object" &&
    ((strategy as StrategyConfig).type === "dca" ||
      (strategy as StrategyConfig).type === "rebalance")
  );
}

function parseMetricsMaybe(value: unknown): ValidationMetrics {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    netReturnPct: Number(v.netReturnPct ?? 0),
    maxDrawdownPct: Number(v.maxDrawdownPct ?? 0),
    profitFactor: Number(v.profitFactor ?? 0),
    winRate: Number(v.winRate ?? 0),
    tradeCount: Number(v.tradeCount ?? 0),
  };
}

function buildBarsRequest(
  strategy: DcaStrategy | RebalanceStrategy,
  lookbackDays: number,
  pattern?: FixturePattern,
): {
  baseMint: string;
  quoteMint: string;
  startMs: number;
  endMs: number;
  resolutionMinutes: 60;
  pattern?: FixturePattern;
} {
  const endMs = Date.now();
  const startMs = endMs - lookbackDays * DAY_MS;

  if (strategy.type === "rebalance") {
    return {
      baseMint: strategy.baseMint,
      quoteMint: strategy.quoteMint,
      startMs,
      endMs,
      resolutionMinutes: 60,
      pattern,
    };
  }

  // For DCA validation we map into a base/quote orientation suitable for directional evaluation.
  if (
    strategy.inputMint === USDC_MINT &&
    strategy.outputMint === SOL_MINT
  ) {
    return {
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
      startMs,
      endMs,
      resolutionMinutes: 60,
      pattern,
    };
  }

  if (
    strategy.inputMint === SOL_MINT &&
    strategy.outputMint === USDC_MINT
  ) {
    return {
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
      startMs,
      endMs,
      resolutionMinutes: 60,
      pattern,
    };
  }

  return {
    baseMint: strategy.outputMint,
    quoteMint: strategy.inputMint,
    startMs,
    endMs,
    resolutionMinutes: 60,
    pattern,
  };
}

function cappedReturn(ret: number): number {
  if (!Number.isFinite(ret)) return 0;
  return Math.max(-0.95, Math.min(5, ret));
}

function simulateDca(
  strategy: DcaStrategy,
  bars: PriceBar[],
  effectiveCostBps: number,
): SimulatedSeries {
  const sorted = [...bars].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const intervalBars = Math.max(1, Math.floor((strategy.everyMinutes ?? 60) / 60));
  const costRate = effectiveCostBps / 10_000;
  const finalClose = sorted[sorted.length - 1]?.close ?? 0;

  const longBias =
    strategy.inputMint === USDC_MINT && strategy.outputMint === SOL_MINT;
  const shortBias =
    strategy.inputMint === SOL_MINT && strategy.outputMint === USDC_MINT;

  const tradeReturns: number[] = [];
  const equityCurve: number[] = [1];
  let deployedNotional = 0;
  let terminalValue = 0;

  for (let i = 0; i < sorted.length; i += intervalBars) {
    const entry = sorted[i]?.close ?? 0;
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(finalClose) || finalClose <= 0) {
      continue;
    }

    // DCA validation models periodic entries with mark-to-market at the end
    // of the window. This avoids treating DCA as hourly round-trip scalping.
    const directional = longBias
      ? (finalClose - entry) / entry
      : shortBias
        ? (entry - finalClose) / entry
        : (finalClose - entry) / entry;

    const net = cappedReturn(directional - costRate);
    tradeReturns.push(net);

    deployedNotional += 1;
    terminalValue += Math.max(0.000001, 1 + net);
    equityCurve.push(Math.max(0.000001, terminalValue / deployedNotional));
  }

  return {
    metrics: computeValidationMetrics(equityCurve, tradeReturns),
    equityCurve,
    tradeReturns,
  };
}

function simulateRebalance(
  strategy: RebalanceStrategy,
  bars: PriceBar[],
  effectiveCostBps: number,
): SimulatedSeries {
  const sorted = [...bars].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (sorted.length < 2) {
    const empty = [1];
    return {
      metrics: computeValidationMetrics(empty, []),
      equityCurve: empty,
      tradeReturns: [],
    };
  }

  const target = clampFloat(strategy.targetBasePct, 0.5, 0, 1);
  const threshold = clampFloat(strategy.thresholdPct, 0.01, 0, 1);
  const costRate = effectiveCostBps / 10_000;

  let quoteCash = 0.5;
  let baseUnits = 0.5 / Math.max(0.000001, sorted[0]?.close ?? 1);
  const initialValue = Math.max(
    0.000001,
    baseUnits * (sorted[0]?.close ?? 1) + quoteCash,
  );

  const tradeReturns: number[] = [];
  const equityCurve: number[] = [1];

  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const price = sorted[i]?.close ?? 0;
    const nextPrice = sorted[i + 1]?.close ?? price;
    if (price <= 0 || nextPrice <= 0) continue;

    let valueNow = baseUnits * price + quoteCash;
    let baseValue = baseUnits * price;
    const basePct = valueNow > 0 ? baseValue / valueNow : 0;

    if (Math.abs(basePct - target) > threshold) {
      const desiredBaseValue = valueNow * target;
      const delta = desiredBaseValue - baseValue;
      if (delta > 0) {
        const spend = Math.min(delta, quoteCash);
        const fee = spend * costRate;
        const spendNet = Math.max(0, spend - fee);
        if (spend > 0) {
          baseUnits += spendNet / price;
          quoteCash -= spend;
        }
      } else if (delta < 0) {
        const sellValue = Math.min(-delta, baseValue);
        const fee = sellValue * costRate;
        const proceeds = Math.max(0, sellValue - fee);
        if (sellValue > 0) {
          baseUnits -= sellValue / price;
          quoteCash += proceeds;
        }
      }

      valueNow = baseUnits * price + quoteCash;
      const valueNext = baseUnits * nextPrice + quoteCash;
      if (valueNow > 0) {
        tradeReturns.push(cappedReturn((valueNext - valueNow) / valueNow));
      }
    }

    const valueNext = baseUnits * nextPrice + quoteCash;
    equityCurve.push(Math.max(0.000001, valueNext / initialValue));
  }

  return {
    metrics: computeValidationMetrics(equityCurve, tradeReturns),
    equityCurve,
    tradeReturns,
  };
}

const CORE_STRATEGY_RUNNERS: StrategyRunner[] = [
  {
    id: "dca",
    supports(strategy: StrategyConfig): strategy is DcaStrategy {
      return strategy.type === "dca";
    },
    simulate(strategy, bars, effectiveCostBps) {
      return simulateDca(strategy, bars, effectiveCostBps);
    },
  } satisfies StrategyRunner<DcaStrategy>,
  {
    id: "rebalance",
    supports(strategy: StrategyConfig): strategy is RebalanceStrategy {
      return strategy.type === "rebalance";
    },
    simulate(strategy, bars, effectiveCostBps) {
      return simulateRebalance(strategy, bars, effectiveCostBps);
    },
  } satisfies StrategyRunner<RebalanceStrategy>,
];

function runStrategySimulation(
  strategy: StrategyConfig,
  bars: PriceBar[],
  effectiveCostBps: number,
): SimulatedSeries {
  const runners = [...CUSTOM_STRATEGY_RUNNERS, ...CORE_STRATEGY_RUNNERS];
  for (const runner of runners) {
    if (runner.supports(strategy)) {
      return runner.simulate(strategy, bars, effectiveCostBps);
    }
  }
  throw new Error("no-strategy-runner-registered");
}

export function simulateStrategyForValidation(input: {
  strategy: StrategyConfig;
  bars: PriceBar[];
  effectiveCostBps: number;
  profile?: ValidationProfile;
  minTrades?: number;
}): {
  status: "passed" | "failed";
  metrics: ValidationMetrics;
  thresholds: ValidationThresholds;
  summary: string;
} {
  const thresholds = getValidationThresholds(
    input.profile ?? "balanced",
    input.minTrades,
  );
  const sim = runStrategySimulation(
    input.strategy,
    input.bars,
    input.effectiveCostBps,
  );
  const status = passThresholds(sim.metrics, thresholds) ? "passed" : "failed";
  return {
    status,
    metrics: sim.metrics,
    thresholds,
    summary: summarizeValidation(status, sim.metrics, thresholds),
  };
}

function passThresholds(
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
): boolean {
  return (
    metrics.netReturnPct > thresholds.netReturnPctMin &&
    metrics.maxDrawdownPct <= thresholds.maxDrawdownPctMax &&
    metrics.profitFactor >= thresholds.profitFactorMin &&
    metrics.tradeCount >= thresholds.minTrades
  );
}

function summarizeValidation(
  status: "passed" | "failed",
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
): string {
  return [
    `status=${status}`,
    `netReturnPct=${metrics.netReturnPct.toFixed(3)} (>${thresholds.netReturnPctMin})`,
    `maxDrawdownPct=${metrics.maxDrawdownPct.toFixed(3)} (<=${thresholds.maxDrawdownPctMax})`,
    `profitFactor=${metrics.profitFactor.toFixed(3)} (>=${thresholds.profitFactorMin})`,
    `tradeCount=${metrics.tradeCount} (>=${thresholds.minTrades})`,
  ].join("; ");
}

function shouldRiskOff(
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
): boolean {
  return (
    metrics.netReturnPct <= thresholds.netReturnPctMin ||
    metrics.maxDrawdownPct > thresholds.maxDrawdownPctMax * 0.8 ||
    metrics.profitFactor < thresholds.profitFactorMin
  );
}

function shouldRiskOn(
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
): boolean {
  return (
    metrics.netReturnPct > thresholds.netReturnPctMin + 1 &&
    metrics.maxDrawdownPct <= thresholds.maxDrawdownPctMax * 0.6 &&
    metrics.profitFactor >= thresholds.profitFactorMin * 1.15
  );
}

function adjustBigintByPct(value: bigint, pct: number, up: boolean): bigint {
  const p = Math.max(1, Math.min(50, Math.floor(pct)));
  const n = BigInt(up ? 100 + p : 100 - p);
  return (value * n) / 100n;
}

function clampBigint(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function tuneDcaStrategy(
  strategy: DcaStrategy,
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
  autotune: NormalizedAutotuneConfig,
): { changed: boolean; strategy: DcaStrategy; reason: string } {
  const currentAmount = BigInt(strategy.amount);
  const currentEvery = Math.max(1, Math.floor(strategy.everyMinutes ?? 60));

  const amountMin = BigInt(
    Math.max(
      1,
      Math.floor(Number(currentAmount.toString()) * autotune.rails.dca.amountMinRatio),
    ),
  );
  const amountMax = BigInt(
    Math.max(
      1,
      Math.floor(Number(currentAmount.toString()) * autotune.rails.dca.amountMaxRatio),
    ),
  );
  const everyMin = autotune.rails.dca.everyMinutesMin;
  const everyMax = autotune.rails.dca.everyMinutesMax;

  let nextAmount = currentAmount;
  let nextEvery = currentEvery;
  let reason = "no-change";

  if (shouldRiskOff(metrics, thresholds)) {
    nextAmount = adjustBigintByPct(currentAmount, autotune.maxChangePctPerTune, false);
    nextEvery = Math.floor(
      currentEvery * (1 + autotune.maxChangePctPerTune / 100),
    );
    reason = "risk-off";
  } else if (shouldRiskOn(metrics, thresholds)) {
    const halfChange = Math.max(1, autotune.maxChangePctPerTune / 2);
    nextAmount = adjustBigintByPct(currentAmount, halfChange, true);
    nextEvery = Math.floor(currentEvery * (1 - halfChange / 100));
    reason = "risk-on";
  }

  nextAmount = clampBigint(nextAmount, amountMin, amountMax);
  nextEvery = Math.max(everyMin, Math.min(everyMax, nextEvery));

  const changed = nextAmount !== currentAmount || nextEvery !== currentEvery;
  return {
    changed,
    strategy: {
      ...strategy,
      amount: nextAmount.toString(),
      everyMinutes: nextEvery,
    },
    reason,
  };
}

function tuneRebalanceStrategy(
  strategy: RebalanceStrategy,
  metrics: ValidationMetrics,
  thresholds: ValidationThresholds,
  autotune: NormalizedAutotuneConfig,
): { changed: boolean; strategy: RebalanceStrategy; reason: string } {
  const current = clampFloat(strategy.thresholdPct ?? 0.01, 0.01, 0, 1);
  const min = autotune.rails.rebalance.thresholdPctMin;
  const max = autotune.rails.rebalance.thresholdPctMax;

  let next = current;
  let reason = "no-change";
  if (shouldRiskOff(metrics, thresholds)) {
    next = current * (1 + autotune.maxChangePctPerTune / 100);
    reason = "risk-off";
  } else if (shouldRiskOn(metrics, thresholds)) {
    const halfChange = Math.max(1, autotune.maxChangePctPerTune / 2);
    next = current * (1 - halfChange / 100);
    reason = "risk-on";
  }

  next = Math.max(min, Math.min(max, next));
  const changed = Math.abs(next - current) > 1e-9;
  return {
    changed,
    strategy: {
      ...strategy,
      thresholdPct: next,
    },
    reason,
  };
}

export function applyConservativeTuneForValidation(input: {
  strategy: DcaStrategy | RebalanceStrategy;
  metrics: ValidationMetrics;
  thresholds: ValidationThresholds;
  autotune?: LoopAutotuneConfig;
}): {
  changed: boolean;
  strategy: DcaStrategy | RebalanceStrategy;
  reason: string;
} {
  const normalized = normalizeAutotuneConfig(input.autotune);
  if (input.strategy.type === "dca") {
    return tuneDcaStrategy(
      input.strategy,
      input.metrics,
      input.thresholds,
      normalized,
    );
  }
  return tuneRebalanceStrategy(
    input.strategy,
    input.metrics,
    input.thresholds,
    normalized,
  );
}

async function maybeAutoEnableValidatedStrategy(
  env: Env,
  tenantId: string,
  currentConfig: LoopConfig,
  actor: string,
  validationId: number,
): Promise<void> {
  if (currentConfig.enabled) return;

  const nextConfig = await updateLoopConfig(env, { enabled: true }, tenantId);
  await env.WAITLIST_DB.prepare(
    "UPDATE bots SET enabled = 1, updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(tenantId)
    .run()
    .catch(() => {});

  await recordStrategyEvent(env, {
    tenantId,
    eventType: "auto_enabled",
    actor,
    reason: "validation-passed",
    beforeConfig: currentConfig,
    afterConfig: nextConfig,
    validationId,
  });
}

export async function checkStrategyStartGate(
  env: Env,
  tenantId: string,
  config?: LoopConfig,
): Promise<StartGateCheck> {
  const currentConfig = config ?? (await getLoopConfig(env, tenantId));
  const strategy = currentConfig.strategy;
  if (!supportsQuantValidation(strategy)) {
    return { ok: true };
  }

  const validation = normalizeValidationConfig(currentConfig.validation);
  if (!validation.enabled || validation.gateMode !== "hard") {
    return { ok: true };
  }

  const strategyHash = await computeStrategyHash(currentConfig);
  const latest = await getLatestValidationForHash(env, tenantId, strategyHash);
  return evaluateStartGate({
    validation,
    strategyHash,
    latest: latest
      ? {
          status: latest.status,
          completedAt: latest.completedAt,
          createdAt: latest.createdAt,
        }
      : null,
  });
}

export function evaluateStartGate(input: {
  validation: NormalizedValidationConfig;
  strategyHash: string;
  latest: StartGateLatestValidation | null;
  nowMs?: number;
}): StartGateCheck {
  if (!input.validation.enabled || input.validation.gateMode !== "hard") {
    return { ok: true };
  }
  if (!input.latest || input.latest.status !== "passed") {
    return {
      ok: false,
      reason: "strategy-not-validated",
      strategyHash: input.strategyHash,
      overrideAllowed: input.validation.overrideAllowed,
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  const latestMs = Date.parse(input.latest.completedAt ?? input.latest.createdAt);
  if (!Number.isFinite(latestMs) || nowMs - latestMs > DAY_MS) {
    return {
      ok: false,
      reason: "strategy-validation-stale",
      strategyHash: input.strategyHash,
      overrideAllowed: input.validation.overrideAllowed,
    };
  }
  return {
    ok: true,
    strategyHash: input.strategyHash,
    overrideAllowed: input.validation.overrideAllowed,
  };
}

export async function runValidationForTenant(
  env: Env,
  tenantId: string,
  opts?: {
    actor?: string;
    reason?: string;
    fixturePattern?: FixturePattern;
    autoEnableOnPass?: boolean;
  },
): Promise<StrategyValidationResult> {
  const actor = opts?.actor ?? "system";
  const reason = opts?.reason ?? "manual";
  const currentConfig = await getLoopConfig(env, tenantId);
  const strategy = currentConfig.strategy;

  if (!supportsQuantValidation(strategy)) {
    throw new Error("unsupported-strategy-for-validation");
  }

  const validation = normalizeValidationConfig(currentConfig.validation);
  if (!validation.enabled) {
    throw new Error("validation-disabled");
  }

  const thresholds = getValidationThresholds(validation.profile, validation.minTrades);
  const strategyHash = await computeStrategyHash(currentConfig);
  const runId = await createValidationRun(env, {
    tenantId,
    strategyHash,
    strategyType: strategy.type,
    lookbackDays: validation.lookbackDays,
    profile: validation.profile,
  });

  const runtime = await getRuntimeState(env, tenantId);
  await updateRuntimeState(env, tenantId, {
    lifecycleState: "validating",
    updatedAt: new Date().toISOString(),
  });

  try {
    const barsRequest = buildBarsRequest(
      strategy,
      validation.lookbackDays,
      opts?.fixturePattern ?? currentConfig.dataSources?.fixturePattern,
    );

    const registry = createDataSourceRegistry(
      env,
      currentConfig.dataSources as DataSourcesConfig | undefined,
    );
    const bars = await registry.fetchHourlyBars(barsRequest);
    if (bars.length < 48) {
      throw new Error("not-enough-bars");
    }

    const effectiveCostBps = clampFloat(
      Number(currentConfig.policy?.slippageBps ?? 50) + 5,
      55,
      0,
      10_000,
    );

    const sim = runStrategySimulation(strategy, bars, effectiveCostBps);

    const status: "passed" | "failed" = passThresholds(sim.metrics, thresholds)
      ? "passed"
      : "failed";

    const summary = summarizeValidation(status, sim.metrics, thresholds);
    await completeValidationRun(env, {
      id: runId,
      status,
      metrics: sim.metrics as unknown as Record<string, unknown>,
      thresholds: thresholds as unknown as Record<string, unknown>,
      summary,
    });

    const nextRuntime = applyValidationOutcome(runtime, {
      status,
      validationId: runId,
      strategyHash,
    });
    await updateRuntimeState(env, tenantId, nextRuntime);

    await recordStrategyEvent(env, {
      tenantId,
      eventType: status === "passed" ? "validation_passed" : "validation_failed",
      actor,
      reason,
      beforeConfig: currentConfig,
      afterConfig: currentConfig,
      validationId: runId,
    });

    const shouldEnable =
      status === "passed" &&
      validation.autoEnableOnPass &&
      (opts?.autoEnableOnPass ?? true);
    if (shouldEnable) {
      await maybeAutoEnableValidatedStrategy(env, tenantId, currentConfig, actor, runId);
      const after = await getRuntimeState(env, tenantId);
      await updateRuntimeState(env, tenantId, markActiveState(after));
    }

    return {
      validationId: runId,
      tenantId,
      strategyHash,
      strategyType: strategy.type,
      status,
      metrics: sim.metrics,
      thresholds,
      summary,
      lookbackDays: validation.lookbackDays,
      profile: validation.profile,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallbackMetrics: ValidationMetrics = {
      netReturnPct: 0,
      maxDrawdownPct: 100,
      profitFactor: 0,
      winRate: 0,
      tradeCount: 0,
    };
    const summary = `status=failed; reason=${message}`;

    await completeValidationRun(env, {
      id: runId,
      status: "failed",
      metrics: fallbackMetrics as unknown as Record<string, unknown>,
      thresholds: thresholds as unknown as Record<string, unknown>,
      summary,
    }).catch(() => {});

    const nextRuntime = applyValidationOutcome(runtime, {
      status: "failed",
      validationId: runId,
      strategyHash,
    });
    await updateRuntimeState(env, tenantId, nextRuntime).catch(() => {});

    await recordStrategyEvent(env, {
      tenantId,
      eventType: "validation_failed",
      actor,
      reason: message,
      beforeConfig: currentConfig,
      afterConfig: currentConfig,
      validationId: runId,
    }).catch(() => {});

    return {
      validationId: runId,
      tenantId,
      strategyHash,
      strategyType: strategy.type,
      status: "failed",
      metrics: fallbackMetrics,
      thresholds,
      summary,
      lookbackDays: validation.lookbackDays,
      profile: validation.profile,
    };
  }
}

export async function markStrategyCandidateFromConfigChange(
  env: Env,
  tenantId: string,
  input: {
    actor: string;
    reason: string;
    beforeConfig: LoopConfig;
    afterConfig: LoopConfig;
  },
): Promise<void> {
  const beforeHash = await computeStrategyHash(input.beforeConfig);
  const afterHash = await computeStrategyHash(input.afterConfig);
  if (beforeHash === afterHash) return;

  const current = await getRuntimeState(env, tenantId);
  await updateRuntimeState(env, tenantId, markCandidateState(current));
  await recordStrategyEvent(env, {
    tenantId,
    eventType: "config_updated",
    actor: input.actor,
    reason: input.reason,
    beforeConfig: input.beforeConfig,
    afterConfig: input.afterConfig,
    validationId: null,
  });
}

function canTune(
  runtime: StrategyRuntimeStateRow,
  autotune: NormalizedAutotuneConfig,
): boolean {
  if (!autotune.enabled || autotune.mode === "off") return false;
  if (!runtime.lastTunedAt) return true;
  const last = Date.parse(runtime.lastTunedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= autotune.cooldownHours * HOUR_MS;
}

export async function maybeRevalidateAndTuneForTenant(
  env: Env,
  tenantId: string,
  log?: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>,
  ) => void,
): Promise<void> {
  const currentConfig = await getLoopConfig(env, tenantId);
  if (!supportsQuantValidation(currentConfig.strategy)) return;

  const validation = normalizeValidationConfig(currentConfig.validation);
  if (!validation.enabled) return;

  const runtime = await getRuntimeState(env, tenantId);
  const nextAt = runtime.nextRevalidateAt ? Date.parse(runtime.nextRevalidateAt) : NaN;
  if (Number.isFinite(nextAt) && nextAt > Date.now()) return;

  const result = await runValidationForTenant(env, tenantId, {
    actor: "system",
    reason: "daily-revalidate",
    autoEnableOnPass: false,
  });

  if (result.status === "passed") {
    const fresh = await getRuntimeState(env, tenantId);
    await updateRuntimeState(env, tenantId, markActiveState(fresh));
    log?.("info", "daily revalidation passed", {
      validationId: result.validationId,
      metrics: result.metrics,
    });
    return;
  }

  let fresh = await getRuntimeState(env, tenantId);
  const autotune = normalizeAutotuneConfig(currentConfig.autotune);

  if (fresh.consecutiveFailures === 1 && canTune(fresh, autotune)) {
    const strategy = currentConfig.strategy;
    let tuned:
      | { changed: boolean; strategy: DcaStrategy | RebalanceStrategy; reason: string }
      | null = null;

    if (strategy?.type === "dca") {
      tuned = tuneDcaStrategy(strategy, result.metrics, result.thresholds, autotune);
    } else if (strategy?.type === "rebalance") {
      tuned = tuneRebalanceStrategy(strategy, result.metrics, result.thresholds, autotune);
    }

    if (tuned?.changed) {
      const beforeConfig = currentConfig;
      const afterConfig = await updateLoopConfig(
        env,
        {
          strategy: tuned.strategy,
        },
        tenantId,
      );

      fresh = await updateRuntimeState(env, tenantId, {
        lifecycleState: "watch",
        lastTunedAt: new Date().toISOString(),
      });

      await recordStrategyEvent(env, {
        tenantId,
        eventType: "autotune_applied",
        actor: "system",
        reason: tuned.reason,
        beforeConfig,
        afterConfig,
        validationId: result.validationId,
      });

      log?.("warn", "autotune applied after failed revalidation", {
        validationId: result.validationId,
        reason: tuned.reason,
      });
    }
  }

  if (fresh.consecutiveFailures >= 2) {
    const beforeConfig = await getLoopConfig(env, tenantId);
    const afterConfig = await updateLoopConfig(env, { enabled: false }, tenantId);
    await env.WAITLIST_DB.prepare(
      "UPDATE bots SET enabled = 0, last_error = ?1, updated_at = datetime('now') WHERE id = ?2",
    )
      .bind("validation-failed", tenantId)
      .run()
      .catch(() => {});

    await updateRuntimeState(env, tenantId, {
      lifecycleState: "suspended",
      nextRevalidateAt: null,
    });

    await recordStrategyEvent(env, {
      tenantId,
      eventType: "auto_suspended",
      actor: "system",
      reason: "validation-failed-twice",
      beforeConfig,
      afterConfig,
      validationId: result.validationId,
    });

    log?.("error", "strategy auto-suspended after repeated validation failure", {
      validationId: result.validationId,
    });
  }
}

export function metricsFromValidationRun(
  metrics: unknown,
): ValidationMetrics {
  return parseMetricsMaybe(metrics);
}
