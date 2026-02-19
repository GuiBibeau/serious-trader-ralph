import type { LoopConfig, LoopPolicy } from "../types";

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = stableNormalize(rec[key]);
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function policySubset(policy: LoopPolicy | undefined): Record<string, unknown> {
  if (!policy) return {};
  return {
    allowedMints: Array.isArray(policy.allowedMints)
      ? [...policy.allowedMints].sort()
      : [],
    maxTradeAmountAtomic: policy.maxTradeAmountAtomic ?? "0",
    maxPriceImpactPct: policy.maxPriceImpactPct ?? 0.02,
    slippageBps: policy.slippageBps ?? 50,
    minSolReserveLamports: policy.minSolReserveLamports ?? "50000000",
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeStrategyHash(config: LoopConfig): Promise<string> {
  const payload = {
    strategy: config.strategy ?? { type: "noop" },
    policy: policySubset(config.policy),
    validation: {
      lookbackDays: config.validation?.lookbackDays ?? 45,
      profile: config.validation?.profile ?? "balanced",
      minTrades: config.validation?.minTrades ?? 8,
    },
  };
  return await sha256Hex(stableStringify(payload));
}
