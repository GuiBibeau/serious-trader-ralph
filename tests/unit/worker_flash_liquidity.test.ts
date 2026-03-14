import { describe, expect, test } from "bun:test";
import {
  buildFlashAtomicPlan,
  resolveFlashLiquidityControls,
} from "../../apps/worker/src/flash_liquidity";

const BASE_INTENT = {
  family: "flash_atomic" as const,
  wallet: "11111111111111111111111111111111",
  venueKey: "flash_liquidity" as const,
  marketType: "spot" as const,
  instrumentId: "SOL/USDC",
  referenceId: "arb:sol-usdc-jupiter-raydium",
  settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  borrowLegs: [
    {
      provider: "marginfi",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "1000000",
    },
    {
      provider: "kamino",
      mint: "So11111111111111111111111111111111111111112",
      amountAtomic: "5000000",
    },
  ],
};

describe("flash liquidity substrate", () => {
  test("builds a bounded flash-atomic plan across marginfi and Kamino", () => {
    const plan = buildFlashAtomicPlan({
      intent: BASE_INTENT,
      execution: {
        params: {
          computeUnitLimit: 350000,
          priorityMicroLamports: "25000",
        },
      },
      env: {},
    });

    expect(plan.referenceId).toBe("arb:sol-usdc-jupiter-raydium");
    expect(plan.providerPreviews).toHaveLength(2);
    expect(plan.instructionSummary.flashBorrowLegCount).toBe(2);
    expect(plan.instructionSummary.flashProviderCount).toBe(2);
    expect(plan.instructionSummary.computeUnitLimit).toBe(350000);
    expect(plan.instructionSummary.computeUnitPriceMicroLamports).toBe("25000");
    expect(plan.instructionSummary.routeLabels).toEqual([
      "marginfi",
      "Kamino",
      "reference:arb:sol-usdc-jupiter-raydium",
    ]);
    expect(plan.flashEstimatedFeeByMint).toEqual({
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "800",
      So11111111111111111111111111111111111111112: "5000",
    });
  });

  test("supports global and provider-specific disable controls", () => {
    expect(
      resolveFlashLiquidityControls({
        env: {
          FLASH_LIQUIDITY_ENABLED: "false",
        },
      }).enabled,
    ).toBe(false);

    const controls = resolveFlashLiquidityControls({
      env: {
        FLASH_LIQUIDITY_DISABLED_PROVIDERS: "kamino",
      },
      execution: {
        params: {
          flashLiquidityMarginfiEnabled: true,
        },
      },
    });
    expect(controls.enabled).toBe(true);
    expect(Array.from(controls.disabledProviders)).toEqual(["kamino"]);
  });

  test("fails closed when a provider is disabled", () => {
    expect(() =>
      buildFlashAtomicPlan({
        intent: BASE_INTENT,
        execution: {
          params: {
            flashLiquidityDisabledProviders: ["marginfi"],
          },
        },
        env: {},
      }),
    ).toThrow(/flash-liquidity-provider-disabled:marginfi/);
  });
});
