import { error } from "@sveltejs/kit";
import { getPerpSymbols } from "$lib/server/phoenix-markets";
import {
  computePulse,
  findBySlug,
  getCatalog,
  getSpotlightBundle,
} from "$lib/server/tokensxyz";
import type { PageServerLoad } from "./$types";

// ISR: spotlight pages re-render at most once a minute.
export const config = { isr: { expiration: 60 } };

export const load: PageServerLoad = async ({ params }) => {
  const asset = await findBySlug(params.slug);
  if (!asset) error(404, "Unknown asset");

  const [bundle, perpSymbols, catalog] = await Promise.all([
    getSpotlightBundle(asset),
    getPerpSymbols().catch(() => new Set<string>()),
    getCatalog(),
  ]);

  // Catalog is volume-ordered; only the liquid top gets the FAQ block.
  const rank = catalog.findIndex((entry) => entry.assetId === asset.assetId);
  const related = catalog
    .filter(
      (entry) =>
        entry.hub === asset.hub &&
        entry.assetId !== asset.assetId &&
        // Stablecoins/fiat pegs aren't interesting "more to trade" picks.
        entry.category !== "stablecoin",
    )
    .slice(0, 8)
    .map((entry) => ({
      slug: entry.slug,
      symbol: entry.symbol,
      name: entry.name,
      imageUrl: entry.imageUrl,
      price: entry.price,
      change24hPct: entry.change24hPct,
    }));

  // 15m closes → a light sparkline payload (~96 points for 7 days).
  const step = Math.max(1, Math.floor(bundle.candles.length / 96));
  const spark = bundle.candles
    .filter((_, index) => index % step === 0)
    .map((candle) => ({ ts: candle.ts, close: candle.close }));

  return {
    asset,
    profile: bundle.profile,
    description: bundle.description,
    news: bundle.news,
    newsIsAssetScoped: bundle.newsIsAssetScoped,
    spark,
    pulse: computePulse(bundle),
    hasPerp: perpSymbols.has(asset.symbol.toUpperCase()),
    showFaq: asset.hub !== "crypto" && rank >= 0 && rank < 40,
    related,
    generatedAt: Date.now(),
  };
};
