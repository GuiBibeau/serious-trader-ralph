import { describe, expect, test } from "bun:test";
import { FixtureDataAdapter } from "../../apps/worker/src/data_sources/fixture_adapter";
import type { PriceBar } from "../../apps/worker/src/data_sources/types";
import {
  registerStrategyRunner,
  simulateStrategyForValidation,
} from "../../apps/worker/src/strategy_validation/engine";
import type {
  DcaStrategy,
  PredictionMarketStrategy,
} from "../../apps/worker/src/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function loadFixtureBars(
  pattern: "uptrend" | "downtrend",
): Promise<PriceBar[]> {
  const adapter = new FixtureDataAdapter();
  const endMs = Date.now();
  const startMs = endMs - 45 * 24 * 60 * 60 * 1000;
  return await adapter.fetchHourlyBars({
    baseMint: SOL_MINT,
    quoteMint: USDC_MINT,
    startMs,
    endMs,
    resolutionMinutes: 60,
    pattern,
  });
}

describe("worker strategy validation engine", () => {
  test("DCA uptrend passes balanced profile over 45d", async () => {
    const strategy: DcaStrategy = {
      type: "dca",
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount: "5000000",
      everyMinutes: 60,
    };

    const bars = await loadFixtureBars("uptrend");
    const result = simulateStrategyForValidation({
      strategy,
      bars,
      effectiveCostBps: 55,
      profile: "balanced",
      minTrades: 8,
    });

    expect(result.status).toBe("passed");
    expect(result.metrics.netReturnPct).toBeGreaterThan(0);
    expect(result.metrics.tradeCount).toBeGreaterThanOrEqual(8);
  });

  test("DCA downtrend fails balanced profile over 45d", async () => {
    const strategy: DcaStrategy = {
      type: "dca",
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount: "5000000",
      everyMinutes: 60,
    };

    const bars = await loadFixtureBars("downtrend");
    const result = simulateStrategyForValidation({
      strategy,
      bars,
      effectiveCostBps: 55,
      profile: "balanced",
      minTrades: 8,
    });

    expect(result.status).toBe("failed");
    expect(result.metrics.netReturnPct).toBeLessThan(0);
  });

  test("custom strategy runners can support new trade types", async () => {
    const runnerId = "prediction-market-test-runner";
    registerStrategyRunner({
      id: runnerId,
      supports(strategy): strategy is PredictionMarketStrategy {
        return strategy.type === "prediction_market";
      },
      simulate() {
        return {
          metrics: {
            netReturnPct: 4.2,
            maxDrawdownPct: 3.1,
            profitFactor: 1.8,
            winRate: 66,
            tradeCount: 16,
          },
          equityCurve: [1, 1.042],
          tradeReturns: [0.02, 0.01, 0.01],
        };
      },
    });

    const bars = await loadFixtureBars("uptrend");
    const result = simulateStrategyForValidation({
      strategy: {
        type: "prediction_market",
        venue: "test-venue",
        marketId: "pm-1",
        side: "yes",
      },
      bars,
      effectiveCostBps: 55,
      profile: "balanced",
      minTrades: 8,
    });

    expect(result.status).toBe("passed");
    expect(result.metrics.tradeCount).toBe(16);
  });
});
