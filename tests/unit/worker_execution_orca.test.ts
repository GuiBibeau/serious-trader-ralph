import { describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeOrcaSwap } = await import(
  "../../apps/worker/src/execution/orca_executor"
);

function buildQuoteResponse() {
  return {
    inputMint: "mint-in",
    outputMint: "mint-out",
    inAmount: "1000",
    outAmount: "2200",
    slippageBps: 50,
    priceImpactPct: 0,
    routePlan: [{ swapInfo: { label: "Orca Whirlpool" }, poolId: "pool-1" }],
    orcaPoolSnapshot: {
      address: "pool-1",
      feeRate: 400,
      tickSpacing: 4,
    },
  };
}

describe("worker orca execution adapter", () => {
  test("returns dry_run without building transactions", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      additionalSignerCount: 1,
      lastValidBlockHeight: 42,
    }));

    const result = await executeOrcaSwap({
      env: {} as Env,
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      orca: { buildSwapTransaction } as never,
      quoteResponse: buildQuoteResponse(),
      userPublicKey: "11111111111111111111111111111111",
      privyWalletId: "wallet-id",
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("orca");
    expect(buildSwapTransaction).not.toHaveBeenCalled();
  });

  test("simulates Orca whirlpool swaps in bounded paper mode", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      additionalSignerCount: 1,
      lastValidBlockHeight: 42,
    }));
    const simulateTransactionBase64 = mock(async () => ({ err: null }));

    const result = await executeOrcaSwap(
      {
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {
          simulateTransactionBase64,
        } as never,
        jupiter: {} as never,
        orca: { buildSwapTransaction } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed"),
      },
    );

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.classification).toBe("simulated");
    expect(result.executionMeta?.lifecycle?.notes).toContain("orca-whirlpool");
    expect(simulateTransactionBase64).toHaveBeenCalledTimes(1);
  });

  test("submits and confirms Orca swaps when called in executable mode", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      additionalSignerCount: 1,
      lastValidBlockHeight: 42,
    }));
    const sendTransactionBase64 = mock(async () => "sig-1");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "confirmed",
    }));

    const result = await executeOrcaSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {} as never,
        orca: { buildSwapTransaction } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed"),
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-1");
    expect(confirmSignature).toHaveBeenCalledTimes(1);
  });

  test("uses confirmed preflight when the policy commitment is finalized", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      additionalSignerCount: 1,
      lastValidBlockHeight: 42,
    }));
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-finalized");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "finalized",
    }));

    const result = await executeOrcaSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "finalized" }),
        execution: { params: { lane: "safe" } },
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {} as never,
        orca: { buildSwapTransaction } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed"),
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
    expect(simulateTransactionBase64).toHaveBeenCalledWith("signed", {
      commitment: "confirmed",
      sigVerify: true,
    });
    expect(sendTransactionBase64).toHaveBeenCalledWith("signed", {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  });

  test("fails closed when Orca simulation fails", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      additionalSignerCount: 1,
      lastValidBlockHeight: 42,
    }));
    const simulateTransactionBase64 = mock(async () => ({
      err: { message: "simulation-failed" },
    }));

    const result = await executeOrcaSwap(
      {
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {
          simulateTransactionBase64,
        } as never,
        jupiter: {} as never,
        orca: { buildSwapTransaction } as never,
        quoteResponse: buildQuoteResponse(),
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        log: () => {},
      },
      {
        signTransactionWithPrivyById: mock(async () => "signed"),
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(result.signature).toBeNull();
    expect(result.executionMeta?.classification).toBe("error");
  });
});
