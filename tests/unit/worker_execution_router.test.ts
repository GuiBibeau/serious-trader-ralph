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

  test("helius sender adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "helius_sender" },
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
    ).rejects.toThrow(/helius-sender-url-missing/);
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
    registerExecutionAdapter(
      "phoenix_orderbook",
      async (input) => ({
        status: "simulated",
        signature: "sig-phoenix",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "phoenix",
        supportedModes: ["shadow", "paper"],
      },
    );

    const result = await executeSwapViaRouter({
      env: {} as never,
      venueKey: "phoenix",
      runtimeMode: "paper",
      execution: { adapter: "phoenix_orderbook" },
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
    expect(result.signature).toBe("sig-phoenix");
  });

  test("fails closed when a venue adapter does not match the runtime venue", async () => {
    registerExecutionAdapter("venue_x", async (input) => ({
      status: "simulated",
      signature: "sig-venue-x",
      usedQuote: input.quoteResponse,
      refreshed: false,
      lastValidBlockHeight: 42,
    }));

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
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
      }),
    ).rejects.toThrow(/execution-adapter-venue-mismatch/);
  });

  test("fails closed when adapter is not allowlisted for the runtime venue", async () => {
    registerExecutionAdapter(
      "jupiter_shadow_probe",
      async (input) => ({
        status: "simulated",
        signature: "sig-jupiter-shadow",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "jupiter",
        supportedModes: ["shadow", "paper"],
      },
    );

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
        execution: { adapter: "jupiter_shadow_probe" },
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
    ).rejects.toThrow(/runtime-venue-adapter-not-supported/);
  });

  test("fails closed when runtime routing metadata is required but missing", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        requireVenueRouting: true,
        execution: { adapter: "jupiter" },
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
    ).rejects.toThrow(/runtime-venue-required/);
  });
});
