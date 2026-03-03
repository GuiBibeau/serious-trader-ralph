import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

function buildSignedSwapTxBase64(): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
  });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 200_000,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 10_000,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString("base64");
}

const buildAndSignPrivySwapTransactionMock = mock(async () => ({
  signedBase64: buildSignedSwapTxBase64(),
  usedQuote: {
    inputMint: "A",
    outputMint: "B",
    inAmount: "10",
    outAmount: "11",
  },
  refreshed: false,
  lastValidBlockHeight: 12345,
  txBuiltAt: "2026-03-03T00:00:00.000Z",
}));

const { executeJupiterSwap } = await import(
  "../../apps/worker/src/execution/jupiter_executor"
);

describe("worker jupiter execution adapter", () => {
  beforeEach(() => {
    buildAndSignPrivySwapTransactionMock.mockClear();
  });

  test("safe lane forces pre-dispatch simulation before submission", async () => {
    const callOrder: string[] = [];
    const simulateTransactionBase64 = mock(async () => {
      callOrder.push("simulate");
      return { err: null };
    });
    const sendTransactionBase64 = mock(async () => {
      callOrder.push("send");
      return "sig-safe-lane";
    });
    const confirmSignature = mock(async () => {
      callOrder.push("confirm");
      return { ok: true, status: "confirmed" };
    });

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        execution: {
          adapter: "jupiter",
          params: {
            lane: "safe",
          },
        },
        log: () => {},
      },
      {
        buildAndSignPrivySwapTransaction: buildAndSignPrivySwapTransactionMock,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(callOrder).toEqual(["simulate", "send", "confirm"]);
    expect(result.executionMeta?.trace?.simulatedAt).toBeString();
    expect(sendTransactionBase64).toHaveBeenCalledTimes(1);
  });

  test("safe lane returns policy-denied when guardrail evaluation fails", async () => {
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-safe-lane");

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature: async () => ({ ok: true, status: "confirmed" }),
        } as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        execution: {
          adapter: "jupiter",
          params: {
            lane: "safe",
          },
        },
        log: () => {},
      },
      {
        buildAndSignPrivySwapTransaction: buildAndSignPrivySwapTransactionMock,
        evaluateSafeLaneTransaction: () => ({
          ok: false,
          reason: "safe-lane-max-estimated-fee-exceeded",
          profile: null,
          limits: {
            maxTxBytes: 1232,
            maxInstructionCount: 24,
            maxAccountKeys: 96,
            maxComputeUnitLimit: 1_400_000,
            maxEstimatedFeeLamports: "10000",
          },
        }),
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(result.signature).toBeNull();
    expect(sendTransactionBase64).not.toHaveBeenCalled();
    expect(simulateTransactionBase64).not.toHaveBeenCalled();
    expect(
      (
        result.err as {
          code?: string;
          reason?: string;
        }
      ).code,
    ).toBe("policy-denied");
    expect(
      (
        result.err as {
          code?: string;
          reason?: string;
        }
      ).reason,
    ).toBe("safe-lane-max-estimated-fee-exceeded");
  });

  test("safe lane simulation failure is denied before sending transaction", async () => {
    const simulateTransactionBase64 = mock(async () => ({
      err: { message: "custom-program-error" },
    }));
    const sendTransactionBase64 = mock(async () => "sig-safe-lane");

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature: async () => ({ ok: true, status: "confirmed" }),
        } as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        execution: {
          adapter: "jupiter",
          params: {
            lane: "safe",
          },
        },
        log: () => {},
      },
      {
        buildAndSignPrivySwapTransaction: buildAndSignPrivySwapTransactionMock,
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(result.signature).toBeNull();
    expect(sendTransactionBase64).not.toHaveBeenCalled();
    expect(
      (
        result.err as {
          code?: string;
          reason?: string;
        }
      ).code,
    ).toBe("policy-denied");
    expect(
      (
        result.err as {
          code?: string;
          reason?: string;
        }
      ).reason,
    ).toBe("safe-lane-simulation-failed");
  });
});
