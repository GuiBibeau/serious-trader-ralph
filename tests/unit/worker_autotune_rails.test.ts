import { describe, expect, test } from "bun:test";
import {
  applyConservativeTuneForValidation,
  type NormalizedAutotuneConfig,
  normalizeAutotuneConfig,
} from "../../apps/worker/src/strategy_validation/engine";
import { getValidationThresholds } from "../../apps/worker/src/strategy_validation/profiles";
import type {
  DcaStrategy,
  RebalanceStrategy,
} from "../../apps/worker/src/types";

const thresholds = getValidationThresholds("balanced", 8);

function parseNormalized(
  input: Partial<NormalizedAutotuneConfig>,
): NormalizedAutotuneConfig {
  return {
    ...normalizeAutotuneConfig({}),
    ...input,
  };
}

describe("worker autotune rails", () => {
  test("DCA risk-off tuning respects max-change and rails", () => {
    const strategy: DcaStrategy = {
      type: "dca",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      amount: "1000",
      everyMinutes: 60,
    };

    const tuned = applyConservativeTuneForValidation({
      strategy,
      metrics: {
        netReturnPct: -2,
        maxDrawdownPct: 15,
        profitFactor: 0.8,
        winRate: 30,
        tradeCount: 30,
      },
      thresholds,
      autotune: parseNormalized({
        maxChangePctPerTune: 10,
        rails: {
          dca: {
            everyMinutesMin: 15,
            everyMinutesMax: 240,
            amountMinRatio: 0.5,
            amountMaxRatio: 1.5,
          },
          rebalance: {
            thresholdPctMin: 0.005,
            thresholdPctMax: 0.05,
          },
        },
      }),
    });

    expect(tuned.changed).toBe(true);
    expect(tuned.reason).toBe("risk-off");
    expect((tuned.strategy as DcaStrategy).amount).toBe("900");
    expect((tuned.strategy as DcaStrategy).everyMinutes).toBe(66);
  });

  test("DCA risk-on tuning uses half-step and stays bounded", () => {
    const strategy: DcaStrategy = {
      type: "dca",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      amount: "1000",
      everyMinutes: 60,
    };

    const tuned = applyConservativeTuneForValidation({
      strategy,
      metrics: {
        netReturnPct: 6,
        maxDrawdownPct: 5,
        profitFactor: 2,
        winRate: 65,
        tradeCount: 30,
      },
      thresholds,
      autotune: parseNormalized({
        maxChangePctPerTune: 10,
      }),
    });

    expect(tuned.changed).toBe(true);
    expect(tuned.reason).toBe("risk-on");
    expect((tuned.strategy as DcaStrategy).amount).toBe("1050");
    expect((tuned.strategy as DcaStrategy).everyMinutes).toBe(57);
  });

  test("rebalance threshold tuning cannot exceed rails", () => {
    const strategy: RebalanceStrategy = {
      type: "rebalance",
      baseMint: "So11111111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      targetBasePct: 0.5,
      thresholdPct: 0.049,
    };

    const tuned = applyConservativeTuneForValidation({
      strategy,
      metrics: {
        netReturnPct: -3,
        maxDrawdownPct: 20,
        profitFactor: 0.7,
        winRate: 40,
        tradeCount: 20,
      },
      thresholds,
      autotune: parseNormalized({
        maxChangePctPerTune: 10,
        rails: {
          dca: {
            everyMinutesMin: 15,
            everyMinutesMax: 240,
            amountMinRatio: 0.5,
            amountMaxRatio: 1.5,
          },
          rebalance: {
            thresholdPctMin: 0.005,
            thresholdPctMax: 0.05,
          },
        },
      }),
    });

    expect(tuned.changed).toBe(true);
    expect(tuned.reason).toBe("risk-off");
    expect((tuned.strategy as RebalanceStrategy).thresholdPct).toBe(0.05);
  });
});
