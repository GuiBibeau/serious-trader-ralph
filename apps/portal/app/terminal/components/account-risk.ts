export type AccountRiskLevel = "low" | "warning" | "critical";

export type AccountRiskThresholds = {
  initialMarginRatio: number;
  maintenanceMarginRatio: number;
  concentrationWarningRatio: number;
  concentrationCriticalRatio: number;
  liquidationWarningBufferPct: number;
  liquidationCriticalBufferPct: number;
  minEquityToTradeQuote: number;
};

export type AccountRiskSnapshot = {
  baseQty: number | null;
  quoteQty: number | null;
  markPrice: number | null;
  exposureNotionalQuote: number | null;
  equityQuote: number | null;
  usedMarginQuote: number | null;
  maintenanceRequirementQuote: number | null;
  freeCollateralQuote: number | null;
  maintenanceRatio: number | null;
  concentrationRatio: number | null;
  concentrationLevel: AccountRiskLevel;
  liquidationBufferPct: number | null;
  liquidationRiskLevel: AccountRiskLevel;
  warnings: string[];
  blockNewExposure: boolean;
  thresholds: AccountRiskThresholds;
};

export const DEFAULT_ACCOUNT_RISK_THRESHOLDS: AccountRiskThresholds = {
  initialMarginRatio: 0.1,
  maintenanceMarginRatio: 0.05,
  concentrationWarningRatio: 0.55,
  concentrationCriticalRatio: 0.75,
  liquidationWarningBufferPct: 15,
  liquidationCriticalBufferPct: 5,
  minEquityToTradeQuote: 25,
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseEnvNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(parsed, min, max);
}

export function resolveAccountRiskThresholds(
  env: Record<string, string | undefined> = process.env,
): AccountRiskThresholds {
  const defaults = DEFAULT_ACCOUNT_RISK_THRESHOLDS;
  return {
    initialMarginRatio: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_INITIAL_MARGIN_RATIO,
      defaults.initialMarginRatio,
      0.01,
      0.9,
    ),
    maintenanceMarginRatio: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_MAINT_MARGIN_RATIO,
      defaults.maintenanceMarginRatio,
      0.005,
      0.8,
    ),
    concentrationWarningRatio: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_WARNING,
      defaults.concentrationWarningRatio,
      0.1,
      5,
    ),
    concentrationCriticalRatio: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_CRITICAL,
      defaults.concentrationCriticalRatio,
      0.1,
      10,
    ),
    liquidationWarningBufferPct: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_LIQ_WARNING_BUFFER_PCT,
      defaults.liquidationWarningBufferPct,
      0.5,
      100,
    ),
    liquidationCriticalBufferPct: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_LIQ_CRITICAL_BUFFER_PCT,
      defaults.liquidationCriticalBufferPct,
      0.1,
      100,
    ),
    minEquityToTradeQuote: parseEnvNumber(
      env.NEXT_PUBLIC_TERMINAL_RISK_MIN_EQUITY_QUOTE,
      defaults.minEquityToTradeQuote,
      1,
      1_000_000,
    ),
  };
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function normalizeThresholds(
  input?: Partial<AccountRiskThresholds>,
): AccountRiskThresholds {
  const base = DEFAULT_ACCOUNT_RISK_THRESHOLDS;
  const merged = {
    ...base,
    ...(input ?? {}),
  };
  const concentrationWarning = clampNumber(
    merged.concentrationWarningRatio,
    0.1,
    5,
  );
  const concentrationCritical = clampNumber(
    Math.max(concentrationWarning, merged.concentrationCriticalRatio),
    concentrationWarning,
    10,
  );
  const liqWarning = clampNumber(merged.liquidationWarningBufferPct, 0.5, 100);
  const liqCritical = clampNumber(
    Math.min(merged.liquidationCriticalBufferPct, liqWarning),
    0.1,
    liqWarning,
  );
  return {
    initialMarginRatio: clampNumber(merged.initialMarginRatio, 0.01, 0.9),
    maintenanceMarginRatio: clampNumber(
      Math.min(merged.maintenanceMarginRatio, merged.initialMarginRatio),
      0.005,
      merged.initialMarginRatio,
    ),
    concentrationWarningRatio: concentrationWarning,
    concentrationCriticalRatio: concentrationCritical,
    liquidationWarningBufferPct: liqWarning,
    liquidationCriticalBufferPct: liqCritical,
    minEquityToTradeQuote: clampNumber(
      merged.minEquityToTradeQuote,
      1,
      1_000_000,
    ),
  };
}

export function buildAccountRiskSnapshot(input: {
  baseQty: number | null;
  quoteQty: number | null;
  markPrice: number | null;
  thresholds?: Partial<AccountRiskThresholds>;
}): AccountRiskSnapshot {
  const thresholds = normalizeThresholds(input.thresholds);
  const baseQty = isFiniteNumber(input.baseQty) ? input.baseQty : null;
  const quoteQty = isFiniteNumber(input.quoteQty) ? input.quoteQty : null;
  const markPrice = isFiniteNumber(input.markPrice) ? input.markPrice : null;
  if (baseQty === null || quoteQty === null || markPrice === null) {
    return {
      baseQty,
      quoteQty,
      markPrice,
      exposureNotionalQuote: null,
      equityQuote: null,
      usedMarginQuote: null,
      maintenanceRequirementQuote: null,
      freeCollateralQuote: null,
      maintenanceRatio: null,
      concentrationRatio: null,
      concentrationLevel: "low",
      liquidationBufferPct: null,
      liquidationRiskLevel: "low",
      warnings: ["Risk model waiting for complete balance/mark inputs."],
      blockNewExposure: false,
      thresholds,
    };
  }

  const exposureNotionalQuote = Math.abs(baseQty * markPrice);
  const equityQuote = quoteQty + baseQty * markPrice;
  const usedMarginQuote = exposureNotionalQuote * thresholds.initialMarginRatio;
  const maintenanceRequirementQuote =
    exposureNotionalQuote * thresholds.maintenanceMarginRatio;
  const freeCollateralQuote = equityQuote - usedMarginQuote;
  const maintenanceRatio =
    maintenanceRequirementQuote > 0
      ? equityQuote / maintenanceRequirementQuote
      : null;
  const concentrationRatio =
    equityQuote > 0 ? exposureNotionalQuote / equityQuote : null;
  const liquidationBufferPct =
    equityQuote > 0
      ? ((equityQuote - maintenanceRequirementQuote) / equityQuote) * 100
      : null;

  const concentrationLevel: AccountRiskLevel =
    concentrationRatio === null
      ? "low"
      : concentrationRatio >= thresholds.concentrationCriticalRatio
        ? "critical"
        : concentrationRatio >= thresholds.concentrationWarningRatio
          ? "warning"
          : "low";
  const liquidationRiskLevel: AccountRiskLevel =
    liquidationBufferPct === null
      ? "low"
      : liquidationBufferPct <= thresholds.liquidationCriticalBufferPct
        ? "critical"
        : liquidationBufferPct <= thresholds.liquidationWarningBufferPct
          ? "warning"
          : "low";

  const warnings: string[] = [];
  if (equityQuote <= thresholds.minEquityToTradeQuote) {
    warnings.push(
      `Equity is below ${thresholds.minEquityToTradeQuote.toFixed(2)} quote units.`,
    );
  }
  if (freeCollateralQuote < 0) {
    warnings.push("Free collateral is negative.");
  }
  if (concentrationLevel === "critical") {
    warnings.push("Position concentration exceeds critical threshold.");
  } else if (concentrationLevel === "warning") {
    warnings.push("Position concentration is elevated.");
  }
  if (liquidationRiskLevel === "critical") {
    warnings.push("Liquidation buffer is critically low.");
  } else if (liquidationRiskLevel === "warning") {
    warnings.push("Liquidation buffer is tightening.");
  }

  const blockNewExposure =
    concentrationLevel === "critical" ||
    liquidationRiskLevel === "critical" ||
    freeCollateralQuote < 0 ||
    equityQuote <= thresholds.minEquityToTradeQuote;

  return {
    baseQty,
    quoteQty,
    markPrice,
    exposureNotionalQuote,
    equityQuote,
    usedMarginQuote,
    maintenanceRequirementQuote,
    freeCollateralQuote,
    maintenanceRatio,
    concentrationRatio,
    concentrationLevel,
    liquidationBufferPct,
    liquidationRiskLevel,
    warnings,
    blockNewExposure,
    thresholds,
  };
}

export function evaluatePreSubmitRisk(input: {
  snapshot: AccountRiskSnapshot | null | undefined;
  direction: "buy" | "sell";
  reduceOnly: boolean;
}): { blocked: boolean; message: string | null } {
  if (!input.snapshot) {
    return { blocked: false, message: null };
  }
  if (!input.snapshot.blockNewExposure) {
    return { blocked: false, message: null };
  }
  const warning = input.snapshot.warnings[0] ?? "Risk threshold exceeded.";
  if (input.direction === "sell" || input.reduceOnly) {
    return {
      blocked: false,
      message: `High risk state: ${warning} New exposure is restricted; reduce-only flow is still allowed.`,
    };
  }
  return {
    blocked: true,
    message: `Execution blocked: ${warning}`,
  };
}
