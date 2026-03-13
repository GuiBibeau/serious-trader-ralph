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
});
