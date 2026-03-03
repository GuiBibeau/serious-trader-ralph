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
const EXEC_SUBMIT_PRIVY_EXAMPLE = {
  schemaVersion: "v1",
  mode: "privy_execute",
  lane: "safe",
  metadata: {
    source: "terminal-ui",
    reason: "rebalance",
    clientRequestId: "ui-001",
  },
  privyExecute: {
    intentType: "swap",
    wallet: "4Nd1mYjtY9p7jW3nX5z9r4s1v6u8t2q3m5n7p9r1s2t3",
    swap: {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "100000000",
      slippageBps: 50,
    },
    options: {
      commitment: "confirmed",
    },
  },
} satisfies Record<string, unknown>;

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const discovery = buildDiscoveryUrls(apiOrigin);
  const runtimeBasePath = toApiRuntimePath("/x402");

  const payload: CatalogDoc & {
    examples: {
      paymentRequiredResponse: Record<string, unknown>;
      execSubmitModes: {
        relaySigned: Record<string, unknown>;
        privyExecute: Record<string, unknown>;
      };
    };
    discovery: DiscoveryUrls;
    runtime: {
      apiOrigin: string;
      x402BasePath: string;
      x402BaseUrl: string;
      endpoints: Array<{
        id: string;
        method: CatalogDoc["endpoints"][number]["method"];
        runtimePath: string;
        url: string;
      }>;
    };
  } = {
    name: "Trader Ralph x402 API Catalog",
    version: X402_CATALOG_VERSION,
    basePath: "/x402",
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
      execSubmitModes: {
        relaySigned:
          X402_ENDPOINTS.find((endpoint) => endpoint.id === "exec_submit")
            ?.requestExample ?? {},
        privyExecute: EXEC_SUBMIT_PRIVY_EXAMPLE,
      },
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
