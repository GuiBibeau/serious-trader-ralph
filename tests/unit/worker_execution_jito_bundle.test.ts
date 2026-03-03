import { beforeEach, describe, expect, mock, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const signTransactionWithPrivyByIdMock = mock(async () => "signed-base64");
const createPrivySolanaWalletMock = mock(async () => ({
  walletId: "mock-wallet-id",
  address: "mock-wallet-address",
}));
const getPrivyWalletAddressByIdMock = mock(
  async () => "mock-wallet-address-by-id",
);
const getPrivyWalletAddressMock = mock(async () => "mock-wallet-address");
const getPrivyUserByIdMock = mock(async () => ({
  id: "did:privy:mock-user",
  linked_accounts: [],
}));
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

mock.module("../../apps/worker/src/privy", () => ({
  createPrivySolanaWallet: createPrivySolanaWalletMock,
  getPrivyWalletAddress: getPrivyWalletAddressMock,
  getPrivyWalletAddressById: getPrivyWalletAddressByIdMock,
  getPrivyUserById: getPrivyUserByIdMock,
  signTransactionWithPrivyById: signTransactionWithPrivyByIdMock,
}));
mock.module("../../apps/worker/src/swap", () => ({
  swapWithRetry: swapWithRetryMock,
}));

const { executeJitoBundleSwap, resetJitoTipAccountCacheForTest } = await import(
  "../../apps/worker/src/execution/jito_bundle_executor"
);

const ORIGINAL_FETCH = globalThis.fetch;

describe("worker jito bundle execution adapter", () => {
  beforeEach(() => {
    createPrivySolanaWalletMock.mockClear();
    getPrivyWalletAddressByIdMock.mockClear();
    getPrivyWalletAddressMock.mockClear();
    getPrivyUserByIdMock.mockClear();
    signTransactionWithPrivyByIdMock.mockClear();
    swapWithRetryMock.mockClear();
    resetJitoTipAccountCacheForTest();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("returns dry_run without requiring jito endpoint", async () => {
    const result = await executeJitoBundleSwap({
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
    expect(result.executionMeta?.route).toBe("jito_bundle");
    expect(result.executionMeta?.classification).toBe("dry_run");
    expect(swapWithRetryMock).not.toHaveBeenCalled();
  });

  test("throws when block engine endpoint is missing", async () => {
    await expect(
      executeJitoBundleSwap({
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
        privyWalletId: "wallet-id",
        log: () => {},
      }),
    ).rejects.toThrow(/jito-block-engine-url-missing/);
  });

  test("simulate mode returns simulated classification", async () => {
    const result = await executeJitoBundleSwap({
      env: { JITO_BLOCK_ENGINE_URL: "https://block.engine" } as Env,
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
  });

  test("sends bundle and maps confirmed status with tip account metadata", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };
      if (body.method === "getTipAccounts") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: ["TipAccount111111111111111111111111111111111"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "sendBundle") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "bundle-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "getBundleStatuses") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [{ confirmationStatus: "confirmed" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-method", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeJitoBundleSwap({
      env: { JITO_BLOCK_ENGINE_URL: "https://block.engine" } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
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

    expect(result.status).toBe("confirmed");
    expect(result.executionMeta?.bundleId).toBe("bundle-1");
    expect(result.executionMeta?.tipAccount).toBe(
      "TipAccount111111111111111111111111111111111",
    );
    expect(result.executionMeta?.classification).toBe("confirmed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("retries protected lane dispatch when bundle status is dropped", async () => {
    let sendBundleCalls = 0;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };
      if (body.method === "getTipAccounts") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: ["TipAccount111111111111111111111111111111111"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "sendBundle") {
        sendBundleCalls += 1;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `bundle-${sendBundleCalls}`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "getBundleStatuses") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
              {
                confirmationStatus:
                  sendBundleCalls === 1 ? "dropped" : "confirmed",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-method", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeJitoBundleSwap({
      env: {
        JITO_BLOCK_ENGINE_URL: "https://block.engine",
        EXEC_PROTECTED_MAX_RETRIES: "2",
        EXEC_PROTECTED_RETRY_BASE_MS: "0",
      } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
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

    expect(result.status).toBe("confirmed");
    expect(result.executionMeta?.bundleId).toBe("bundle-2");
    expect(sendBundleCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("returns normalized error when protected lane retries are exhausted", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
      };
      if (body.method === "getTipAccounts") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: ["TipAccount111111111111111111111111111111111"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "sendBundle") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: "bundle-fail",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "getBundleStatuses") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [{ confirmationStatus: "dropped" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-method", { status: 500 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeJitoBundleSwap({
      env: {
        JITO_BLOCK_ENGINE_URL: "https://block.engine",
        EXEC_PROTECTED_MAX_RETRIES: "1",
        EXEC_PROTECTED_RETRY_BASE_MS: "0",
      } as Env,
      policy: normalizePolicy({ commitment: "confirmed" }),
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

    expect(result.status).toBe("error");
    const err = result.err as {
      code?: string;
      bundleStatus?: string;
      attempts?: number;
    };
    expect(err.code).toBe("submission-failed");
    expect(err.bundleStatus).toBe("dropped");
    expect(err.attempts).toBe(2);
  });
});
