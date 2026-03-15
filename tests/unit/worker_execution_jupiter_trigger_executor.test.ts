import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

function buildSignedTriggerTxBase64(): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
  });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 5_000,
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

const signTransactionWithPrivyByIdMock = mock(async () =>
  buildSignedTriggerTxBase64(),
);

const { executeJupiterConditionalSpotOrder } = await import(
  "../../apps/worker/src/execution/jupiter_trigger_executor"
);

describe("worker Jupiter Trigger execution adapter", () => {
  beforeEach(() => {
    signTransactionWithPrivyByIdMock.mockClear();
  });

  test("honors requireSimulation=false for live Trigger submits", async () => {
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-trigger-live");
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "confirmed",
    }));
    const createTriggerOrder = mock(async () => ({
      requestId: "trigger_request_1",
      order: "trigger_order_1",
      transaction: "unsigned-trigger-tx",
    }));

    const result = await executeJupiterConditionalSpotOrder(
      {
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {
          createTriggerOrder,
        } as never,
        privyWalletId: "wallet_1",
        execution: {
          adapter: "jupiter",
          params: {
            lane: "safe",
            requireSimulation: false,
          },
        },
        intent: {
          family: "conditional_spot_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "jupiter",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "100000000",
          params: {
            orderType: "limit",
            timeInForce: "gtc",
            limitPriceAtomic: "100000000",
          },
        },
        log: () => {},
      },
      {
        signTransactionWithPrivyById: signTransactionWithPrivyByIdMock,
      },
    );

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-trigger-live");
    expect(simulateTransactionBase64).not.toHaveBeenCalled();
    expect(sendTransactionBase64).toHaveBeenCalledTimes(1);
    expect(confirmSignature).toHaveBeenCalledTimes(1);
    expect(signTransactionWithPrivyByIdMock).toHaveBeenCalledTimes(1);
    expect(createTriggerOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          slippageBps: "50",
        }),
      }),
    );
  });

  test("preserves an open lifecycle when confirmation is uncertain after submit", async () => {
    const simulateTransactionBase64 = mock(async () => ({ err: null }));
    const sendTransactionBase64 = mock(async () => "sig-trigger-pending");
    const confirmSignature = mock(async () => ({
      ok: false,
      status: "processed",
      err: { message: "timeout" },
    }));

    const result = await executeJupiterConditionalSpotOrder(
      {
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({ commitment: "confirmed" }),
        rpc: {
          simulateTransactionBase64,
          sendTransactionBase64,
          confirmSignature,
        } as never,
        jupiter: {
          createTriggerOrder: async () => ({
            requestId: "trigger_request_2",
            order: "trigger_order_2",
            transaction: "unsigned-trigger-tx",
          }),
        } as never,
        privyWalletId: "wallet_1",
        execution: {
          adapter: "jupiter",
          params: {
            lane: "safe",
            requireSimulation: false,
          },
        },
        intent: {
          family: "conditional_spot_order",
          wallet: "11111111111111111111111111111111",
          venueKey: "jupiter",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "100000000",
          params: {
            orderType: "limit",
            timeInForce: "gtc",
            limitPriceAtomic: "100000000",
          },
        },
        log: () => {},
      },
      {
        signTransactionWithPrivyById: signTransactionWithPrivyByIdMock,
      },
    );

    expect(result.status).toBe("error");
    expect(result.signature).toBe("sig-trigger-pending");
    expect(result.executionMeta?.lifecycle?.orderState).toBe("open");
    expect(result.executionMeta?.lifecycle?.notes).toContain(
      "trigger-create-confirmation-pending",
    );
  });
});
