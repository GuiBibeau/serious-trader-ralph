import { describe, expect, test } from "bun:test";
import { ComputeBudgetProgram, Keypair, SystemProgram } from "@solana/web3.js";
import {
  buildJupiterComposedPlan,
  shouldFallbackToPrebuiltJupiterSwap,
  shouldUseJupiterComposedPlan,
} from "../../apps/worker/src/execution/jupiter_composed_plan";
import type { JupiterSerializedInstruction } from "../../apps/worker/src/jupiter";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

function toSerializedInstruction(
  instruction: ReturnType<typeof ComputeBudgetProgram.setComputeUnitLimit>,
): JupiterSerializedInstruction;
function toSerializedInstruction(
  instruction: ReturnType<typeof ComputeBudgetProgram.setComputeUnitPrice>,
): JupiterSerializedInstruction;
function toSerializedInstruction(
  instruction: ReturnType<typeof SystemProgram.transfer>,
): JupiterSerializedInstruction;
function toSerializedInstruction(instruction: {
  programId: { toBase58(): string };
  keys: Array<{
    pubkey: { toBase58(): string };
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Uint8Array;
}): JupiterSerializedInstruction {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((account) => ({
      pubkey: account.pubkey.toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(instruction.data).toString("base64"),
  };
}

describe("worker Jupiter composed plan builder", () => {
  test("assembles instruction plans with compute overrides and route telemetry", async () => {
    const payer = Keypair.generate();
    const destination = Keypair.generate();
    const result = await buildJupiterComposedPlan({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ commitment: "confirmed" }),
      rpc: {
        getAddressLookupTableAccounts: async () => [],
        getLatestBlockhash: async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 9999,
        }),
      } as never,
      jupiter: {
        swapInstructions: async () => ({
          computeBudgetInstructions: [
            toSerializedInstruction(
              ComputeBudgetProgram.setComputeUnitLimit({
                units: 250_000,
              }),
            ),
            toSerializedInstruction(
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 5_000,
              }),
            ),
          ],
          setupInstructions: [
            toSerializedInstruction(
              SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: destination.publicKey,
                lamports: 1,
              }),
            ),
          ],
          swapInstruction: toSerializedInstruction(
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: destination.publicKey,
              lamports: 2,
            }),
          ),
          cleanupInstruction: toSerializedInstruction(
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: destination.publicKey,
              lamports: 3,
            }),
          ),
          addressLookupTableAddresses: [],
        }),
      } as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "100",
        outAmount: "110",
        routePlan: [
          { swapInfo: { label: "Meteora" } },
          { swapInfo: { label: "Raydium" } },
        ],
      },
      userPublicKey: payer.publicKey.toBase58(),
      execution: {
        adapter: "jupiter",
        params: {
          composePlan: true,
          computeUnitLimit: 400_000,
          priorityMicroLamports: 25_000,
        },
      },
      log: () => {},
    });

    expect(result.serializedBase64.length).toBeGreaterThan(0);
    expect(result.lastValidBlockHeight).toBe(9999);
    expect(result.referenceGuard.enabled).toBe(false);
    expect(result.summary).toMatchObject({
      mode: "instructions",
      routeHopCount: 2,
      routeLabels: ["Meteora", "Raydium"],
      instructionCount: 5,
      computeBudgetInstructionCount: 2,
      setupInstructionCount: 1,
      cleanupInstructionCount: 1,
      computeUnitLimit: 400_000,
      computeUnitPriceMicroLamports: "25000",
    });
  });

  test("only enables composed plans in simulate or paper-shadow contexts", () => {
    expect(
      shouldUseJupiterComposedPlan({
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
          },
        },
      } as never),
    ).toBe(true);
    expect(
      shouldFallbackToPrebuiltJupiterSwap({
        runtimeMode: "live",
        policy: normalizePolicy({ commitment: "confirmed" }),
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
          },
        },
      } as never),
    ).toBe(true);
    expect(
      shouldFallbackToPrebuiltJupiterSwap({
        runtimeMode: "paper",
        policy: normalizePolicy({ commitment: "confirmed" }),
        execution: {
          adapter: "jupiter",
          params: {
            composePlan: true,
          },
        },
      } as never),
    ).toBe(false);
  });
});
