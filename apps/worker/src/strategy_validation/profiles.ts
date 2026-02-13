import type { ValidationProfile } from "../types";

export type ValidationThresholds = {
  netReturnPctMin: number;
  maxDrawdownPctMax: number;
  profitFactorMin: number;
  minTrades: number;
};

const PROFILE_THRESHOLDS: Record<ValidationProfile, ValidationThresholds> = {
  balanced: {
    netReturnPctMin: 0,
    maxDrawdownPctMax: 12,
    profitFactorMin: 1.1,
    minTrades: 8,
  },
  strict: {
    netReturnPctMin: 2,
    maxDrawdownPctMax: 8,
    profitFactorMin: 1.25,
    minTrades: 12,
  },
  loose: {
    netReturnPctMin: -0.5,
    maxDrawdownPctMax: 18,
    profitFactorMin: 1.0,
    minTrades: 5,
  },
};

export function getValidationThresholds(
  profile: ValidationProfile,
  minTradesOverride?: number,
): ValidationThresholds {
  const base = PROFILE_THRESHOLDS[profile] ?? PROFILE_THRESHOLDS.balanced;
  if (minTradesOverride === undefined) return base;
  const n = Number(minTradesOverride);
  if (!Number.isFinite(n) || n < 1) return base;
  return {
    ...base,
    minTrades: Math.max(1, Math.min(5000, Math.floor(n))),
  };
}
