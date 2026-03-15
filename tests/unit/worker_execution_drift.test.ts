import { describe, expect, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeDriftPerpOrder } = await import(
  "../../apps/worker/src/execution/drift_executor"
);

function buildIntent() {
  return {
    family: "perp_order" as const,
    wallet: "11111111111111111111111111111111",
    venueKey: "drift" as const,
    marketType: "perp" as const,
    instrumentId: "SOL-PERP",
    side: "long" as const,
    quantityAtomic: "1000000",
    collateralAtomic: "250000",
    params: {
      orderType: "limit",
      timeInForce: "gtc",
      limitPriceAtomic: "155000000",
    },
  };
}

function buildPreview() {
  return {
    instrument: {
      marketName: "SOL-PERP",
      marketIndex: 2,
      oracle: "oracle-sol",
      oracleSource: "pyth",
      status: "active",
      contractType: "perp",
      initialMarginRatio: 1000,
      maintenanceMarginRatio: 500,
    },
    funding: {
      marketName: "SOL-PERP",
      fundingRate1h: 0.00012,
      fundingRate1hBps: 1.2,
      oraclePrice: 153.25,
      markPrice: 153.3,
      sourceTs: "2026-03-13T23:59:00.000Z",
    },
    side: "long" as const,
    direction: "long" as const,
    reduceOnly: false,
    orderType: "limit" as const,
    timeInForce: "gtc" as const,
    quantityAtomic: "1000000",
    collateralAtomic: "250000",
    limitPriceAtomic: "155000000",
    triggerPriceAtomic: null,
    swiftSupported: false,
  };
}

describe("worker Drift perp execution adapter", () => {
  test("returns dry_run for bounded Drift perp intents", async () => {
    const result = await executeDriftPerpOrder({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      drift: {
        swiftConfigured: () => false,
        describePerpIntent: async () => buildPreview(),
        buildSyntheticQuote: () => ({
          inputMint: "SOL-PERP",
          outputMint: "SOL-PERP",
          inAmount: "250000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
        }),
      } as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("drift");
    expect(result.executionMeta?.lifecycle?.positionState).toBe("opening");
  });

  test("simulates Drift perp intents in paper mode", async () => {
    const result = await executeDriftPerpOrder({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      drift: {
        swiftConfigured: () => false,
        describePerpIntent: async () => buildPreview(),
        buildSyntheticQuote: () => ({
          inputMint: "SOL-PERP",
          outputMint: "SOL-PERP",
          inAmount: "250000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
        }),
      } as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.referencePrice?.snapshot?.marketName).toBe(
      "SOL-PERP",
    );
  });

  test("fails closed when the Swift route is requested without a Swift endpoint", async () => {
    await expect(
      executeDriftPerpOrder({
        env: {
          DRIFT_DATA_API_BASE: "https://drift.test",
        } as Env,
        runtimeMode: "paper",
        execution: { adapter: "drift_swift" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/drift-swift-api-base-missing/);
  });

  test("rejects live mode for Drift rollout", async () => {
    await expect(
      executeDriftPerpOrder({
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/drift-live-mode-not-supported/);
  });

  test("allows bounded live smoke through the readiness bypass", async () => {
    let prepareCallCount = 0;
    const result = await executeDriftPerpOrder(
      {
        env: {
          RPC_ENDPOINT: "https://rpc.test",
        } as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          sendTransactionBase64: async (transaction) =>
            transaction.includes("setup") ? "sig-setup" : "sig-order",
          confirmSignature: async () => ({
            ok: true,
            status: "confirmed" as const,
          }),
        } as never,
        jupiter: {} as never,
        drift: {
          swiftConfigured: () => false,
          describePerpIntent: async () => buildPreview(),
          buildSyntheticQuote: () => ({
            inputMint: "SOL-PERP",
            outputMint: "SOL-PERP",
            inAmount: "250000",
            outAmount: "1000000",
            priceImpactPct: 0,
            routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
          }),
        } as never,
        privyWalletId: "wallet_strategy_lab",
        intent: buildIntent(),
        log: () => {},
      },
      {
        prepareDriftLivePerpOrder: async () => {
          prepareCallCount += 1;
          if (prepareCallCount === 1) {
            return {
              marketIndex: 2,
              userAccountAddress: "drift-user-account",
              spotCollateralMint:
                "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              setupAction: "deposit",
              setupAmountAtomic: "250000",
              setupTransactionBase64: "setup-tx",
              orderTransactionBase64: null,
              lastValidBlockHeight: 88,
              snapshotBefore: null,
            };
          }
          return {
            marketIndex: 2,
            userAccountAddress: "drift-user-account",
            spotCollateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            setupAction: null,
            setupAmountAtomic: null,
            setupTransactionBase64: null,
            orderTransactionBase64: "order-tx",
            lastValidBlockHeight: 99,
            snapshotBefore: {
              userAccountAddress: "drift-user-account",
              marketIndex: 2,
              positionDirection: "flat",
              baseAssetAmountAtomic: "0",
              quoteAssetAmountAtomic: "0",
              quoteEntryAmountAtomic: "0",
              quoteBreakEvenAmountAtomic: "0",
              settledPnlAtomic: "0",
              collateralAtomic: "250000",
              freeCollateralAtomic: "250000",
              totalCollateralAtomic: "250000",
              initialMarginRequirementAtomic: "0",
              maintenanceMarginRequirementAtomic: "0",
              leverageTenThousand: "0",
              health: 100,
              openOrders: 0,
            },
          };
        },
        readDriftLiveAccountSnapshot: async () => ({
          userAccountAddress: "drift-user-account",
          marketIndex: 2,
          positionDirection: "long",
          baseAssetAmountAtomic: "1000000",
          quoteAssetAmountAtomic: "-153300000",
          quoteEntryAmountAtomic: "-153300000",
          quoteBreakEvenAmountAtomic: "-153300000",
          settledPnlAtomic: "0",
          collateralAtomic: "250000",
          freeCollateralAtomic: "100000",
          totalCollateralAtomic: "250000",
          initialMarginRequirementAtomic: "50000",
          maintenanceMarginRequirementAtomic: "25000",
          leverageTenThousand: "500",
          health: 92,
          openOrders: 0,
        }),
        signTransactionWithPrivyById: async (_env, _walletId, transaction) =>
          `signed:${transaction}`,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-order");
    expect(result.executionMeta?.classification).toBe("confirmed");
    expect(result.executionMeta?.lifecycle?.positionState).toBe("open");
    expect(
      (result.executionMeta as Record<string, unknown> | undefined)
        ?.driftAccount,
    ).toBeDefined();
  });

  test("uses confirmed preflight for live smoke even when policy commitment is finalized", async () => {
    const simulateCommitments: string[] = [];
    const preflightCommitments: string[] = [];

    const result = await executeDriftPerpOrder(
      {
        env: {
          RPC_ENDPOINT: "https://rpc.test",
        } as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: {
          params: {
            lane: "safe",
          },
        },
        policy: normalizePolicy({ commitment: "finalized" }),
        rpc: {
          simulateTransactionBase64: async (_transaction, options) => {
            simulateCommitments.push(String(options.commitment ?? ""));
            return { err: null };
          },
          sendTransactionBase64: async (_transaction, options) => {
            preflightCommitments.push(
              String(options.preflightCommitment ?? ""),
            );
            return "sig-order";
          },
          confirmSignature: async () => ({
            ok: true,
            status: "finalized" as const,
          }),
        } as never,
        jupiter: {} as never,
        drift: {
          swiftConfigured: () => false,
          describePerpIntent: async () => buildPreview(),
          buildSyntheticQuote: () => ({
            inputMint: "SOL-PERP",
            outputMint: "SOL-PERP",
            inAmount: "250000",
            outAmount: "1000000",
            priceImpactPct: 0,
            routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
          }),
        } as never,
        privyWalletId: "wallet_strategy_lab",
        intent: buildIntent(),
        log: () => {},
      },
      {
        prepareDriftLivePerpOrder: async () => ({
          marketIndex: 2,
          userAccountAddress: "drift-user-account",
          spotCollateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          setupAction: null,
          setupAmountAtomic: null,
          setupTransactionBase64: null,
          orderTransactionBase64: "order-tx",
          lastValidBlockHeight: 99,
          snapshotBefore: null,
        }),
        readDriftLiveAccountSnapshot: async () => null,
        signTransactionWithPrivyById: async (_env, _walletId, transaction) =>
          `signed:${transaction}`,
        evaluateSafeLaneTransaction: () => ({
          ok: true,
          profile: "default",
        }),
      },
    );

    expect(result.status).toBe("finalized");
    expect(simulateCommitments).toEqual(["confirmed"]);
    expect(preflightCommitments).toEqual(["confirmed"]);
  });

  test("preserves a landed live result when the post-submit snapshot read fails", async () => {
    const result = await executeDriftPerpOrder(
      {
        env: {
          RPC_ENDPOINT: "https://rpc.test",
        } as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          sendTransactionBase64: async () => "sig-order",
          confirmSignature: async () => ({
            ok: true,
            status: "confirmed" as const,
          }),
        } as never,
        jupiter: {} as never,
        drift: {
          swiftConfigured: () => false,
          describePerpIntent: async () => buildPreview(),
          buildSyntheticQuote: () => ({
            inputMint: "SOL-PERP",
            outputMint: "SOL-PERP",
            inAmount: "250000",
            outAmount: "1000000",
            priceImpactPct: 0,
            routePlan: [{ poolId: "SOL-PERP", swapInfo: { label: "Drift" } }],
          }),
        } as never,
        privyWalletId: "wallet_strategy_lab",
        intent: buildIntent(),
        log: () => {},
      },
      {
        prepareDriftLivePerpOrder: async () => ({
          marketIndex: 2,
          userAccountAddress: "drift-user-account",
          spotCollateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          setupAction: null,
          setupAmountAtomic: null,
          setupTransactionBase64: null,
          orderTransactionBase64: "order-tx",
          lastValidBlockHeight: 99,
          snapshotBefore: null,
        }),
        readDriftLiveAccountSnapshot: async () => {
          throw new Error("snapshot-rpc-temporary-failure");
        },
        signTransactionWithPrivyById: async (_env, _walletId, transaction) =>
          `signed:${transaction}`,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-order");
    expect(result.executionMeta?.classification).toBe("confirmed");
    expect(result.executionMeta?.lifecycle?.notes).toContain(
      "snapshotReadError:snapshot-rpc-temporary-failure",
    );
    expect(
      (
        result.executionMeta as
          | { driftAccount?: { snapshotReadError?: string | null } }
          | undefined
      )?.driftAccount?.snapshotReadError,
    ).toBe("snapshot-rpc-temporary-failure");
  });
});
