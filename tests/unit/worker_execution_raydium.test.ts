import { describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeRaydiumSwap } = await import(
  "../../apps/worker/src/execution/raydium_executor"
);

function buildQuoteResponse() {
  return {
    inputMint: "mint-in",
    outputMint: "mint-out",
    inAmount: "1000",
    outAmount: "2200",
    priceImpactPct: 0,
    routePlan: [{ swapInfo: { label: "Raydium" }, poolId: "pool-1" }],
    raydiumQuoteEnvelope: {
      id: "quote-1",
      success: true,
      data: {
        inputMint: "mint-in",
        outputMint: "mint-out",
        inputAmount: "1000",
        outputAmount: "2200",
      },
    },
  };
}

describe("worker raydium execution adapter", () => {
  test("returns dry_run without building transactions", async () => {
    const buildSwapTransactions = mock(async () => ({
      envelope: { success: true, data: [{ transaction: "unsigned" }] },
      transactions: ["unsigned"],
      computeUnitPriceMicroLamports: "10000",
    }));

    const result = await executeRaydiumSwap({
      env: {} as Env,
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      raydium: { buildSwapTransactions } as never,
      quoteResponse: buildQuoteResponse(),
      userPublicKey: "11111111111111111111111111111111",
      privyWalletId: "wallet-id",
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("raydium");
    expect(buildSwapTransactions).not.toHaveBeenCalled();
  });

  test("simulates a bounded Raydium transaction sequence", async () => {
    const buildSwapTransactions = mock(async () => ({
      envelope: { success: true, data: [{ transaction: "unsigned-1" }] },
      transactions: ["unsigned-1"],
      computeUnitPriceMicroLamports: "10000",
    }));
    const simulateTransactionBase64 = mock(async () => ({ err: null }));

    const result = await executeRaydiumSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ simulateOnly: true }),
        rpc: {
          simulateTransactionBase64,
        } as never,
        jupiter: {} as never,
        raydium: { buildSwapTransactions } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-1"),
      },
    );

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.classification).toBe("simulated");
    expect(result.executionMeta?.trace?.simulatedAt).toBeString();
    expect(simulateTransactionBase64).toHaveBeenCalledTimes(1);
  });

  test("submits and confirms multiple Raydium transactions sequentially", async () => {
    const buildSwapTransactions = mock(async () => ({
      envelope: {
        success: true,
        data: [{ transaction: "unsigned-1" }, { transaction: "unsigned-2" }],
      },
      transactions: ["unsigned-1", "unsigned-2"],
      computeUnitPriceMicroLamports: "10000",
    }));
    const signTransactionWithPrivyById = mock(
      async (_env: Env, _walletId: string, tx: string) => `signed:${tx}`,
    );
    const sendTransactionBase64 = mock(
      async (signedBase64Tx: string) => `sig:${signedBase64Tx}`,
    );
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "confirmed",
    }));

    const result = await executeRaydiumSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {} as never,
        raydium: { buildSwapTransactions } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig:signed:unsigned-2");
    expect(result.executionMeta?.settlementRef).toBe(
      "sig:signed:unsigned-1,sig:signed:unsigned-2",
    );
    expect(confirmSignature).toHaveBeenCalledTimes(2);
  });

  test("fails closed when simulation fails on a Raydium transaction", async () => {
    const buildSwapTransactions = mock(async () => ({
      envelope: { success: true, data: [{ transaction: "unsigned-1" }] },
      transactions: ["unsigned-1"],
      computeUnitPriceMicroLamports: "10000",
    }));
    const simulateTransactionBase64 = mock(async () => ({
      err: { message: "program-failed" },
    }));

    const result = await executeRaydiumSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ simulateOnly: true }),
        rpc: {
          simulateTransactionBase64,
        } as never,
        jupiter: {} as never,
        raydium: { buildSwapTransactions } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed-1"),
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(result.signature).toBeNull();
    expect(result.executionMeta?.classification).toBe("error");
  });
});
