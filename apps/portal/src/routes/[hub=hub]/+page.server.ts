import { error } from "@sveltejs/kit";
import { getCatalog } from "$lib/server/tokensxyz";
import type { PageServerLoad } from "./$types";

// ISR: hub indexes re-render at most every 2 minutes.
export const config = { isr: { expiration: 120 } };

const COPY = {
  equities: {
    title: "Tokenized stocks",
    blurb:
      "NVDA, TSLA, SPY and more, tokenized on Solana. Trade them 24/7 with USDC. No brokerage account.",
  },
  "pre-ipo": {
    title: "Pre-IPO markets",
    blurb:
      "Price exposure to SpaceX, Anthropic, OpenAI and other private names before they list. Tokenized, tradable around the clock.",
  },
  crypto: {
    title: "Crypto majors",
    blurb:
      "SOL, BTC, ETH and the rest of the onchain universe. Spot via Jupiter, perps on Phoenix, settled in USDC.",
  },
} as const;

export const load: PageServerLoad = async ({ params }) => {
  const hub = params.hub as keyof typeof COPY;
  // 503 instead of caching an empty hub table for the ISR window.
  const assets = await getCatalog().catch(() => {
    error(503, "Market data unavailable");
  });
  return {
    hub,
    ...COPY[hub],
    generatedAt: Date.now(),
    assets: assets
      .filter((asset) => asset.hub === hub)
      .map((asset) => ({
        slug: asset.slug,
        symbol: asset.symbol,
        name: asset.name,
        imageUrl: asset.imageUrl,
        price: asset.price,
        change24hPct: asset.change24hPct,
        volume24hUsd: asset.volume24hUsd,
        marketCap: asset.marketCap,
      })),
  };
};
