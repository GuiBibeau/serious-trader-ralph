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

const buildJupiterComposedPlanMock = mock(async () => ({
  serializedBase64: buildSignedSwapTxBase64(),
  usedQuote: {
    inputMint: "A",
    outputMint: "B",
    inAmount: "10",
    outAmount: "11",
    routePlan: [{ swapInfo: { label: "Jupiter" } }],
  },
  txBuiltAt: "2026-03-03T00:00:00.000Z",
  lastValidBlockHeight: 54321,
  summary: {
    mode: "instructions" as const,
    routeHopCount: 1,
    routeLabels: ["Jupiter"],
    instructionCount: 4,
    computeBudgetInstructionCount: 1,
    setupInstructionCount: 1,
    cleanupInstructionCount: 1,
    otherInstructionCount: 0,
    addressLookupTableCount: 0,
    addressLookupTableAddresses: [],
    computeUnitLimit: 300000,
    computeUnitPriceMicroLamports: "25000",
  },
  referenceGuard: {
    enabled: true,
    verdict: "allow" as const,
    reason: null,
    executionPrice: "1.1",
    executionDivergenceBps: 12,
    snapshot: {
      instrumentKey: "A/B",
    },
  },
}));

const { executeJupiterSwap } = await import(
  "../../apps/worker/src/execution/jupiter_executor"
);

describe("worker jupiter execution adapter", () => {
  beforeEach(() => {
    buildAndSignPrivySwapTransactionMock.mockClear();
    buildJupiterComposedPlanMock.mockClear();
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

  test("non-safe lanes can require simulation via execution policy params", async () => {
    const callOrder: string[] = [];
    const simulateTransactionBase64 = mock(async () => {
      callOrder.push("simulate");
      return { err: null };
    });
    const sendTransactionBase64 = mock(async () => {
      callOrder.push("send");
      return "sig-protected";
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
            lane: "protected",
            requireSimulation: true,
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
    expect(sendTransactionBase64).toHaveBeenCalledTimes(1);
    expect(simulateTransactionBase64).toHaveBeenCalledTimes(1);
  });

  test("paper mode can simulate a composed Jupiter instruction plan", async () => {
    const simulateTransactionBase64 = mock(async () => ({
      err: null,
      unitsConsumed: 456789,
    }));
    const sendTransactionBase64 = mock(async () => "sig-paper");

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        runtimeMode: "paper",
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
          routePlan: [{ swapInfo: { label: "Jupiter" } }],
        },
        userPublicKey: "11111111111111111111111111111111",
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
          },
        },
        log: () => {},
      },
      {
        buildJupiterComposedPlan: buildJupiterComposedPlanMock,
      },
    );

    expect(result.status).toBe("simulated");
    expect(sendTransactionBase64).not.toHaveBeenCalled();
    expect(simulateTransactionBase64).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sigVerify: false,
      }),
    );
    expect(result.executionMeta?.referencePrice?.verdict).toBe("allow");
    expect(result.executionMeta?.composedPlan).toMatchObject({
      mode: "instructions",
      routeHopCount: 1,
      simulationUnitsConsumed: 456789,
    });
  });

  test("composed plans fail closed when the reference guard rejects execution", async () => {
    const simulateTransactionBase64 = mock(async () => ({
      err: null,
      unitsConsumed: 1234,
    }));

    buildJupiterComposedPlanMock.mockImplementationOnce(async () => ({
      ...(await buildJupiterComposedPlanMock()),
      referenceGuard: {
        enabled: true,
        verdict: "reject" as const,
        reason: "reference-price-execution-divergence",
        executionPrice: "1.4",
        executionDivergenceBps: 600,
        snapshot: {
          instrumentKey: "A/B",
        },
      },
    }));

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64: async () => "sig-paper",
          confirmSignature: async () => ({ ok: true, status: "confirmed" }),
        } as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
          routePlan: [{ swapInfo: { label: "Jupiter" } }],
        },
        userPublicKey: "11111111111111111111111111111111",
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
          },
        },
        log: () => {},
      },
      {
        buildJupiterComposedPlan: buildJupiterComposedPlanMock,
      },
    );

    expect(result.status).toBe("simulate_error");
    expect(simulateTransactionBase64).not.toHaveBeenCalled();
    expect((result.err as { code?: string; reason?: string }).code).toBe(
      "policy-denied",
    );
    expect(result.executionMeta?.referencePrice?.reason).toBe(
      "reference-price-execution-divergence",
    );
  });

  test("live composed-plan requests fall back to the prebuilt swap path", async () => {
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-live");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "confirmed",
    }));

    const result = await executeJupiterSwap(
      {
        env: {} as Env,
        runtimeMode: "live",
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
          routePlan: [{ swapInfo: { label: "Jupiter" } }],
        },
        userPublicKey: "11111111111111111111111111111111",
        privyWalletId: "wallet-id",
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
            requireSimulation: true,
          },
        },
        log: () => {},
      },
      {
        buildAndSignPrivySwapTransaction: buildAndSignPrivySwapTransactionMock,
        buildJupiterComposedPlan: buildJupiterComposedPlanMock,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(buildJupiterComposedPlanMock).not.toHaveBeenCalled();
    expect(result.executionMeta?.composedPlan).toMatchObject({
      mode: "prebuilt_fallback",
      fallbackReason: "live-composed-plan-disabled",
    });
  });
});
