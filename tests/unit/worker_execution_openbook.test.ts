import { describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeOpenBookClobOrder } = await import(
  "../../apps/worker/src/execution/openbook_executor"
);

function buildPlan() {
  return {
    unsignedTransactionBase64: "unsigned-openbook",
    lastValidBlockHeight: 55,
    market: {
      instrumentId: "SOL/USDC",
      marketAddress: "market-1",
      baseMint: "mint-base",
      quoteMint: "mint-quote",
      baseDecimals: 9,
      quoteDecimals: 6,
      bestBidPriceUi: 149.5,
      bestAskPriceUi: 150,
      bestBidSizeUi: 2,
      bestAskSizeUi: 3,
      spreadBps: 33,
      tickSizeUi: "0.01",
      minOrderSizeUi: "0.001",
      openOrdersAdminRequired: false,
      consumeEventsAdminRequired: false,
      closeMarketAdminRequired: false,
    },
    prerequisites: {
      openOrdersIndexer: "indexer-1",
      openOrdersAccount: "oo-1",
      userBaseAccount: "base-ata",
      userQuoteAccount: "quote-ata",
      userFundingAccount: "quote-ata",
      createdOpenOrdersIndexer: true,
      createdOpenOrdersAccount: true,
    },
    request: {
      side: "buy",
      quantityAtomic: "1000000000",
      quantityBaseUi: 1,
      orderType: "limit",
      timeInForce: "gtc",
      postOnly: false,
      limitPriceAtomic: "151000000",
      limitPriceUi: 151,
      clientOrderId: "42",
      estimatedQuoteUi: 151,
      estimatedQuoteAtomic: "151000000",
    },
    quotePreview: {
      inputMint: "mint-quote",
      outputMint: "mint-base",
      inAmount: "151000000",
      outAmount: "1000000000",
      priceImpactPct: 0,
      routePlan: [{ poolId: "market-1", swapInfo: { label: "OpenBook v2" } }],
    },
  };
}

function buildIntent() {
  return {
    family: "clob_order" as const,
    wallet: "11111111111111111111111111111111",
    venueKey: "openbook" as const,
    marketType: "spot" as const,
    instrumentId: "SOL/USDC",
    side: "buy",
    quantityAtomic: "1000000000",
    params: {
      orderType: "limit",
      timeInForce: "gtc",
      limitPriceAtomic: "151000000",
      clientOrderId: "42",
    },
  };
}

describe("worker OpenBook execution adapter", () => {
  test("returns dry_run for bounded OpenBook orders", async () => {
    const buildPlaceOrderPlan = mock(async () => buildPlan());

    const result = await executeOpenBookClobOrder({
      env: { RPC_ENDPOINT: "https://rpc.test" } as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      openbook: { buildPlaceOrderPlan } as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("openbook_v2");
    expect(buildPlaceOrderPlan).toHaveBeenCalledTimes(1);
  });

  test("simulates OpenBook orders in paper mode with Privy signing", async () => {
    const buildPlaceOrderPlan = mock(async () => buildPlan());
    const simulateTransactionBase64 = mock(async () => ({ err: null }));

    const result = await executeOpenBookClobOrder(
      {
        env: { RPC_ENDPOINT: "https://rpc.test" } as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {
          simulateTransactionBase64,
        } as never,
        jupiter: {} as never,
        openbook: { buildPlaceOrderPlan } as never,
        intent: buildIntent(),
        privyWalletId: "wallet-1",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-openbook"),
      },
    );

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.lifecycle?.orderState).toBe("open");
    expect(simulateTransactionBase64).toHaveBeenCalledTimes(1);
  });

  test("fails closed when safe-lane guardrails reject an OpenBook order", async () => {
    const buildPlaceOrderPlan = mock(async () => buildPlan());

    const result = await executeOpenBookClobOrder(
      {
        env: { RPC_ENDPOINT: "https://rpc.test" } as Env,
        runtimeMode: "paper",
        execution: {
          params: { lane: "safe" },
        },
        policy: normalizePolicy({}),
        rpc: {
          simulateTransactionBase64: mock(async () => ({ err: null })),
        } as never,
        jupiter: {} as never,
        openbook: { buildPlaceOrderPlan } as never,
        intent: buildIntent(),
        privyWalletId: "wallet-1",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-openbook"),
        evaluateSafeLaneTransaction: mock(() => ({
          ok: false,
          reason: "tx-account-keys-exceeds-safe-limit",
          profile: "safe",
          limits: {},
        })),
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(result.executionMeta?.classification).toBe("error");
    expect(result.executionMeta?.lifecycle?.orderState).toBe("rejected");
  });

  test("rejects live mode for OpenBook rollout", async () => {
    await expect(
      executeOpenBookClobOrder({
        env: { RPC_ENDPOINT: "https://rpc.test" } as Env,
        runtimeMode: "live",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/openbook-live-mode-not-supported/);
  });

  test("submits OpenBook venue smoke in live mode through the bounded bypass", async () => {
    const buildPlaceOrderPlan = mock(async () => buildPlan());
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-openbook");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "finalized",
    }));

    const result = await executeOpenBookClobOrder(
      {
        env: { RPC_ENDPOINT: "https://rpc.test" } as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        execution: {
          params: { lane: "safe", requireSimulation: true },
        },
        policy: normalizePolicy({ commitment: "finalized" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {} as never,
        openbook: { buildPlaceOrderPlan } as never,
        intent: buildIntent(),
        privyWalletId: "wallet-1",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-openbook"),
        evaluateSafeLaneTransaction: mock(() => ({
          ok: true,
          profile: {
            txSizeBytes: 512,
            instructionCount: 4,
            accountKeyCount: 12,
            addressTableLookupCount: 0,
            signatureCount: 2,
            computeUnitLimit: null,
            computeUnitPriceMicroLamports: null,
            estimatedFeeLamports: "10000",
          },
          limits: {
            maxTxBytes: 1232,
            maxInstructionCount: 24,
            maxAccountKeys: 96,
            maxComputeUnitLimit: 1_400_000,
            maxEstimatedFeeLamports: "2000000",
          },
        })),
      },
    );

    expect(result.status).toBe("finalized");
    expect(simulateTransactionBase64).toHaveBeenCalledWith("signed-openbook", {
      commitment: "confirmed",
      sigVerify: true,
    });
    expect(sendTransactionBase64).toHaveBeenCalledWith("signed-openbook", {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  });
});
