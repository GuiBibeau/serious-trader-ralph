import { describe, expect, mock, test } from "bun:test";
import type { Env } from "../../apps/worker/src/types";
import {
  requireX402Payment,
  withX402SettlementHeader,
} from "../../apps/worker/src/x402";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
  SOL_MINT,
} from "../integration/_worker_live_test_utils";

function createEnv(overrides?: Partial<Env>): Env {
  return {
    X402_NETWORK: "solana-devnet",
    X402_PAY_TO: "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
    X402_ASSET_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    X402_ENFORCE_ONCHAIN: "0",
    X402_MAX_TIMEOUT_SECONDS: "60",
    X402_EXEC_SUBMIT_PRICE_USD: "0.01",
    X402_MARKET_SNAPSHOT_PRICE_USD: "0.01",
    X402_MARKET_SNAPSHOT_V2_PRICE_USD: "0.01",
    X402_MARKET_TOKEN_BALANCE_PRICE_USD: "0.01",
    X402_MARKET_JUPITER_QUOTE_PRICE_USD: "0.01",
    X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD: "0.01",
    X402_MARKET_OHLCV_PRICE_USD: "0.01",
    X402_MARKET_INDICATORS_PRICE_USD: "0.01",
    X402_SOLANA_MARKS_LATEST_PRICE_USD: "0.01",
    X402_SOLANA_SCORES_LATEST_PRICE_USD: "0.01",
    X402_SOLANA_VIEWS_TOP_PRICE_USD: "0.01",
    X402_MACRO_SIGNALS_PRICE_USD: "0.01",
    X402_MACRO_FRED_INDICATORS_PRICE_USD: "0.01",
    X402_MACRO_ETF_FLOWS_PRICE_USD: "0.01",
    X402_MACRO_STABLECOIN_HEALTH_PRICE_USD: "0.01",
    X402_MACRO_OIL_ANALYTICS_PRICE_USD: "0.01",
    X402_PERPS_FUNDING_SURFACE_PRICE_USD: "0.01",
    X402_PERPS_OPEN_INTEREST_SURFACE_PRICE_USD: "0.01",
    X402_PERPS_VENUE_SCORE_PRICE_USD: "0.01",
    ...overrides,
  } as Env;
}

function decodeBase64Json(value: string | null): Record<string, unknown> {
  if (!value) throw new Error("missing-header");
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded) as Record<string, unknown>;
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

describe("worker x402 helpers", () => {
  test("routes require payment when signature is absent", async () => {
    const env = createEnv();
    const routes = [
      {
        key: "exec_submit",
        path: "/api/x402/exec/submit",
      },
      {
        key: "market_ohlcv",
        path: "/api/x402/read/market_ohlcv",
      },
      {
        key: "market_indicators",
        path: "/api/x402/read/market_indicators",
      },
      {
        key: "solana_marks_latest",
        path: "/api/x402/read/solana_marks_latest",
      },
      {
        key: "solana_scores_latest",
        path: "/api/x402/read/solana_scores_latest",
      },
      {
        key: "solana_views_top",
        path: "/api/x402/read/solana_views_top",
      },
      {
        key: "macro_signals",
        path: "/api/x402/read/macro_signals",
      },
      {
        key: "macro_fred_indicators",
        path: "/api/x402/read/macro_fred_indicators",
      },
      {
        key: "macro_etf_flows",
        path: "/api/x402/read/macro_etf_flows",
      },
      {
        key: "macro_stablecoin_health",
        path: "/api/x402/read/macro_stablecoin_health",
      },
      {
        key: "macro_oil_analytics",
        path: "/api/x402/read/macro_oil_analytics",
      },
      {
        key: "perps_funding_surface",
        path: "/api/x402/read/perps_funding_surface",
      },
      {
        key: "perps_open_interest_surface",
        path: "/api/x402/read/perps_open_interest_surface",
      },
      {
        key: "perps_venue_score",
        path: "/api/x402/read/perps_venue_score",
      },
    ] as const;

    for (const route of routes) {
      const request = new Request(`http://localhost${route.path}`, {
        method: "POST",
      });
      const response = await requireX402Payment(
        request,
        env,
        route.key,
        route.path,
      );

      expect(response).not.toBeNull();
      expect(response?.status).toBe(402);
      const header = response?.headers.get("payment-required") ?? null;
      const payload = decodeBase64Json(header);
      expect(payload.x402Version).toBe(2);
      const accepts = Array.isArray(payload.accepts) ? payload.accepts : [];
      expect(accepts.length).toBe(1);
      const accept0 = accepts[0] as Record<string, unknown>;
      const extra = (accept0.extra ?? {}) as Record<string, unknown>;
      expect(extra.route).toBe(route.key);
    }
  });

  test("withX402SettlementHeader sets payment-response for macro_signals", () => {
    const env = createEnv();
    const request = new Request(
      "http://localhost/api/x402/read/macro_signals",
      {
        method: "POST",
        headers: {
          "payment-signature": "signed",
        },
      },
    );
    const base = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const settled = withX402SettlementHeader(
      base,
      request,
      env,
      "macro_signals",
      "/api/x402/read/macro_signals",
    );
    const header = settled.headers.get("payment-response");
    const payload = decodeBase64Json(header);
    expect(payload.settled).toBe(true);
    const resource = (payload.resource ?? {}) as Record<string, unknown>;
    expect(resource.uri).toBe("/api/x402/read/macro_signals");
    expect(resource.method).toBe("POST");
  });

  test("missing macro_signals price var throws config error", async () => {
    const env = createEnv({ X402_MACRO_SIGNALS_PRICE_USD: undefined });
    const request = new Request(
      "http://localhost/api/x402/read/macro_signals",
      {
        method: "POST",
      },
    );
    await expect(
      requireX402Payment(
        request,
        env,
        "macro_signals",
        "/api/x402/read/macro_signals",
      ),
    ).rejects.toThrow(/x402-route-config-missing/);
  });

  test("on-chain verification rejects malformed payment signature", async () => {
    const kvStore = new Map<string, string>();
    const env = createEnv({
      X402_ENFORCE_ONCHAIN: "1",
      CONFIG_KV: {
        async get(key: string) {
          return kvStore.get(key) ?? null;
        },
        async put(key: string, value: string) {
          kvStore.set(key, value);
        },
      } as KVNamespace,
    });
    const request = new Request(
      "http://localhost/api/x402/read/macro_signals",
      {
        method: "POST",
        headers: {
          "payment-signature": "signed",
        },
      },
    );

    const response = await requireX402Payment(
      request,
      env,
      "macro_signals",
      "/api/x402/read/macro_signals",
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(402);
    const payload = (await response?.json()) as { reason?: string };
    expect(payload.reason).toBe("x402-payment-signature-invalid");
  });

  test("corbits provider verifies and settles encoded payment payload", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/settle")) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "unexpected-url" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const env = createEnv({
        X402_PROVIDER: "corbits",
        X402_FACILITATOR_URL: "https://facilitator.corbits.dev",
        X402_ENFORCE_ONCHAIN: "1",
      });
      const paymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "solana-devnet",
        payload: {
          transaction: "AQ==",
        },
      };
      const request = new Request(
        "http://localhost/api/x402/read/macro_signals",
        {
          method: "POST",
          headers: {
            "payment-signature": encodeBase64Json(paymentPayload),
          },
        },
      );

      const response = await requireX402Payment(
        request,
        env,
        "macro_signals",
        "/api/x402/read/macro_signals",
      );
      expect(response).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const verifyCall = fetchMock.mock.calls[0];
      const verifyUrl = String(verifyCall?.[0] ?? "");
      expect(verifyUrl.endsWith("/verify")).toBe(true);
      const verifyBodyRaw = String((verifyCall?.[1]?.body as string) ?? "");
      const verifyBody = JSON.parse(verifyBodyRaw) as {
        paymentRequirements?: { maxAmountRequired?: string; scheme?: string };
      };
      expect(verifyBody.paymentRequirements?.maxAmountRequired).toBe("10000");
      expect(verifyBody.paymentRequirements?.scheme).toBe("exact");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("corbits provider returns payment-required when facilitator verify fails", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/verify")) {
        return new Response(
          JSON.stringify({ isValid: false, invalidReason: "invalid-payment" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const env = createEnv({
        X402_PROVIDER: "corbits",
        X402_FACILITATOR_URL: "https://facilitator.corbits.dev",
        X402_ENFORCE_ONCHAIN: "1",
      });
      const paymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "solana-devnet",
        payload: {
          transaction: "AQ==",
        },
      };
      const request = new Request(
        "http://localhost/api/x402/read/macro_signals",
        {
          method: "POST",
          headers: {
            "payment-signature": encodeBase64Json(paymentPayload),
          },
        },
      );

      const response = await requireX402Payment(
        request,
        env,
        "macro_signals",
        "/api/x402/read/macro_signals",
      );

      expect(response).not.toBeNull();
      expect(response?.status).toBe(402);
      const body = (await response?.json()) as { reason?: string };
      expect(body.reason).toBe("invalid-payment");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("market_jupiter_quote rejects supported mints when pair is not in trading universe", async () => {
    const worker = (await import("../../apps/worker/src/index")).default;
    const env = createWorkerLiveEnv();
    const ctx = createExecutionContextStub();

    const response = await worker.fetch(
      new Request("http://localhost/api/x402/read/market_jupiter_quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "unit-signed-payment",
        },
        body: JSON.stringify({
          inputMint: SOL_MINT,
          outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
          amount: "1000000",
          slippageBps: 50,
        }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      supportedMints?: string[];
      supportedPairs?: string[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("unsupported-trade-pair");
    expect(Array.isArray(payload.supportedMints)).toBe(true);
    expect(Array.isArray(payload.supportedPairs)).toBe(true);
    expect(payload.supportedPairs?.includes("SOL/USDT")).toBe(true);
    expect(payload.supportedPairs?.includes("BONK/USDC")).toBe(true);
  });
});
