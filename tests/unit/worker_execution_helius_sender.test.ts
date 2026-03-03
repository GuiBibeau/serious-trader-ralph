import { beforeEach, describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const buildAndSignPrivySwapTransactionMock = mock(async () => ({
  signedBase64: "signed-base64-tx",
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

const { executeHeliusSenderSwap } = await import(
  "../../apps/worker/src/execution/helius_sender_executor"
);

const ORIGINAL_FETCH = globalThis.fetch;

function executeWithMockedBuilder(
  input: Parameters<typeof executeHeliusSenderSwap>[0],
) {
  return executeHeliusSenderSwap(input, {
    buildAndSignPrivySwapTransaction: buildAndSignPrivySwapTransactionMock,
  });
}

describe("worker helius sender execution adapter", () => {
  beforeEach(() => {
    buildAndSignPrivySwapTransactionMock.mockClear();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("returns dry_run without building or sending transactions", async () => {
    const result = await executeWithMockedBuilder({
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
    expect(result.executionMeta?.route).toBe("helius_sender");
    expect(result.executionMeta?.classification).toBe("dry_run");
    expect(buildAndSignPrivySwapTransactionMock).not.toHaveBeenCalled();
  });

  test("simulate mode returns simulated classification", async () => {
    const result = await executeWithMockedBuilder({
      env: {
        HELIUS_SENDER_URL: "https://sender.helius.test",
      } as Env,
      policy: normalizePolicy({ simulateOnly: true }),
      rpc: {
        simulateTransactionBase64: async () => ({ err: null }),
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
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.classification).toBe("simulated");
    expect(result.executionMeta?.trace?.simulatedAt).toBeString();
    expect(buildAndSignPrivySwapTransactionMock).toHaveBeenCalledTimes(1);
  });

  test("retries bounded sender submit and succeeds on later attempt", async () => {
    let callCount = 0;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };
      expect(body.method).toBe("sendTransaction");
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32000,
              message: "temporary upstream failure",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: "sig-123",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const log = mock((_level: string, _message: string) => {});
    const confirmSignature = mock(async () => ({
      ok: true,
      status: "confirmed",
    }));
    const result = await executeWithMockedBuilder({
      env: {
        HELIUS_SENDER_URL: "https://sender.helius.test",
        EXEC_FAST_MAX_RETRIES: "2",
        EXEC_FAST_RETRY_BASE_MS: "0",
      } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
      rpc: {
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
      log,
    });

    expect(result.status).toBe("confirmed");
    expect(result.signature).toBe("sig-123");
    expect(result.executionMeta?.classification).toBe("confirmed");
    expect(callCount).toBe(2);
    expect(confirmSignature).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
  });

  test("returns normalized error after bounded retries are exhausted", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32000,
            message: "temporary upstream failure",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const result = await executeWithMockedBuilder({
      env: {
        HELIUS_SENDER_URL: "https://sender.helius.test",
        EXEC_FAST_MAX_RETRIES: "1",
        EXEC_FAST_RETRY_BASE_MS: "0",
      } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
      rpc: {
        confirmSignature: async () => ({ ok: false, status: "timeout" }),
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
      log: () => {},
    });

    expect(result.status).toBe("error");
    const err = result.err as { code?: string; attempts?: number };
    expect(err.code).toBe("submission-failed");
    expect(err.attempts).toBe(2);
  });

  test("maps stale blockhash errors to canonical expired-blockhash code", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32001,
            message: "Blockhash not found",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const result = await executeWithMockedBuilder({
      env: {
        HELIUS_SENDER_URL: "https://sender.helius.test",
        EXEC_FAST_MAX_RETRIES: "0",
      } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
      rpc: {
        confirmSignature: async () => ({ ok: false, status: "timeout" }),
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
      log: () => {},
    });

    expect(result.status).toBe("error");
    const err = result.err as { code?: string };
    expect(err.code).toBe("expired-blockhash");
  });
});
