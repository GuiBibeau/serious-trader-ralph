import { afterEach, describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

const ORIGINAL_FETCH = globalThis.fetch;

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    ALLOWED_ORIGINS: "*",
    X402_NETWORK: "solana-devnet",
    X402_PAY_TO: "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
    X402_ASSET_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    X402_MAX_TIMEOUT_SECONDS: "60",
    X402_PERPS_FUNDING_SURFACE_PRICE_USD: "0.01",
    X402_PERPS_OPEN_INTEREST_SURFACE_PRICE_USD: "0.01",
    X402_PERPS_VENUE_SCORE_PRICE_USD: "0.01",
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

function installPerpsFetchMock() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.hyperliquid.xyz/info")) {
      return new Response(
        JSON.stringify([
          {
            universe: [{ name: "BTC" }, { name: "ETH" }, { name: "SOL" }],
          },
          [
            {
              funding: "0.0000100",
              openInterest: "21000",
              markPx: "65000",
              dayNtlVlm: "1250000000",
            },
            {
              funding: "0.0000035",
              openInterest: "350000",
              markPx: "1900",
              dayNtlVlm: "450000000",
            },
            {
              funding: "-0.0000070",
              openInterest: "2800000",
              markPx: "82",
              dayNtlVlm: "280000000",
            },
          ],
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (url.includes("indexer.dydx.trade/v4/perpetualMarkets")) {
      return new Response(
        JSON.stringify({
          markets: {
            "BTC-USD": {
              ticker: "BTC-USD",
              status: "ACTIVE",
              nextFundingRate: "0.0000120",
              openInterest: "420",
              oraclePrice: "65100",
              volume24H: "100000000",
            },
            "ETH-USD": {
              ticker: "ETH-USD",
              status: "ACTIVE",
              nextFundingRate: "0.0000018",
              openInterest: "9600",
              oraclePrice: "1915",
              volume24H: "28000000",
            },
            "SOL-USD": {
              ticker: "SOL-USD",
              status: "ACTIVE",
              nextFundingRate: "0.0000034",
              openInterest: "142000",
              oraclePrice: "81.8",
              volume24H: "12500000",
            },
          },
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

describe("worker x402 perps routes", () => {
  test("serves cross-venue funding, open interest and venue score", async () => {
    installPerpsFetchMock();
    const env = createEnv();
    const ctx = createExecutionContextStub();

    const fundingResponse = await worker.fetch(
      buildRequest("/api/x402/read/perps_funding_surface", {
        symbols: ["BTC", "SOL"],
        venues: ["hyperliquid", "dydx"],
      }),
      env,
      ctx,
    );
    expect(fundingResponse.status).toBe(200);
    const fundingBody = (await fundingResponse.json()) as {
      ok?: boolean;
      symbols?: string[];
      rows?: Array<{ symbol?: string; byVenue?: Array<{ venue?: string }> }>;
    };
    expect(fundingBody.ok).toBe(true);
    expect(fundingBody.symbols).toEqual(["BTC", "SOL"]);
    expect(Array.isArray(fundingBody.rows)).toBe(true);
    expect((fundingBody.rows ?? []).length).toBe(2);
    expect((fundingBody.rows?.[0]?.byVenue ?? []).length).toBeGreaterThan(1);

    const openInterestResponse = await worker.fetch(
      buildRequest("/api/x402/read/perps_open_interest_surface", {
        symbols: ["BTC", "ETH", "SOL"],
      }),
      env,
      ctx,
    );
    expect(openInterestResponse.status).toBe(200);
    const openInterestBody = (await openInterestResponse.json()) as {
      ok?: boolean;
      rows?: Array<{ symbol?: string; totalOpenInterestUsd?: number }>;
    };
    expect(openInterestBody.ok).toBe(true);
    expect(Array.isArray(openInterestBody.rows)).toBe(true);
    expect((openInterestBody.rows ?? []).length).toBe(3);
    expect(
      Number(openInterestBody.rows?.[0]?.totalOpenInterestUsd ?? 0),
    ).toBeGreaterThan(0);

    const venueScoreResponse = await worker.fetch(
      buildRequest("/api/x402/read/perps_venue_score", {
        symbols: ["BTC", "ETH", "SOL"],
      }),
      env,
      ctx,
    );
    expect(venueScoreResponse.status).toBe(200);
    const venueScoreBody = (await venueScoreResponse.json()) as {
      ok?: boolean;
      recommendedVenue?: string | null;
      scores?: Array<{ venue?: string; score?: number }>;
    };
    expect(venueScoreBody.ok).toBe(true);
    expect(typeof venueScoreBody.recommendedVenue).toMatch(/string|object/);
    expect(Array.isArray(venueScoreBody.scores)).toBe(true);
    expect((venueScoreBody.scores ?? []).length).toBeGreaterThan(0);
  });

  test("rejects malformed perps payloads", async () => {
    installPerpsFetchMock();
    const env = createEnv();
    const ctx = createExecutionContextStub();

    const response = await worker.fetch(
      buildRequest("/api/x402/read/perps_funding_surface", {
        venues: "hyperliquid",
      } as unknown as Record<string, unknown>),
      env,
      ctx,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid-perps-request",
    });
  });
});
