import {
  type CatalogDoc,
  X402_CATALOG_VERSION,
  X402_ENDPOINTS,
  X402_OVERVIEW,
  X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE,
  X402_SUPPORTED_TRADING,
} from "../_catalog";
import {
  buildDiscoveryUrls,
  type DiscoveryUrls,
  resolveApiOriginFromRequest,
  toAbsoluteApiUrl,
  toApiRuntimePath,
} from "../_discovery";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const discovery = buildDiscoveryUrls(apiOrigin);
  const runtimeBasePath = toApiRuntimePath("/x402/read");

  const payload: CatalogDoc & {
    examples: {
      paymentRequiredResponse: Record<string, unknown>;
    };
    discovery: DiscoveryUrls;
    runtime: {
      apiOrigin: string;
      x402BasePath: string;
      x402BaseUrl: string;
      endpoints: Array<{
        id: string;
        method: "POST";
        runtimePath: string;
        url: string;
      }>;
    };
  } = {
    name: "Trader Ralph x402 API Catalog",
    version: X402_CATALOG_VERSION,
    basePath: "/x402/read",
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
    discovery,
    runtime: {
      apiOrigin,
      x402BasePath: runtimeBasePath,
      x402BaseUrl: toAbsoluteApiUrl(apiOrigin, runtimeBasePath),
      endpoints: X402_ENDPOINTS.map((endpoint) => {
        const runtimePath = toApiRuntimePath(endpoint.path);
        return {
          id: endpoint.id,
          method: endpoint.method,
          runtimePath,
          url: toAbsoluteApiUrl(apiOrigin, runtimePath),
        };
      }),
    },
  };

  return Response.json(payload, {
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": "application/json; charset=utf-8",
    },
  });
}
