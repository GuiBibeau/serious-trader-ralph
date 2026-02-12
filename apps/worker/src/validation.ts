import type { LoopPolicy, StrategyConfig } from "./types";

export function validateStrategy(strategy: unknown): void {
  if (!strategy || typeof strategy !== "object") return;
  const s = strategy as Record<string, unknown>;
  const type = s.type;
  if (
    type !== "noop" &&
    type !== "dca" &&
    type !== "rebalance" &&
    type !== "agent"
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
    if (s.maxTradesPerDay !== undefined) {
      const n = Number(s.maxTradesPerDay);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error("invalid-agent-maxTradesPerDay");
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

// Narrowing helpers for callers who want to rely on the type post-validation.
export function asStrategyConfig(value: unknown): StrategyConfig {
  validateStrategy(value);
  return value as StrategyConfig;
}

export function asLoopPolicy(value: unknown): LoopPolicy {
  validatePolicy(value);
  return value as LoopPolicy;
}
