const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  const body = [
    "Trader Ralph",
    "",
    "Solana-focused intelligence infrastructure.",
    "This file points agents to the public x402 API catalog resources.",
    "",
    `API docs: ${origin}/api`,
    `API catalog JSON: ${origin}/api/endpoints.json`,
    `API catalog TXT: ${origin}/api/endpoints.txt`,
    "",
    "Catalog scope: public x402 read endpoints only.",
    "Catalog includes market snapshots/quotes, loop views, macro analytics, and cross-venue perps intelligence.",
    "Perps endpoints: /api/x402/read/perps_funding_surface, /api/x402/read/perps_open_interest_surface, /api/x402/read/perps_venue_score.",
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
