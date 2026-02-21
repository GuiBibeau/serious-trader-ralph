import { beforeEach, describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const swapWithRetryMock = mock(async () => ({
  swap: {
    swapTransaction: "unsigned-base64",
    lastValidBlockHeight: 12345,
  },
  quoteResponse: {
    inputMint: "A",
    outputMint: "B",
    inAmount: "10",
    outAmount: "11",
  },
  refreshed: false,
}));

mock.module("../../apps/worker/src/swap", () => ({
  swapWithRetry: swapWithRetryMock,
}));

const { executeMagicBlockEphemeralRollupSwap } = await import(
  "../../apps/worker/src/execution/magicblock_ephemeral_rollup_executor"
);

const ORIGINAL_FETCH = globalThis.fetch;

describe("worker magicblock ephemeral rollup execution adapter", () => {
  beforeEach(() => {
    swapWithRetryMock.mockClear();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("returns dry_run without requiring magicblock endpoint", async () => {
    const result = await executeMagicBlockEphemeralRollupSwap({
      env: {} as Env,
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
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("magicblock_ephemeral_rollup");
    expect(result.executionMeta?.classification).toBe("dry_run");
    expect(swapWithRetryMock).not.toHaveBeenCalled();
  });

  test("throws when magicblock endpoint is missing", async () => {
    await expect(
      executeMagicBlockEphemeralRollupSwap({
        env: {} as Env,
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

  test("simulate mode matches intent and returns simulated status", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/intents/match")) {
        return new Response(
          JSON.stringify({
            matchId: "match-1",
            sessionId: "session-1",
            status: "matched",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-route", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeMagicBlockEphemeralRollupSwap({
      env: {
        MAGICBLOCK_EPHEMERAL_ROLLUP_URL: "https://magicblock.example",
      } as Env,
      policy: normalizePolicy({ simulateOnly: true }),
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
    expect(result.executionMeta?.classification).toBe("simulated");
    expect(result.executionMeta?.intentId).toBe("match-1");
    expect(result.executionMeta?.venueSessionId).toBe("session-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("runs match and commit flow and returns settlement reference", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.endsWith("/v1/intents/match")) {
        return new Response(
          JSON.stringify({
            matchId: "match-2",
            sessionId: "session-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/intents/commit")) {
        return new Response(
          JSON.stringify({
            status: "finalized",
            settlementRef: "settlement-ref-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-route", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeMagicBlockEphemeralRollupSwap({
      env: {
        MAGICBLOCK_EPHEMERAL_ROLLUP_URL: "https://magicblock.example",
      } as Env,
      policy: normalizePolicy({ commitment: "finalized" }),
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

    expect(result.status).toBe("finalized");
    expect(result.signature).toBe("settlement-ref-1");
    expect(result.executionMeta?.route).toBe("magicblock_ephemeral_rollup");
    expect(result.executionMeta?.settlementRef).toBe("settlement-ref-1");
    expect(result.executionMeta?.classification).toBe("finalized");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
