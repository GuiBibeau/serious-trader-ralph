import { describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeDFlowPredictionOrder } = await import(
  "../../apps/worker/src/execution/dflow_executor"
);

function buildIntent() {
  return {
    family: "prediction_order" as const,
    wallet: "11111111111111111111111111111111",
    venueKey: "dflow" as const,
    marketType: "prediction" as const,
    instrumentId: "PRES-2028",
    outcomeId: "YesMint1111111111111111111111111111111",
    side: "buy_yes" as const,
    quantityAtomic: "1000000",
    params: {
      orderType: "limit",
      quantityMode: "notional",
      limitPriceAtomic: "520000",
    },
  };
}

function buildPreview() {
  return {
    market: {
      marketId: "PRES-2028",
      title: "Will candidate X win in 2028?",
      eventTitle: "Presidential election",
      status: "active",
      endTime: "2028-11-06T08:00:00.000Z",
      settleTime: null,
      accounts: [],
    },
    marketAccount: {
      accountId: "acct_1",
      yesMint: "YesMint1111111111111111111111111111111",
      noMint: "NoMint11111111111111111111111111111111",
      ledgerMint: "Ledger1111111111111111111111111111111",
      settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      yesBid: 0.49,
      yesAsk: 0.52,
      noBid: 0.47,
      noAsk: 0.51,
      volume: 2450,
      openInterest: 5000,
      redemptionStatus: "open",
      status: "active",
    },
    outcomeMint: "YesMint1111111111111111111111111111111",
    outcomeSide: "yes" as const,
    side: "buy_yes" as const,
    orderType: "limit" as const,
    timeInForce: "gtc" as const,
    quantityMode: "notional" as const,
    quantityAtomic: "1000000",
    settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    priceQuote: 0.52,
    estimatedNotionalUsd: 1,
    liveReady: false,
    notes: ["prediction-market-live-requires-proof"],
  };
}

function buildMarketPreview() {
  return {
    ...buildPreview(),
    orderType: "market" as const,
    notes: [],
  };
}

describe("worker DFlow prediction execution adapter", () => {
  test("returns dry_run for bounded DFlow prediction intents", async () => {
    const result = await executeDFlowPredictionOrder({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      dflow: {
        describePredictionIntent: async () => buildPreview(),
        buildSyntheticQuote: () => ({
          inputMint: "USDC",
          outputMint: "YES",
          inAmount: "1000000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [
            { poolId: "PRES-2028", swapInfo: { label: "DFlow Prediction" } },
          ],
        }),
      } as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("dflow");
    expect(result.executionMeta?.lifecycle?.positionState).toBe("opening");
    expect(result.executionMeta?.referencePrice?.snapshot?.marketId).toBe(
      "PRES-2028",
    );
  });

  test("simulates DFlow prediction intents in paper mode", async () => {
    const result = await executeDFlowPredictionOrder({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      dflow: {
        describePredictionIntent: async () => buildPreview(),
        buildSyntheticQuote: () => ({
          inputMint: "USDC",
          outputMint: "YES",
          inAmount: "1000000",
          outAmount: "1000000",
          priceImpactPct: 0,
          routePlan: [
            { poolId: "PRES-2028", swapInfo: { label: "DFlow Prediction" } },
          ],
        }),
      } as never,
      intent: buildIntent(),
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.referencePrice?.executionPrice).toBe("0.52");
    expect(result.executionMeta?.lifecycle?.settlementState).toBe("pending");
  });

  test("rejects live mode for DFlow rollout", async () => {
    await expect(
      executeDFlowPredictionOrder({
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/dflow-live-mode-not-supported/);
  });

  test("submits DFlow venue smoke in live mode through the bounded bypass", async () => {
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-dflow");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "finalized",
    }));

    const result = await executeDFlowPredictionOrder(
      {
        env: {} as Env,
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
        dflow: {
          describePredictionIntent: async () => buildMarketPreview(),
          buildSyntheticQuote: () => ({
            inputMint: "USDC",
            outputMint: "YES",
            inAmount: "1000000",
            outAmount: "1900000",
            priceImpactPct: 0,
            routePlan: [
              { poolId: "PRES-2028", swapInfo: { label: "DFlow Prediction" } },
            ],
          }),
          verifyPredictionWallet: async () => ({
            verified: true,
            raw: { verified: true },
          }),
          buildPredictionOrderTransaction: async () => ({
            transactionBase64: "unsigned-dflow",
            lastValidBlockHeight: 77,
            executionMode: "sync",
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "YesMint1111111111111111111111111111111",
            inAmount: "1000000",
            outAmount: "1900000",
            priceImpactPct: "0",
            routePlan: [
              { poolId: "PRES-2028", swapInfo: { label: "DFlow Prediction" } },
            ],
            raw: { executionMode: "sync" },
          }),
        } as never,
        intent: {
          ...buildIntent(),
          params: { orderType: "market", quantityMode: "notional" },
        },
        privyWalletId: "wallet_strategy_lab",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-dflow"),
        evaluateSafeLaneTransaction: mock(() => ({
          ok: true,
          profile: {
            txSizeBytes: 512,
            instructionCount: 4,
            accountKeyCount: 12,
            addressTableLookupCount: 0,
            signatureCount: 1,
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
    expect(result.executionMeta?.classification).toBe("finalized");
    expect(result.executionMeta?.route).toBe("dflow");
    expect(result.executionMeta?.lifecycle?.positionState).toBe("open");
    expect(simulateTransactionBase64).toHaveBeenCalledWith("signed-dflow", {
      commitment: "confirmed",
      sigVerify: true,
    });
    expect(sendTransactionBase64).toHaveBeenCalledWith("signed-dflow", {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  });

  test("blocks live buy orders when the receiving wallet is not Proof verified", async () => {
    await expect(
      executeDFlowPredictionOrder({
        env: {} as Env,
        runtimeMode: "live",
        experimentalLiveModeBypass: "venue_tx_smoke",
        subjectControlBypassReason: "strategy_lab_readiness_canary",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        dflow: {
          describePredictionIntent: async () => buildMarketPreview(),
          buildSyntheticQuote: () => ({
            inputMint: "USDC",
            outputMint: "YES",
            inAmount: "1000000",
            outAmount: "1900000",
            priceImpactPct: 0,
            routePlan: [],
          }),
          verifyPredictionWallet: async () => ({
            verified: false,
            raw: { verified: false },
          }),
        } as never,
        intent: {
          ...buildIntent(),
          params: { orderType: "market", quantityMode: "notional" },
        },
        privyWalletId: "wallet_strategy_lab",
        log: () => {},
      }),
    ).rejects.toThrow(/dflow-wallet-not-verified/);
  });
});
