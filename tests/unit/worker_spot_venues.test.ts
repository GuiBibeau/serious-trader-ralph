import { describe, expect, mock, test } from "bun:test";
import {
  buildSpotVenueQuoteTelemetry,
  quoteSpotSwap,
  resolveSpotVenueExecutionAdapter,
} from "../../apps/worker/src/execution/spot_venues";

describe("worker spot venue helpers", () => {
  test("builds route-quality telemetry from normalized spot quotes", () => {
    const telemetry = buildSpotVenueQuoteTelemetry({
      venueKey: "raydium",
      quoteProvider: "raydium",
      quoteResponse: {
        inputMint: "mint-in",
        outputMint: "mint-out",
        inAmount: "1000",
        outAmount: "2200",
        priceImpactPct: "0.001",
        otherAmountThreshold: "2100",
        routePlan: [
          {
            poolId: "pool-1",
            swapInfo: { label: "Raydium", poolId: "pool-1" },
          },
        ],
      },
    });

    expect(telemetry).toEqual({
      venueKey: "raydium",
      quoteProvider: "raydium",
      routeHopCount: 1,
      routeLabels: ["Raydium"],
      poolIds: ["pool-1"],
      quotedOutAmountAtomic: "2200",
      minExpectedOutAmountAtomic: "2100",
      priceImpactPct: 0.001,
    });
  });

  test("quotes Raydium via the dedicated client and resolves the direct adapter", async () => {
    const quoteBaseIn = mock(async () => ({
      envelope: {
        id: "quote-1",
        success: true,
        data: {
          inputMint: "mint-in",
          outputMint: "mint-out",
          inputAmount: "1000",
          outputAmount: "2200",
        },
      },
      normalizedQuote: {
        inputMint: "mint-in",
        outputMint: "mint-out",
        inAmount: "1000",
        outAmount: "2200",
        priceImpactPct: 0,
        routePlan: [{ swapInfo: { label: "Raydium" }, poolId: "pool-1" }],
        otherAmountThreshold: "2100",
      },
    }));

    const quoted = await quoteSpotSwap({
      venueKey: "raydium",
      inputMint: "mint-in",
      outputMint: "mint-out",
      amountAtomic: "1000",
      slippageBps: 50,
      jupiter: {} as never,
      raydium: { quoteBaseIn } as never,
    });

    expect(quoted.quoteProvider).toBe("raydium");
    expect(quoted.routeQuality.routeLabels).toEqual(["Raydium"]);
    expect(
      resolveSpotVenueExecutionAdapter({
        venueKey: "raydium",
        runtimeMode: "paper",
        defaultAdapter: "jupiter",
      }),
    ).toBe("raydium");
    expect(quoteBaseIn).toHaveBeenCalledTimes(1);
  });

  test("quotes Orca via the dedicated client and captures pool-level telemetry", async () => {
    const quoteBaseIn = mock(async () => ({
      pool: {
        address: "orca-pool-1",
        feeRate: 400,
        tickSpacing: 4,
        tickCurrentIndex: -12,
        liquidity: "999",
        tvlUsdc: "10000",
        adaptiveFeeEnabled: false,
        hasWarning: false,
        addressLookupTable: "alt-1",
        stats: {
          "24h": {
            volume: "1200",
          },
        },
      },
      sdkQuote: {
        estimatedAmountInAtomic: "1000",
        estimatedAmountOutAtomic: "2200",
        otherAmountThresholdAtomic: "2100",
        estimatedFeeAmountAtomic: "3",
        sqrtPriceLimit: "123",
        tickArrayAddresses: ["tick-0", "tick-1", "tick-2"],
        aToB: true,
        amountSpecifiedIsInput: true,
      },
      normalizedQuote: {
        inputMint: "mint-in",
        outputMint: "mint-out",
        inAmount: "1000",
        outAmount: "2200",
        priceImpactPct: 0.001,
        routePlan: [
          { swapInfo: { label: "Orca Whirlpool" }, poolId: "orca-pool-1" },
        ],
        otherAmountThreshold: "2100",
        orcaPoolSnapshot: {
          address: "orca-pool-1",
          feeRate: 400,
          tickSpacing: 4,
          tickCurrentIndex: -12,
          liquidity: "999",
          tvlUsdc: "10000",
          adaptiveFeeEnabled: false,
          hasWarning: false,
          addressLookupTable: "alt-1",
          stats: {
            "24h": {
              volume: "1200",
            },
          },
        },
      },
    }));

    const quoted = await quoteSpotSwap({
      venueKey: "orca",
      inputMint: "mint-in",
      outputMint: "mint-out",
      amountAtomic: "1000",
      slippageBps: 50,
      jupiter: {} as never,
      orca: { quoteBaseIn } as never,
    });

    expect(quoted.quoteProvider).toBe("orca");
    expect(quoted.routeQuality.routeLabels).toEqual(["Orca Whirlpool"]);
    expect(quoted.routeQuality.poolAddress).toBe("orca-pool-1");
    expect(quoted.routeQuality.poolTickSpacing).toBe(4);
    expect(quoted.routeQuality.dailyVolumeUsd).toBe("1200");
    expect(
      resolveSpotVenueExecutionAdapter({
        venueKey: "orca",
        runtimeMode: "paper",
        defaultAdapter: "jupiter",
      }),
    ).toBe("orca");
    expect(quoteBaseIn).toHaveBeenCalledTimes(1);
  });
});
