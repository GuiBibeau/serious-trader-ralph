import { describe, expect, test } from "bun:test";
import {
  buildAccountRiskSnapshot,
  evaluatePreSubmitRisk,
  resolveAccountRiskThresholds,
} from "../../apps/portal/app/terminal/components/account-risk";

describe("portal terminal account risk model", () => {
  test("computes baseline equity/margin metrics", () => {
    const snapshot = buildAccountRiskSnapshot({
      baseQty: 2,
      quoteQty: 800,
      markPrice: 100,
    });
    expect(snapshot.equityQuote).toBeCloseTo(1000, 8);
    expect(snapshot.usedMarginQuote).toBeCloseTo(20, 8);
    expect(snapshot.maintenanceRequirementQuote).toBeCloseTo(10, 8);
    expect(snapshot.freeCollateralQuote).toBeCloseTo(980, 8);
    expect(snapshot.concentrationLevel).toBe("low");
    expect(snapshot.liquidationRiskLevel).toBe("low");
    expect(snapshot.blockNewExposure).toBe(false);
  });

  test("flags concentration and liquidation critical state", () => {
    const snapshot = buildAccountRiskSnapshot({
      baseQty: 10,
      quoteQty: 1,
      markPrice: 100,
      thresholds: {
        concentrationWarningRatio: 0.4,
        concentrationCriticalRatio: 0.6,
        liquidationWarningBufferPct: 20,
        liquidationCriticalBufferPct: 10,
      },
    });
    expect(snapshot.concentrationLevel).toBe("critical");
    expect(snapshot.blockNewExposure).toBe(true);
    expect(snapshot.warnings.length).toBeGreaterThan(0);
  });

  test("pre-submit guard blocks new buy exposure but allows reduce direction", () => {
    const snapshot = buildAccountRiskSnapshot({
      baseQty: 10,
      quoteQty: 1,
      markPrice: 100,
      thresholds: {
        concentrationWarningRatio: 0.4,
        concentrationCriticalRatio: 0.6,
      },
    });
    const blocked = evaluatePreSubmitRisk({
      snapshot,
      direction: "buy",
      reduceOnly: false,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.message).toContain("Execution blocked");

    const allowedSell = evaluatePreSubmitRisk({
      snapshot,
      direction: "sell",
      reduceOnly: false,
    });
    expect(allowedSell.blocked).toBe(false);
    expect(allowedSell.message).toContain("High risk state");
  });

  test("reads and clamps configurable thresholds", () => {
    const thresholds = resolveAccountRiskThresholds({
      NEXT_PUBLIC_TERMINAL_RISK_INITIAL_MARGIN_RATIO: "0.2",
      NEXT_PUBLIC_TERMINAL_RISK_MAINT_MARGIN_RATIO: "0.1",
      NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_WARNING: "0.5",
      NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_CRITICAL: "0.7",
      NEXT_PUBLIC_TERMINAL_RISK_LIQ_WARNING_BUFFER_PCT: "25",
      NEXT_PUBLIC_TERMINAL_RISK_LIQ_CRITICAL_BUFFER_PCT: "8",
      NEXT_PUBLIC_TERMINAL_RISK_MIN_EQUITY_QUOTE: "40",
    });
    expect(thresholds.initialMarginRatio).toBeCloseTo(0.2, 8);
    expect(thresholds.maintenanceMarginRatio).toBeCloseTo(0.1, 8);
    expect(thresholds.concentrationWarningRatio).toBeCloseTo(0.5, 8);
    expect(thresholds.concentrationCriticalRatio).toBeCloseTo(0.7, 8);
    expect(thresholds.liquidationWarningBufferPct).toBeCloseTo(25, 8);
    expect(thresholds.liquidationCriticalBufferPct).toBeCloseTo(8, 8);
    expect(thresholds.minEquityToTradeQuote).toBeCloseTo(40, 8);
  });
});
