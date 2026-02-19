import type {
  DataSourcesConfig,
  ExecutionConfig,
  LoopAutotuneConfig,
  LoopPolicy,
  LoopValidationConfig,
  StrategyConfig,
} from "./types";

export function validateStrategy(strategy: unknown): void {
  if (!strategy || typeof strategy !== "object") return;
  const s = strategy as Record<string, unknown>;
  const type = s.type;
  if (
    type !== "noop" &&
    type !== "dca" &&
    type !== "rebalance" &&
    type !== "agent" &&
    type !== "prediction_market"
  ) {
    throw new Error("invalid-strategy-type");
  }
  if (type === "dca") {
    if (!s.inputMint || typeof s.inputMint !== "string") {
      throw new Error("invalid-dca-inputMint");
    }
    if (!s.outputMint || typeof s.outputMint !== "string") {
      throw new Error("invalid-dca-outputMint");
    }
    if (
      !s.amount ||
      typeof s.amount !== "string" ||
      !/^[0-9]+$/.test(s.amount) ||
      s.amount === "0"
    ) {
      throw new Error("invalid-dca-amount");
    }
  }
  if (type === "rebalance") {
    if (!s.baseMint || typeof s.baseMint !== "string") {
      throw new Error("invalid-rebalance-baseMint");
    }
    if (!s.quoteMint || typeof s.quoteMint !== "string") {
      throw new Error("invalid-rebalance-quoteMint");
    }
    const pct = Number(s.targetBasePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      throw new Error("invalid-rebalance-targetBasePct");
    }
  }
  if (type === "agent") {
    if (s.minConfidence !== undefined) {
      const c = String(s.minConfidence);
      if (c !== "low" && c !== "medium" && c !== "high") {
        throw new Error("invalid-agent-minConfidence");
      }
    }
    if (s.maxStepsPerTick !== undefined) {
      const n = Number(s.maxStepsPerTick);
      if (!Number.isFinite(n) || n < 1 || n > 12) {
        throw new Error("invalid-agent-maxStepsPerTick");
      }
    }
    if (s.maxToolCallsPerStep !== undefined) {
      const n = Number(s.maxToolCallsPerStep);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        throw new Error("invalid-agent-maxToolCallsPerStep");
      }
    }
    if (s.allowedActions !== undefined) {
      if (!Array.isArray(s.allowedActions)) {
        throw new Error("invalid-agent-allowedActions");
      }
      const valid = new Set([
        "trade",
        "update_thesis",
        "log_observation",
        "skip",
      ]);
      for (const item of s.allowedActions) {
        if (typeof item !== "string" || !valid.has(item)) {
          throw new Error("invalid-agent-allowedActions");
        }
      }
    }
    if (s.toolPolicy !== undefined) {
      if (
        !s.toolPolicy ||
        typeof s.toolPolicy !== "object" ||
        Array.isArray(s.toolPolicy)
      ) {
        throw new Error("invalid-agent-toolPolicy");
      }
      const p = s.toolPolicy as Record<string, unknown>;
      for (const key of ["allow", "deny"] as const) {
        if (p[key] !== undefined) {
          if (!Array.isArray(p[key]))
            throw new Error("invalid-agent-toolPolicy");
          for (const name of p[key] as unknown[]) {
            if (typeof name !== "string" || !name.trim()) {
              throw new Error("invalid-agent-toolPolicy");
            }
          }
        }
      }
      if (p.allowAll !== undefined && typeof p.allowAll !== "boolean") {
        throw new Error("invalid-agent-toolPolicy");
      }
    }
    if (s.quoteMint !== undefined) {
      if (typeof s.quoteMint !== "string" || !s.quoteMint.trim()) {
        throw new Error("invalid-agent-quoteMint");
      }
    }
    if (s.quoteDecimals !== undefined) {
      const n = Number(s.quoteDecimals);
      if (!Number.isFinite(n) || n < 0 || n > 18) {
        throw new Error("invalid-agent-quoteDecimals");
      }
    }
  }
  if (type === "prediction_market") {
    if (!s.venue || typeof s.venue !== "string") {
      throw new Error("invalid-prediction-market-venue");
    }
    if (!s.marketId || typeof s.marketId !== "string") {
      throw new Error("invalid-prediction-market-marketId");
    }
    if (s.side !== undefined) {
      const side = String(s.side);
      if (side !== "yes" && side !== "no") {
        throw new Error("invalid-prediction-market-side");
      }
    }
    if (s.maxStakeAtomic !== undefined) {
      if (
        typeof s.maxStakeAtomic !== "string" ||
        !/^[0-9]+$/.test(s.maxStakeAtomic)
      ) {
        throw new Error("invalid-prediction-market-maxStakeAtomic");
      }
    }
  }
}

export function validatePolicy(policy: unknown): void {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("invalid-policy");
  }
  const p = policy as Record<string, unknown>;

  if (p.killSwitch !== undefined && typeof p.killSwitch !== "boolean") {
    throw new Error("invalid-policy-killSwitch");
  }
  if (p.allowedMints !== undefined) {
    if (!Array.isArray(p.allowedMints))
      throw new Error("invalid-policy-allowedMints");
    for (const mint of p.allowedMints) {
      if (typeof mint !== "string" || !mint.trim()) {
        throw new Error("invalid-policy-allowedMints");
      }
    }
  }
  if (p.maxTradeAmountAtomic !== undefined) {
    if (
      typeof p.maxTradeAmountAtomic !== "string" ||
      !/^[0-9]+$/.test(p.maxTradeAmountAtomic)
    ) {
      throw new Error("invalid-policy-maxTradeAmountAtomic");
    }
  }
  if (p.maxPriceImpactPct !== undefined) {
    if (
      typeof p.maxPriceImpactPct !== "number" ||
      !Number.isFinite(p.maxPriceImpactPct)
    ) {
      throw new Error("invalid-policy-maxPriceImpactPct");
    }
    if (p.maxPriceImpactPct < 0 || p.maxPriceImpactPct > 1) {
      throw new Error("invalid-policy-maxPriceImpactPct");
    }
  }
  if (p.slippageBps !== undefined) {
    if (typeof p.slippageBps !== "number" || !Number.isFinite(p.slippageBps)) {
      throw new Error("invalid-policy-slippageBps");
    }
    if (p.slippageBps < 0 || p.slippageBps > 10_000) {
      throw new Error("invalid-policy-slippageBps");
    }
  }
  for (const key of ["simulateOnly", "dryRun", "skipPreflight"] as const) {
    if (p[key] !== undefined && typeof p[key] !== "boolean") {
      throw new Error(`invalid-policy-${key}`);
    }
  }
  if (p.commitment !== undefined) {
    const c = String(p.commitment);
    if (c !== "processed" && c !== "confirmed" && c !== "finalized") {
      throw new Error("invalid-policy-commitment");
    }
  }
  if (p.minSolReserveLamports !== undefined) {
    if (
      typeof p.minSolReserveLamports !== "string" ||
      !/^[0-9]+$/.test(p.minSolReserveLamports)
    ) {
      throw new Error("invalid-policy-minSolReserveLamports");
    }
  }
}

export function validateValidationConfig(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-validation-config");
  }
  const v = input as Record<string, unknown>;
  if (v.enabled !== undefined && typeof v.enabled !== "boolean") {
    throw new Error("invalid-validation-enabled");
  }
  if (v.lookbackDays !== undefined) {
    const n = Number(v.lookbackDays);
    if (!Number.isFinite(n) || n < 7 || n > 120) {
      throw new Error("invalid-validation-lookbackDays");
    }
  }
  if (v.profile !== undefined) {
    const p = String(v.profile);
    if (p !== "balanced" && p !== "strict" && p !== "loose") {
      throw new Error("invalid-validation-profile");
    }
  }
  if (v.gateMode !== undefined) {
    const mode = String(v.gateMode);
    if (mode !== "hard" && mode !== "soft") {
      throw new Error("invalid-validation-gateMode");
    }
  }
  if (v.minTrades !== undefined) {
    const n = Number(v.minTrades);
    if (!Number.isFinite(n) || n < 1 || n > 5000) {
      throw new Error("invalid-validation-minTrades");
    }
  }
  if (
    v.autoEnableOnPass !== undefined &&
    typeof v.autoEnableOnPass !== "boolean"
  ) {
    throw new Error("invalid-validation-autoEnableOnPass");
  }
  if (
    v.overrideAllowed !== undefined &&
    typeof v.overrideAllowed !== "boolean"
  ) {
    throw new Error("invalid-validation-overrideAllowed");
  }
}

export function validateAutotuneConfig(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-autotune-config");
  }
  const a = input as Record<string, unknown>;
  if (a.enabled !== undefined && typeof a.enabled !== "boolean") {
    throw new Error("invalid-autotune-enabled");
  }
  if (a.mode !== undefined) {
    const mode = String(a.mode);
    if (mode !== "conservative" && mode !== "off") {
      throw new Error("invalid-autotune-mode");
    }
  }
  if (a.cooldownHours !== undefined) {
    const n = Number(a.cooldownHours);
    if (!Number.isFinite(n) || n < 1 || n > 720) {
      throw new Error("invalid-autotune-cooldownHours");
    }
  }
  if (a.maxChangePctPerTune !== undefined) {
    const n = Number(a.maxChangePctPerTune);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      throw new Error("invalid-autotune-maxChangePctPerTune");
    }
  }
  if (a.rails !== undefined) {
    if (!a.rails || typeof a.rails !== "object" || Array.isArray(a.rails)) {
      throw new Error("invalid-autotune-rails");
    }
    const rails = a.rails as Record<string, unknown>;
    if (rails.dca !== undefined) {
      if (
        !rails.dca ||
        typeof rails.dca !== "object" ||
        Array.isArray(rails.dca)
      ) {
        throw new Error("invalid-autotune-rails-dca");
      }
      const dca = rails.dca as Record<string, unknown>;
      if (
        dca.amountMin !== undefined &&
        (typeof dca.amountMin !== "string" || !/^[0-9]+$/.test(dca.amountMin))
      ) {
        throw new Error("invalid-autotune-rails-dca-amountMin");
      }
      if (
        dca.amountMax !== undefined &&
        (typeof dca.amountMax !== "string" || !/^[0-9]+$/.test(dca.amountMax))
      ) {
        throw new Error("invalid-autotune-rails-dca-amountMax");
      }
      for (const key of ["everyMinutesMin", "everyMinutesMax"] as const) {
        if (dca[key] !== undefined) {
          const n = Number(dca[key]);
          if (!Number.isFinite(n) || n < 1 || n > 10_000) {
            throw new Error(`invalid-autotune-rails-dca-${key}`);
          }
        }
      }
    }
    if (rails.rebalance !== undefined) {
      if (
        !rails.rebalance ||
        typeof rails.rebalance !== "object" ||
        Array.isArray(rails.rebalance)
      ) {
        throw new Error("invalid-autotune-rails-rebalance");
      }
      const reb = rails.rebalance as Record<string, unknown>;
      for (const key of ["thresholdPctMin", "thresholdPctMax"] as const) {
        if (reb[key] !== undefined) {
          const n = Number(reb[key]);
          if (!Number.isFinite(n) || n < 0 || n > 1) {
            throw new Error(`invalid-autotune-rails-rebalance-${key}`);
          }
        }
      }
    }
  }
}

export function validateExecutionConfig(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-execution-config");
  }
  const e = input as Record<string, unknown>;
  if (e.adapter !== undefined) {
    const adapter = String(e.adapter);
    if (!adapter.trim() || !/^[a-z0-9_:-]+$/i.test(adapter)) {
      throw new Error("invalid-execution-adapter");
    }
  }
  if (e.params !== undefined) {
    if (!e.params || typeof e.params !== "object" || Array.isArray(e.params)) {
      throw new Error("invalid-execution-params");
    }
  }
}

export function validateDataSourcesConfig(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-dataSources-config");
  }
  const d = input as Record<string, unknown>;
  if (d.priority !== undefined) {
    if (!Array.isArray(d.priority)) {
      throw new Error("invalid-dataSources-priority");
    }
    for (const source of d.priority) {
      if (typeof source !== "string" || !source.trim()) {
        throw new Error("invalid-dataSources-priority");
      }
    }
  }
  if (d.cacheTtlMinutes !== undefined) {
    const n = Number(d.cacheTtlMinutes);
    if (!Number.isFinite(n) || n < 0 || n > 24 * 60) {
      throw new Error("invalid-dataSources-cacheTtlMinutes");
    }
  }
  if (d.providers !== undefined) {
    if (
      !d.providers ||
      typeof d.providers !== "object" ||
      Array.isArray(d.providers)
    ) {
      throw new Error("invalid-dataSources-providers");
    }
    for (const [name, providerConfig] of Object.entries(d.providers)) {
      if (!name.trim()) {
        throw new Error("invalid-dataSources-providers");
      }
      if (
        !providerConfig ||
        typeof providerConfig !== "object" ||
        Array.isArray(providerConfig)
      ) {
        throw new Error("invalid-dataSources-provider-config");
      }
    }
  }
  if (d.fixturePattern !== undefined) {
    const pattern = String(d.fixturePattern);
    if (
      pattern !== "uptrend" &&
      pattern !== "downtrend" &&
      pattern !== "whipsaw"
    ) {
      throw new Error("invalid-dataSources-fixturePattern");
    }
  }
}

// Narrowing helpers for callers who want to rely on the type post-validation.
export function asStrategyConfig(value: unknown): StrategyConfig {
  validateStrategy(value);
  return value as StrategyConfig;
}

export function asLoopPolicy(value: unknown): LoopPolicy {
  validatePolicy(value);
  return value as LoopPolicy;
}

export function asLoopValidationConfig(value: unknown): LoopValidationConfig {
  validateValidationConfig(value);
  return value as LoopValidationConfig;
}

export function asLoopAutotuneConfig(value: unknown): LoopAutotuneConfig {
  validateAutotuneConfig(value);
  return value as LoopAutotuneConfig;
}

export function asExecutionConfig(value: unknown): ExecutionConfig {
  validateExecutionConfig(value);
  return value as ExecutionConfig;
}

export function asDataSourcesConfig(value: unknown): DataSourcesConfig {
  validateDataSourcesConfig(value);
  return value as DataSourcesConfig;
}
