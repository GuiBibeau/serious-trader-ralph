import { describe, expect, test } from "bun:test";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { evaluateSafeLaneTransaction } from "../../apps/worker/src/execution/safe_lane_policy";
import type { Env } from "../../apps/worker/src/types";

function buildSignedSwapTxBase64(input?: {
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: number;
}): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
  });

  if (typeof input?.computeUnitLimit === "number") {
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: input.computeUnitLimit,
      }),
    );
  }
  if (typeof input?.computeUnitPriceMicroLamports === "number") {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: input.computeUnitPriceMicroLamports,
      }),
    );
  }
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString("base64");
}

describe("worker safe lane policy guardrails", () => {
  test("accepts a bounded transaction under default limits", () => {
    const signedBase64 = buildSignedSwapTxBase64({
      computeUnitLimit: 200_000,
      computeUnitPriceMicroLamports: 10_000,
    });

    const result = evaluateSafeLaneTransaction({
      env: {} as Env,
      signedTransactionBase64: signedBase64,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.instructionCount).toBeGreaterThan(0);
    expect(result.profile.txSizeBytes).toBeGreaterThan(0);
    expect(result.profile.estimatedFeeLamports).toBeString();
  });

  test("rejects transactions when compute unit limit exceeds safe bounds", () => {
    const signedBase64 = buildSignedSwapTxBase64({
      computeUnitLimit: 900_000,
      computeUnitPriceMicroLamports: 5_000,
    });

    const result = evaluateSafeLaneTransaction({
      env: {
        EXEC_SAFE_MAX_COMPUTE_UNIT_LIMIT: "500000",
      } as Env,
      signedTransactionBase64: signedBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("safe-lane-max-compute-unit-limit-exceeded");
    expect(result.profile?.computeUnitLimit).toBe(900_000);
  });

  test("rejects transactions when estimated fees exceed safe bounds", () => {
    const signedBase64 = buildSignedSwapTxBase64({
      computeUnitLimit: 1_000_000,
      computeUnitPriceMicroLamports: 2_000_000,
    });

    const result = evaluateSafeLaneTransaction({
      env: {
        EXEC_SAFE_MAX_ESTIMATED_FEE_LAMPORTS: "10000",
      } as Env,
      signedTransactionBase64: signedBase64,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("safe-lane-max-estimated-fee-exceeded");
    expect(BigInt(result.profile?.estimatedFeeLamports ?? "0")).toBeGreaterThan(
      10_000n,
    );
  });

  test("returns deterministic invalid-transaction reason for malformed payload", () => {
    const result = evaluateSafeLaneTransaction({
      env: {} as Env,
      signedTransactionBase64: "not-base64-###",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("safe-lane-invalid-transaction");
    expect(result.profile).toBeNull();
  });
});
