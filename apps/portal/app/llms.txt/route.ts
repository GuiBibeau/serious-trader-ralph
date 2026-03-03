import { X402_ENDPOINTS } from "../api/_catalog";
import {
  buildDiscoveryUrls,
  resolveApiOriginFromRequest,
  toAbsoluteApiUrl,
  toApiRuntimePath,
} from "../api/_discovery";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const apiOrigin = resolveApiOriginFromRequest(request);
  const discovery = buildDiscoveryUrls(apiOrigin);
  const endpointLines = X402_ENDPOINTS.map((endpoint) => ({
    path: endpoint.path,
    runtimePath: toApiRuntimePath(endpoint.path),
    url: toAbsoluteApiUrl(apiOrigin, toApiRuntimePath(endpoint.path)),
  }));
  const body = [
    "Trader Ralph",
    "",
    "Solana-focused intelligence infrastructure.",
    "This file points agents to the public x402 API catalog resources.",
    "",
    `API origin: ${apiOrigin}`,
    `API docs: ${discovery.html}`,
    `API catalog JSON: ${discovery.json}`,
    `API catalog TXT: ${discovery.text}`,
    `API skills pack: ${discovery.skills}`,
    `OpenAPI: ${discovery.openapi}`,
    `Agent Registry metadata: ${discovery.agentRegistryMetadata}`,
    "",
    "Catalog scope: public x402 read endpoints only.",
    "Catalog includes market snapshots/quotes, loop views, macro analytics, and cross-venue perps intelligence.",
    "Public x402 endpoint URLs (runtime):",
    ...endpointLines.map(
      (endpoint) =>
        `- ${endpoint.url} (catalog path: ${endpoint.path}, runtime path: ${endpoint.runtimePath})`,
    ),
    "Perps endpoints: /x402/read/perps_funding_surface, /x402/read/perps_open_interest_surface, /x402/read/perps_venue_score.",
    "x402 verification policy: payment-signature must be an on-chain Solana transaction signature.",
    "Environment policy: dev expects devnet USDC; staging and production expect mainnet USDC.",
    "Supported trading tokens/pairs are published in the catalog under supportedTrading.",
    "Authenticated account/trading routes are not listed here.",
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
