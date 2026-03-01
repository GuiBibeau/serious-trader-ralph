import { afterEach, describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

const ORIGINAL_FETCH = globalThis.fetch;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

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
    ALLOWED_ORIGINS: "*",
    X402_NETWORK: "solana-devnet",
    X402_PAY_TO: "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
    X402_ASSET_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    X402_ENFORCE_ONCHAIN: "0",
    X402_MAX_TIMEOUT_SECONDS: "60",
    X402_MARKET_OHLCV_PRICE_USD: "0.01",
    X402_MARKET_INDICATORS_PRICE_USD: "0.01",
    ...overrides,
  } as Env;
}

function buildRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "signed",
    },
    body: JSON.stringify(body),
  });
}

function installJupiterQuoteMock(outAmount = "150000000"): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/swap/v1/quote")) {
      return new Response(
        JSON.stringify({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          inAmount: "1000000",
          outAmount,
          routePlan: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response("not-found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("worker x402 ohlcv fallback routes", () => {
  test("market_ohlcv falls back to jupiter quote bars when live providers are unavailable", async () => {
    installJupiterQuoteMock();
    const env = createEnv();
    const ctx = createExecutionContextStub();

    const response = await worker.fetch(
      buildRequest("/api/x402/read/market_ohlcv", {
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        lookbackHours: 48,
        limit: 24,
        resolutionMinutes: 60,
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("payment-response")).toBeTruthy();
    const payload = (await response.json()) as {
      ok?: boolean;
      ohlcv?: { bars?: Array<{ source?: string }> };
    };
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.ohlcv?.bars)).toBe(true);
    expect((payload.ohlcv?.bars ?? []).length).toBeGreaterThan(0);
    expect(
      (payload.ohlcv?.bars ?? []).every(
        (bar) => bar.source === "jupiter_quote_fallback",
      ),
    ).toBe(true);
  });

  test("market_indicators falls back to jupiter quote bars when live providers are unavailable", async () => {
    installJupiterQuoteMock("100000000");
    const env = createEnv();
    const ctx = createExecutionContextStub();

    const response = await worker.fetch(
      buildRequest("/api/x402/read/market_indicators", {
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        lookbackHours: 72,
        limit: 48,
        resolutionMinutes: 60,
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("payment-response")).toBeTruthy();
    const payload = (await response.json()) as {
      ok?: boolean;
      ohlcv?: { bars?: Array<{ source?: string }> };
      indicators?: { barCount?: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.indicators?.barCount ?? 0).toBeGreaterThan(0);
    expect(Array.isArray(payload.ohlcv?.bars)).toBe(true);
    expect(
      (payload.ohlcv?.bars ?? []).every(
        (bar) => bar.source === "jupiter_quote_fallback",
      ),
    ).toBe(true);
  });

  test("market_ohlcv still returns 503 if fallback quote fetch fails", async () => {
    globalThis.fetch = (async () =>
      new Response("upstream-down", { status: 500 })) as typeof fetch;
    const env = createEnv();
    const ctx = createExecutionContextStub();

    const response = await worker.fetch(
      buildRequest("/api/x402/read/market_ohlcv", {
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        lookbackHours: 48,
        limit: 24,
        resolutionMinutes: 60,
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "ohlcv-fetch-failed",
    });
  });
});
