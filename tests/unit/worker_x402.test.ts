import { describe, expect, test } from "bun:test";
import type { Env } from "../../apps/worker/src/types";
import {
  requireX402Payment,
  withX402SettlementHeader,
} from "../../apps/worker/src/x402";

function createEnv(overrides?: Partial<Env>): Env {
  return {
    X402_NETWORK: "solana-devnet",
    X402_PAY_TO: "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
    X402_ASSET_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    X402_MAX_TIMEOUT_SECONDS: "60",
    X402_MARKET_SNAPSHOT_PRICE_USD: "0.01",
    X402_MARKET_SNAPSHOT_V2_PRICE_USD: "0.01",
    X402_MARKET_TOKEN_BALANCE_PRICE_USD: "0.01",
    X402_MARKET_JUPITER_QUOTE_PRICE_USD: "0.01",
    X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD: "0.01",
    X402_MARKET_OHLCV_PRICE_USD: "0.01",
    X402_MARKET_INDICATORS_PRICE_USD: "0.01",
    X402_MACRO_SIGNALS_PRICE_USD: "0.01",
    X402_MACRO_FRED_INDICATORS_PRICE_USD: "0.01",
    X402_MACRO_ETF_FLOWS_PRICE_USD: "0.01",
    X402_MACRO_STABLECOIN_HEALTH_PRICE_USD: "0.01",
    X402_MACRO_OIL_ANALYTICS_PRICE_USD: "0.01",
    ...overrides,
  } as Env;
}

function decodeBase64Json(value: string | null): Record<string, unknown> {
  if (!value) throw new Error("missing-header");
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded) as Record<string, unknown>;
}

describe("worker x402 helpers", () => {
  test("routes require payment when signature is absent", () => {
    const env = createEnv();
    const routes = [
      {
        key: "market_ohlcv",
        path: "/api/x402/read/market_ohlcv",
      },
      {
        key: "market_indicators",
        path: "/api/x402/read/market_indicators",
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
    ] as const;

    for (const route of routes) {
      const request = new Request(`http://localhost${route.path}`, {
        method: "POST",
      });
      const response = requireX402Payment(request, env, route.key, route.path);

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

  test("missing macro_signals price var throws config error", () => {
    const env = createEnv({ X402_MACRO_SIGNALS_PRICE_USD: undefined });
    const request = new Request(
      "http://localhost/api/x402/read/macro_signals",
      {
        method: "POST",
      },
    );
    expect(() =>
      requireX402Payment(
        request,
        env,
        "macro_signals",
        "/api/x402/read/macro_signals",
      ),
    ).toThrow(/x402-route-config-missing/);
  });
});
