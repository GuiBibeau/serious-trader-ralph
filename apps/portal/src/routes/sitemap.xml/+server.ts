import { error } from "@sveltejs/kit";
import { getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const SITE = "https://traderralph.com";

export const GET: RequestHandler = async ({ setHeaders }) => {
  // Fail rather than cache a near-empty sitemap at the CDN for an hour.
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });

  const urls = [
    `${SITE}/`,
    `${SITE}/news`,
    `${SITE}/equities`,
    `${SITE}/pre-ipo`,
    `${SITE}/crypto`,
    // Spotlights only earn a sitemap slot once they have live market data —
    // thin pages stay reachable but aren't promoted to crawlers.
    ...assets
      .filter((asset) => asset.price !== null && (asset.volume24hUsd ?? 0) > 0)
      .map((asset) => `${SITE}/${asset.slug}`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>
`;

  setHeaders({
    "content-type": "application/xml",
    "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
  });
  return new Response(body);
};
