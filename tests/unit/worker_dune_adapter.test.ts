import { describe, expect, test } from "bun:test";
import { DuneDataAdapter } from "../../apps/worker/src/data_sources/dune_adapter";
import { createDataSourceRegistry } from "../../apps/worker/src/data_sources/registry";
import type { Env } from "../../apps/worker/src/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function createMockDb() {
  return {
    prepare: (_sql: string) => ({
      bind: () => ({
        run: async () => ({}),
        all: async () => ({ results: [] }),
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
    }),
  };
}

function buildMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    WAITLIST_DB: createMockDb() as never,
    DUNE_API_KEY: "env-dune-key",
    DUNE_QUERY_ID: "query-789",
    ...(overrides as never),
  } as Env;
}

function mockFetchFactory(
  rows: Array<Record<string, unknown>>,
  onRequest: (input: RequestInfo | URL | string, init?: RequestInit) => void,
) {
  const originalFetch = globalThis.fetch;
  const restore = () => {
    globalThis.fetch = originalFetch;
  };
  globalThis.fetch = async (input, init) => {
    onRequest(input, init);
    return new Response(
      JSON.stringify({
        result: {
          rows,
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  return restore;
}

describe("worker dune adapter", () => {
  test("parses ohlcv rows from Dune payload", async () => {
    const rows = [
      {
        ts: "2025-01-01T00:00:00.000Z",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      },
      {
        ts: "2025-01-01T01:00:00.000Z",
        open: 101,
        high: 104,
        low: 100,
        close: 103,
        volume: 1200,
      },
    ];

    const restore = mockFetchFactory(rows, () => {});
    try {
      const adapter = new DuneDataAdapter(buildMockEnv());
      const bars = await adapter.fetchHourlyBars({
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        startMs: Date.now() - 2 * 60 * 60 * 1000,
        endMs: Date.now(),
        resolutionMinutes: 60,
      });

      expect(bars).toHaveLength(2);
      expect(bars[0]?.source).toBe("dune");
      expect(bars[0]?.open).toBe(100);
      expect(bars[1]?.ts).toContain("2025-01-01T01:00:00.000Z");
      expect(bars[1]?.instrument).toBe(`${SOL_MINT}/${USDC_MINT}`);
    } finally {
      restore();
    }
  });

  test("supports custom provider columns and query params", async () => {
    const rows = [
      {
        t: 1735689600,
        o: 25.1,
        h: 27.3,
        l: 24.9,
        c: 26.1,
      },
    ];
    let seenUrl = "";

    const restore = mockFetchFactory(rows, (input) => {
      seenUrl = String(input);
    });
    try {
      const adapter = new DuneDataAdapter({
        ...(buildMockEnv({
          DUNE_API_KEY: "provider-key",
          DUNE_QUERY_ID: "ignored-query",
        }) as Env),
      }, {
        providers: {
          dune: {
            apiKey: "provider-key",
            queryId: "query-registry-inline",
            params: {
              venue: "prediction",
              ignoreThis: "ignored",
            },
            columns: {
              ts: "t",
              open: "o",
              high: "h",
              low: "l",
              close: "c",
            },
            parameterWhitelist: ["venue"],
          },
        },
      });
      const bars = await adapter.fetchHourlyBars({
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        startMs: 1735689600000,
        endMs: 1735693200000,
        resolutionMinutes: 60,
      });

      expect(bars).toHaveLength(1);
      expect(bars[0]?.open).toBe(25.1);
      expect(bars[0]?.high).toBe(27.3);
      expect(bars[0]?.low).toBe(24.9);
      expect(bars[0]?.close).toBe(26.1);
      expect(seenUrl).toContain("/query/query-registry-inline/results");
      expect(new URL(seenUrl).searchParams.get("resolution_minutes")).toBe("60");
      expect(new URL(seenUrl).searchParams.get("venue")).toBe("prediction");
      expect(new URL(seenUrl).searchParams.get("ignoreThis")).toBeNull();
    } finally {
      restore();
    }
  });

  test("registry can use dune as first source when configured", async () => {
    const rows = [
      {
        ts: "2025-01-01T00:00:00.000Z",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
      },
    ];
    const restore = mockFetchFactory(rows, () => {});
    try {
      const env = buildMockEnv({
        DUNE_QUERY_ID: "query-registry",
      });
      const registry = createDataSourceRegistry(env, {
        priority: ["dune"],
        cacheTtlMinutes: 0,
        providers: {
          dune: {
            queryId: "query-registry",
            apiKey: "provider-key",
            columns: {
              ts: "ts",
              open: "open",
              high: "high",
              low: "low",
              close: "close",
              volume: "volume",
            },
          },
        },
      });
      const bars = await registry.fetchHourlyBars({
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        startMs: 1735689600000,
        endMs: 1735693200000,
        resolutionMinutes: 60,
      });
      expect(bars).toHaveLength(1);
      expect(bars[0]?.source).toBe("dune");
    } finally {
      restore();
    }
  });

  test("throws when dune config is missing credentials", () => {
    const env = buildMockEnv({
      DUNE_API_KEY: "",
      DUNE_QUERY_ID: "",
    });
    expect(() => new DuneDataAdapter(env)).toThrow(/dune-api-key-missing/);
  });
});
