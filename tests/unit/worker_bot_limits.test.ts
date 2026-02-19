import { afterEach, describe, expect, test } from "bun:test";
import {
  computeBotCreationLimits,
  MAX_FREE_BOTS,
  pickBaselineBotsForValuation,
} from "../../apps/worker/src/bot_limits";
import type { BotRow } from "../../apps/worker/src/bots_db";
import type { Env } from "../../apps/worker/src/types";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function makeBot(input: {
  id: string;
  createdAt: string;
  walletAddress?: string;
}): BotRow {
  return {
    id: input.id,
    userId: "user-1",
    name: `bot-${input.id}`,
    enabled: false,
    signerType: "privy",
    privyWalletId: `wallet-${input.id}`,
    walletAddress: input.walletAddress ?? `wallet-${input.id}`,
    lastTickAt: null,
    lastError: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function makeEnv(): Env {
  return {
    BALANCE_RPC_ENDPOINT: "https://rpc.test.local",
    JUPITER_BASE_URL: "https://jupiter.test.local",
    JUPITER_API_KEY: "jupiter-key",
  } as Env;
}

function mockValuationFetch(input: {
  solQuoteOutAmountAtomic: string;
  lamportsByWallet: Record<string, bigint>;
  usdcAtomicByWallet: Record<string, bigint>;
}) {
  globalThis.fetch = (async (
    request: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(request);

    if (url.includes("/swap/v1/quote")) {
      return new Response(
        JSON.stringify({
          outAmount: input.solQuoteOutAmountAtomic,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      id?: string;
      params?: unknown[];
    };
    const method = String(payload.method ?? "");

    if (method === "getBalance") {
      const wallet = String(payload.params?.[0] ?? "");
      const value = Number(input.lamportsByWallet[wallet] ?? 0n);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? "rpc-id",
          result: { value },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (method === "getTokenAccountsByOwner") {
      const wallet = String(payload.params?.[0] ?? "");
      const amount = String(input.usdcAtomicByWallet[wallet] ?? 0n);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? "rpc-id",
          result: {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        tokenAmount: { amount },
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response("unexpected-request", { status: 500 });
  }) as typeof fetch;
}

describe("worker bot limits", () => {
  test("baseline selection uses oldest 3 bots with deterministic tie-break by id", () => {
    const bots = [
      makeBot({ id: "d", createdAt: "2026-02-10T00:00:00.000Z" }),
      makeBot({ id: "b", createdAt: "2026-02-01T00:00:00.000Z" }),
      makeBot({ id: "a", createdAt: "2026-02-01T00:00:00.000Z" }),
      makeBot({ id: "c", createdAt: "2026-02-03T00:00:00.000Z" }),
    ];

    const baseline = pickBaselineBotsForValuation(bots, MAX_FREE_BOTS);
    expect(baseline.map((bot) => bot.id)).toEqual(["a", "b", "c"]);
  });

  test("allows create when user has fewer than 3 bots", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch-should-not-run");
    }) as typeof fetch;

    const env = makeEnv();
    const bots = [
      makeBot({ id: "a", createdAt: "2026-02-01T00:00:00.000Z" }),
      makeBot({ id: "b", createdAt: "2026-02-02T00:00:00.000Z" }),
    ];

    const limits = await computeBotCreationLimits(env, bots, {
      strictValuation: true,
    });

    expect(limits.canCreateExtraBot).toBe(true);
    expect(limits.valuationState).toBe("skipped");
    expect(limits.maxFreeBots).toBe(3);
  });

  test("blocks bot #4 when oldest 3 bot balances are below $5000", async () => {
    const env = makeEnv();
    const bots = [
      makeBot({
        id: "a",
        walletAddress: "wa",
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      makeBot({
        id: "b",
        walletAddress: "wb",
        createdAt: "2026-02-02T00:00:00.000Z",
      }),
      makeBot({
        id: "c",
        walletAddress: "wc",
        createdAt: "2026-02-03T00:00:00.000Z",
      }),
    ];

    mockValuationFetch({
      solQuoteOutAmountAtomic: "100000000",
      lamportsByWallet: { wa: 0n, wb: 0n, wc: 0n },
      usdcAtomicByWallet: {
        wa: 2_000_000_000n,
        wb: 1_000_000_000n,
        wc: 1_999_999_999n,
      },
    });

    const limits = await computeBotCreationLimits(env, bots, {
      strictValuation: true,
    });

    expect(limits.currentUsd).toBe("4999.99");
    expect(limits.canCreateExtraBot).toBe(false);
    expect(limits.valuationState).toBe("computed");
  });

  test("allows bot #4 when oldest 3 bot balances equal exactly $5000", async () => {
    const env = makeEnv();
    const bots = [
      makeBot({
        id: "a",
        walletAddress: "wa",
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      makeBot({
        id: "b",
        walletAddress: "wb",
        createdAt: "2026-02-02T00:00:00.000Z",
      }),
      makeBot({
        id: "c",
        walletAddress: "wc",
        createdAt: "2026-02-03T00:00:00.000Z",
      }),
    ];

    mockValuationFetch({
      solQuoteOutAmountAtomic: "100000000",
      lamportsByWallet: { wa: 0n, wb: 0n, wc: 0n },
      usdcAtomicByWallet: {
        wa: 2_000_000_000n,
        wb: 1_000_000_000n,
        wc: 2_000_000_000n,
      },
    });

    const limits = await computeBotCreationLimits(env, bots, {
      strictValuation: true,
    });

    expect(limits.currentUsd).toBe("5000.00");
    expect(limits.canCreateExtraBot).toBe(true);
  });

  test("allows bot #4 when oldest 3 bot balances exceed $5000", async () => {
    const env = makeEnv();
    const bots = [
      makeBot({
        id: "a",
        walletAddress: "wa",
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      makeBot({
        id: "b",
        walletAddress: "wb",
        createdAt: "2026-02-02T00:00:00.000Z",
      }),
      makeBot({
        id: "c",
        walletAddress: "wc",
        createdAt: "2026-02-03T00:00:00.000Z",
      }),
    ];

    mockValuationFetch({
      solQuoteOutAmountAtomic: "100000000",
      lamportsByWallet: { wa: 0n, wb: 0n, wc: 0n },
      usdcAtomicByWallet: {
        wa: 2_100_000_000n,
        wb: 1_400_000_000n,
        wc: 1_700_000_000n,
      },
    });

    const limits = await computeBotCreationLimits(env, bots, {
      strictValuation: true,
    });

    expect(limits.currentUsd).toBe("5200.00");
    expect(limits.canCreateExtraBot).toBe(true);
  });

  test("fails closed when valuation is unavailable in strict mode", async () => {
    const env = makeEnv();
    const bots = [
      makeBot({ id: "a", createdAt: "2026-02-01T00:00:00.000Z" }),
      makeBot({ id: "b", createdAt: "2026-02-02T00:00:00.000Z" }),
      makeBot({ id: "c", createdAt: "2026-02-03T00:00:00.000Z" }),
    ];

    globalThis.fetch = (async () => {
      throw new Error("network-down");
    }) as typeof fetch;

    await expect(
      computeBotCreationLimits(env, bots, {
        strictValuation: true,
      }),
    ).rejects.toThrow(/bot-limit-valuation-unavailable/);
  });
});
