import {
  type CatalogDoc,
  X402_CATALOG_VERSION,
  X402_ENDPOINTS,
  X402_OVERVIEW,
  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
  X402_SUPPORTED_TRADING,
} from "../_catalog";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;

  const payload: CatalogDoc & {
    examples: {
      paymentRequiredResponse: Record<string, unknown>;
    };
    discovery: {
      html: string;
      json: string;
      text: string;
      llms: string;
    };
  } = {
    name: "Trader Ralph x402 API Catalog",
    version: X402_CATALOG_VERSION,
    basePath: "/api/x402/read",
    supportedTrading: X402_SUPPORTED_TRADING,
    auth: {
      type: "x402",
      requestHeader: "payment-signature",
      paymentRequiredHeader: "payment-required",
      paymentResponseHeader: "payment-response",
    },
    overview: X402_OVERVIEW,
    endpoints: X402_ENDPOINTS,
    examples: {
      paymentRequiredResponse: X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
    },
    discovery: {
      html: `${origin}/api`,
      json: `${origin}/api/endpoints.json`,
      text: `${origin}/api/endpoints.txt`,
      llms: `${origin}/llms.txt`,
    },
  };

  return Response.json(payload, {
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
