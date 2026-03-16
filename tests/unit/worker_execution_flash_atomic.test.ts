import { describe, expect, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeFlashAtomicIntent } = await import(
  "../../apps/worker/src/execution/flash_atomic_executor"
);

function buildIntent() {
  return {
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
}

function buildLiveIntent() {
  return {
    ...buildIntent(),
    borrowLegs: [
      {
        provider: "marginfi",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountAtomic: "1000000",
      },
    ],
  };
}

describe("worker flash atomic execution adapter", () => {
  test("returns dry_run for bounded flash-atomic plans", async () => {
    const result = await executeFlashAtomicIntent({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("flash_liquidity");
    expect(result.executionMeta?.composedPlan).toMatchObject({
      mode: "flash_atomic",
      flashBorrowLegCount: 2,
      flashProviderCount: 2,
      settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    expect(result.executionMeta?.referencePrice?.snapshot?.referenceId).toBe(
      "arb:sol-usdc-jupiter-raydium",
    );
  });

  test("simulates bounded flash-atomic plans in paper mode", async () => {
    const result = await executeFlashAtomicIntent({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      intent: buildIntent(),
      execution: {
        params: {
          computeUnitLimit: 420000,
          flashLiquidityFeeBps: { marginfi: 12, kamino: 14 },
        },
      },
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.lifecycle?.settlementState).toBe("confirmed");
    expect(result.executionMeta?.composedPlan).toMatchObject({
      mode: "flash_atomic",
      computeUnitLimit: 420000,
    });
    expect(
      result.executionMeta?.referencePrice?.snapshot?.feeByMint,
    ).toMatchObject({
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "1200",
    });
  });

  test("rejects live mode for flash-liquidity rollout", async () => {
    await expect(
      executeFlashAtomicIntent({
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/flash-liquidity-live-mode-not-supported/);
  });

  test("allows bounded live smoke through the readiness bypass", async () => {
    let sendCount = 0;
    const result = await executeFlashAtomicIntent(
      {
        env: {} as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        policy: normalizePolicy({}),
        rpc: {
          simulateTransactionBase64: async () => ({
            err: null,
            unitsConsumed: 321_000,
          }),
          sendTransactionBase64: async () =>
            ++sendCount === 1 ? "sig-setup" : "sig-live",
          confirmSignature: async () => ({
            ok: true,
            status: "confirmed",
          }),
        } as never,
        jupiter: {} as never,
        intent: buildLiveIntent(),
        privyWalletId: "privy-wallet-1",
        execution: {
          params: {
            lane: "safe",
          },
        },
        log: () => {},
      },
      {
        resolveFlashLiquidityLiveAccount: async () => ({
          provider: "marginfi",
          bankAddress: "bank-1",
          bankMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          borrowAmountAtomic: "1000000",
          borrowAmountUi: 1,
          marginfiAccountAddress: "marginfi-account-1",
          setup: {
            unsignedTransactionBase64: "setup-base64",
            lastValidBlockHeight: 100,
          },
        }),
        buildFlashLiquidityLiveTransactionPlan: async () => ({
          provider: "marginfi",
          bankAddress: "bank-1",
          bankMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          borrowAmountAtomic: "1000000",
          borrowAmountUi: 1,
          referenceId: "arb:sol-usdc-jupiter-raydium",
          marginfiAccountAddress: "marginfi-account-1",
          unsignedTransactionBase64: "flash-base64",
          lastValidBlockHeight: 101,
          addressLookupTableAddresses: ["lut-1"],
        }),
        readFlashLiquidityLiveAccountState: async () => ({
          provider: "marginfi",
          marginfiAccountAddress: "marginfi-account-1",
          activeBalanceCount: 0,
          activeBankAddresses: [],
        }),
        signTransactionWithPrivyById: async (_env, _walletId, unsignedTx) =>
          `signed:${unsignedTx}`,
        evaluateSafeLaneTransaction: () => ({
          ok: true as const,
          profile: "safe" as const,
          limits: {
            maxTxBytes: 1400,
            maxInstructionCount: 24,
            maxAccountKeyCount: 64,
            maxComputeUnitLimit: 1_400_000,
            maxEstimatedFeeLamports: 5_000_000,
          },
        }),
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-live");
    expect(result.executionMeta?.route).toBe("flash_liquidity");
    expect(result.executionMeta?.classification).toBe("confirmed");
    expect(result.executionMeta?.lifecycle?.notes).toContain(
      "setup-signature:sig-setup",
    );
    expect(result.executionMeta?.referencePrice?.snapshot).toMatchObject({
      liveProvider: "marginfi",
      marginfiAccountAddress: "marginfi-account-1",
      activeBalanceCount: 0,
    });
    expect(result.executionMeta?.composedPlan).toMatchObject({
      mode: "flash_atomic",
      addressLookupTableCount: 1,
      addressLookupTableAddresses: ["lut-1"],
      simulationUnitsConsumed: 321_000,
    });
  });
});
