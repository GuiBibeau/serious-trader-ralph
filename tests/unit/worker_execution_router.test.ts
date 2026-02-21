import { describe, expect, test } from "bun:test";
import {
  executeSwapViaRouter,
  registerExecutionAdapter,
} from "../../apps/worker/src/execution/router";
import { normalizePolicy } from "../../apps/worker/src/policy";

describe("worker execution router", () => {
  test("defaults to jupiter adapter and returns dry_run in dry mode", async () => {
    const result = await executeSwapViaRouter({
      env: {} as never,
      execution: undefined,
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
      },
      userPublicKey: "11111111111111111111111111111111",
      privyWalletId: undefined,
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.signature).toBeNull();
  });

  test("jito bundle adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "jito_bundle" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/jito-block-engine-url-missing/);
  });

  test("magicblock adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "magicblock_ephemeral_rollup" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/magicblock-ephemeral-rollup-url-missing/);
  });

  test("custom execution adapters can be registered for new venues", async () => {
    registerExecutionAdapter("venue_x", async (input) => ({
      status: "simulated",
      signature: "sig-venue-x",
      usedQuote: input.quoteResponse,
      refreshed: false,
      lastValidBlockHeight: 42,
    }));

    const result = await executeSwapViaRouter({
      env: {} as never,
      execution: { adapter: "venue_x" },
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
      },
      userPublicKey: "11111111111111111111111111111111",
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.signature).toBe("sig-venue-x");
  });
});
