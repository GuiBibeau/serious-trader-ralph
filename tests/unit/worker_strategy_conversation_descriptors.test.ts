import { describe, expect, test } from "bun:test";
import {
  describeStrategyState,
  registerStrategyDescriptor,
} from "../../apps/worker/src/strategy_validation/descriptors";
import type { StrategyConfig } from "../../apps/worker/src/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyDTt1v";

describe("worker strategy conversation descriptors", () => {
  test("renders dca descriptor with runtime and validation context", () => {
    const descriptor = describeStrategyState({
      strategy: {
        type: "dca",
        inputMint: USDC_MINT,
        outputMint: SOL_MINT,
        amount: "5000000",
        everyMinutes: 30,
      },
      config: {
        enabled: true,
        strategy: {
          type: "dca",
          inputMint: USDC_MINT,
          outputMint: SOL_MINT,
          amount: "5000000",
          everyMinutes: 30,
        },
      },
      runtimeState: {
        tenantId: "bot",
        lifecycleState: "validated",
        activeStrategyHash: null,
        lastValidationId: 1,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidation: {
        id: 1,
        tenantId: "bot",
        strategyHash: "abc",
        strategyType: "dca",
        lookbackDays: 45,
        profile: "balanced",
        status: "passed",
        metrics: {
          netReturnPct: 5,
          maxDrawdownPct: 2.2,
          profitFactor: 1.4,
          winRate: 66,
          tradeCount: 12,
        },
        thresholds: {
          minTrades: 8,
          maxTradeCount: 12,
        },
        summary: "ok",
        startedAt: "2026-02-13T00:00:00.000Z",
        completedAt: "2026-02-13T01:00:00.000Z",
        createdAt: "2026-02-13T00:00:00.000Z",
      },
    });

    expect(descriptor.headline).toBe("DCA strategy");
    expect(descriptor.bullets.join(" | ")).toContain("every: 30m");
    expect(descriptor.bullets.join(" | ")).toContain("lifecycle: validated");
  });

  test("renders rebalance descriptor with percentage formatting", () => {
    const descriptor = describeStrategyState({
      strategy: {
        type: "rebalance",
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        targetBasePct: 0.5,
        thresholdPct: 0.01,
      },
      config: { enabled: true },
      runtimeState: {
        tenantId: "bot",
        lifecycleState: "active",
        activeStrategyHash: "hash",
        lastValidationId: null,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidation: null,
    });

    expect(descriptor.headline).toBe("Rebalance strategy");
    expect(descriptor.bullets[0]).toContain("pair:");
    expect(descriptor.bullets.join(" | ")).toContain("lifecycle: active");
  });

  test("falls back to generic descriptor for unknown strategies", () => {
    const descriptor = describeStrategyState({
      strategy: {
        type: "future_market",
      } as unknown as StrategyConfig,
      config: {
        enabled: true,
        strategy: {
          type: "future_market",
        } as unknown as StrategyConfig,
      },
      runtimeState: null,
      latestValidation: null,
    });

    expect(descriptor.headline).toBe("Strategy: future_market");
    expect(descriptor.bullets[0]).toBe("strategy type: future_market");
  });

  test("supports runtime extension by registering custom descriptors", () => {
    registerStrategyDescriptor("prediction_market", {
      describe({ strategy }) {
        return {
          headline: "Custom PM",
          bullets: [
            `market=${(strategy as unknown as { marketId?: string }).marketId ?? "n/a"}`,
          ],
        };
      },
    });

    const descriptor = describeStrategyState({
      strategy: {
        type: "prediction_market",
        venue: "alt",
        marketId: "market-x",
      } as unknown as StrategyConfig,
      config: {
        enabled: true,
        strategy: {
          type: "prediction_market",
          venue: "alt",
          marketId: "market-x",
        } as unknown as StrategyConfig,
      },
      runtimeState: null,
      latestValidation: null,
    });

    expect(descriptor.headline).toBe("Custom PM");
    expect(descriptor.bullets[0]).toContain("market=market-x");
  });
});
