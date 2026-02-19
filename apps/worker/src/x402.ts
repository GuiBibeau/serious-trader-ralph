import { BILLING_USDC_MINT } from "./billing";
import { json } from "./response";
import type { Env } from "./types";

type X402RouteKey =
  | "market_snapshot"
  | "market_snapshot_v2"
  | "market_token_balance"
  | "market_jupiter_quote"
  | "market_jupiter_quote_batch"
  | "market_ohlcv"
  | "market_indicators"
  | "macro_signals"
  | "macro_fred_indicators"
  | "macro_etf_flows"
  | "macro_stablecoin_health"
  | "macro_oil_analytics";

type X402RouteConfig = {
  routeKey: X402RouteKey;
  network: string;
  payTo: string;
  asset: string;
  amountAtomic: string;
  priceUsd: string;
  maxTimeoutSeconds: number;
};

const PAYMENT_REQUIRED_HEADER = "payment-required";
const PAYMENT_SIGNATURE_HEADER = "payment-signature";
const PAYMENT_RESPONSE_HEADER = "payment-response";

function toBase64Json(input: unknown): string {
  const raw = JSON.stringify(input);
  let binary = "";
  for (const ch of new TextEncoder().encode(raw)) {
    binary += String.fromCharCode(ch);
  }
  return btoa(binary);
}

function parseUsdPriceToAtomic(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) {
    throw new Error("x402-route-config-invalid-price");
  }
  const [whole, fractionalRaw = ""] = trimmed.split(".");
  const fractional = fractionalRaw.padEnd(6, "0");
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fractional);
  if (atomic <= 0n) throw new Error("x402-route-config-invalid-price");
  return atomic.toString();
}

function normalizePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function loadRouteConfig(env: Env, routeKey: X402RouteKey): X402RouteConfig {
  const network = String(env.X402_NETWORK ?? "").trim();
  const payTo = String(env.X402_PAY_TO ?? "").trim();
  const asset = String(env.X402_ASSET_MINT ?? BILLING_USDC_MINT).trim();
  const priceUsdRaw =
    routeKey === "market_snapshot"
      ? String(env.X402_MARKET_SNAPSHOT_PRICE_USD ?? "").trim()
      : routeKey === "market_snapshot_v2"
        ? String(env.X402_MARKET_SNAPSHOT_V2_PRICE_USD ?? "").trim()
        : routeKey === "market_token_balance"
          ? String(env.X402_MARKET_TOKEN_BALANCE_PRICE_USD ?? "").trim()
          : routeKey === "market_jupiter_quote"
            ? String(env.X402_MARKET_JUPITER_QUOTE_PRICE_USD ?? "").trim()
            : routeKey === "market_jupiter_quote_batch"
              ? String(
                  env.X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD ?? "",
                ).trim()
              : routeKey === "market_ohlcv"
                ? String(env.X402_MARKET_OHLCV_PRICE_USD ?? "").trim()
                : routeKey === "market_indicators"
                  ? String(env.X402_MARKET_INDICATORS_PRICE_USD ?? "").trim()
                  : routeKey === "macro_signals"
                    ? String(env.X402_MACRO_SIGNALS_PRICE_USD ?? "").trim()
                    : routeKey === "macro_fred_indicators"
                      ? String(
                          env.X402_MACRO_FRED_INDICATORS_PRICE_USD ?? "",
                        ).trim()
                      : routeKey === "macro_etf_flows"
                        ? String(
                            env.X402_MACRO_ETF_FLOWS_PRICE_USD ?? "",
                          ).trim()
                        : routeKey === "macro_stablecoin_health"
                          ? String(
                              env.X402_MACRO_STABLECOIN_HEALTH_PRICE_USD ?? "",
                            ).trim()
                          : String(
                              env.X402_MACRO_OIL_ANALYTICS_PRICE_USD ?? "",
                            ).trim();
  if (!network || !payTo || !asset || !priceUsdRaw) {
    throw new Error("x402-route-config-missing");
  }
  return {
    routeKey,
    network,
    payTo,
    asset,
    amountAtomic: parseUsdPriceToAtomic(priceUsdRaw),
    priceUsd: priceUsdRaw,
    maxTimeoutSeconds: normalizePositiveInt(env.X402_MAX_TIMEOUT_SECONDS, 60),
  };
}

function buildPaymentRequirements(
  config: X402RouteConfig,
  request: Request,
  resourcePath: string,
) {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: config.network,
        asset: config.asset,
        amount: config.amountAtomic,
        payTo: config.payTo,
        maxTimeoutSeconds: config.maxTimeoutSeconds,
        extra: {
          route: config.routeKey,
          priceUsd: config.priceUsd,
        },
      },
    ],
    resource: {
      uri: resourcePath,
      method: request.method,
    },
  };
}

export function requireX402Payment(
  request: Request,
  env: Env,
  routeKey: X402RouteKey,
  resourcePath: string,
): Response | null {
  const config = loadRouteConfig(env, routeKey);
  const signature = String(
    request.headers.get(PAYMENT_SIGNATURE_HEADER) ??
      request.headers.get("x-payment") ??
      "",
  ).trim();
  if (signature) return null;

  const paymentRequired = buildPaymentRequirements(
    config,
    request,
    resourcePath,
  );
  const response = json(
    {
      ok: false,
      error: "payment-required",
      paymentRequired,
    },
    { status: 402 },
  );
  const headers = new Headers(response.headers);
  headers.set(PAYMENT_REQUIRED_HEADER, toBase64Json(paymentRequired));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withX402SettlementHeader(
  response: Response,
  request: Request,
  env: Env,
  routeKey: X402RouteKey,
  resourcePath: string,
): Response {
  const config = loadRouteConfig(env, routeKey);
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: config.network,
      asset: config.asset,
      amount: config.amountAtomic,
      payTo: config.payTo,
    },
    resource: {
      uri: resourcePath,
      method: request.method,
    },
    settled: true,
  };
  const headers = new Headers(response.headers);
  headers.set(PAYMENT_RESPONSE_HEADER, toBase64Json(payload));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
