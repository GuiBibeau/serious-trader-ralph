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
    "Catalog scope: public x402 endpoints (read + execution submit/status/receipt).",
    "Catalog includes market snapshots/quotes, loop views, macro analytics, cross-venue perps intelligence, and execution polling.",
    "Public x402 endpoint URLs (runtime):",
    ...endpointLines.map(
      (endpoint) =>
        `- ${endpoint.url} (catalog path: ${endpoint.path}, runtime path: ${endpoint.runtimePath})`,
    ),
    "Perps endpoints: /x402/read/perps_funding_surface, /x402/read/perps_open_interest_surface, /x402/read/perps_venue_score.",
    "Execution endpoints: /x402/exec/submit, /x402/exec/status/{requestId}, /x402/exec/receipt/{requestId}.",
    "x402 verification policy: payment-signature must be an on-chain Solana transaction signature.",
    "Payment policy: /x402/exec/submit and /x402/read/* are paid; status/receipt polling is public.",
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
