import { error } from "@sveltejs/kit";
import { getCatalog, getNewsFeed, titleMatches } from "$lib/server/tokensxyz";
import type { PageServerLoad } from "./$types";

// ISR: the wire re-renders at most every 2 minutes.
export const config = { isr: { expiration: 120 } };

export const load: PageServerLoad = async () => {
  // The wire IS this page — never let ISR cache an empty render of it.
  const news = await getNewsFeed(60).catch(() => {
    error(503, "News feed unavailable");
  });
  const assets = await getCatalog().catch(() => []);

  // Tag each headline with matching assets so we can deep-link to spotlights.
  // Both symbol and name use word-bounded matching ("ondo" must not tag
  // headlines about London).
  const taggable = assets.slice(0, 120).map((asset) => ({
    slug: asset.slug,
    symbol: asset.symbol,
    name: asset.name,
  }));

  return {
    generatedAt: Date.now(),
    items: news.map((item) => ({
      ...item,
      tags: taggable
        .filter(
          (entry) =>
            titleMatches(item.title, entry.symbol) ||
            titleMatches(item.title, entry.name),
        )
        .slice(0, 3)
        .map((entry) => ({ slug: entry.slug, symbol: entry.symbol })),
    })),
    movers: assets
      .filter((asset) => asset.change24hPct !== null)
      .sort(
        (a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0),
      )
      .slice(0, 10)
      .map((asset) => ({
        slug: asset.slug,
        symbol: asset.symbol,
        price: asset.price,
        change24hPct: asset.change24hPct,
      })),
  };
};
