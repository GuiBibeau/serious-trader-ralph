import { afterEach, describe, expect, test } from "bun:test";
import { fetchHistoricalOhlcvRuntime } from "../../apps/worker/src/historical_ohlcv";
import type { Env } from "../../apps/worker/src/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const originalFetch = globalThis.fetch;

function createMockDb() {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    WAITLIST_DB: createMockDb() as never,
    ...overrides,
  } as Env;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("worker historical ohlcv runtime", () => {
  test("returns normalized hourly bars and trims to limit", async () => {
    const baseTsSec = Math.floor(Date.now() / 1000) - 30 * 3600;
    globalThis.fetch = (async () => {
      const items = Array.from({ length: 30 }, (_, i) => ({
        unixTime: baseTsSec + i * 3600,
        o: 100 + i,
        h: 101 + i,
        l: 99 + i,
        c: 100.5 + i,
        v: 1000 + i,
      }));
      return new Response(JSON.stringify({ data: items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const env = createEnv({ BIRDEYE_API_KEY: "test-key" });
    const result = await fetchHistoricalOhlcvRuntime(
      env,
      {
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        lookbackHours: 48,
        limit: 24,
        resolutionMinutes: 60,
      },
      { requireMints: true },
    );

    expect(result.baseMint).toBe(SOL_MINT);
    expect(result.quoteMint).toBe(USDC_MINT);
    expect(result.resolutionMinutes).toBe(60);
    expect(result.limit).toBe(24);
    expect(result.sourcePriorityUsed).toEqual(["birdeye", "dune"]);
    expect(result.bars).toHaveLength(24);
    expect(result.bars.every((bar) => bar.source === "birdeye")).toBe(true);
    for (let i = 1; i < result.bars.length; i += 1) {
      expect(Date.parse(result.bars[i - 1]?.ts)).toBeLessThanOrEqual(
        Date.parse(result.bars[i]?.ts),
      );
    }
  });

  test("rejects invalid resolution", async () => {
    const env = createEnv({ BIRDEYE_API_KEY: "test-key" });
    await expect(
      fetchHistoricalOhlcvRuntime(env, {
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        resolutionMinutes: 5,
      }),
    ).rejects.toThrow(/invalid-ohlcv-request/);
  });

  test("runtime path does not fallback to fixture-only config", async () => {
    const env = createEnv();
    await expect(
      fetchHistoricalOhlcvRuntime(
        env,
        {
          baseMint: SOL_MINT,
          quoteMint: USDC_MINT,
          lookbackHours: 48,
          limit: 48,
        },
        {
          dataSources: { priority: ["fixture"] },
        },
      ),
    ).rejects.toThrow(/ohlcv-fetch-failed/);
  });

  test("maps provider failures to ohlcv-fetch-failed", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream down", { status: 500 })) as typeof fetch;
    const env = createEnv({ BIRDEYE_API_KEY: "test-key" });

    await expect(
      fetchHistoricalOhlcvRuntime(
        env,
        {
          baseMint: SOL_MINT,
          quoteMint: USDC_MINT,
          lookbackHours: 48,
          limit: 48,
        },
        { dataSources: { priority: ["birdeye"] } },
      ),
    ).rejects.toThrow(/ohlcv-fetch-failed/);
  });
});
