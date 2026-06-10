import { error } from "@sveltejs/kit";
import { getCatalog, getNewsFeed } from "$lib/server/tokensxyz";
import type { PageServerLoad } from "./$types";

// ISR: the landing re-renders at most every 5 minutes.
export const config = { isr: { expiration: 300 } };

export const load: PageServerLoad = async () => {
  const [assets, news, vix] = await Promise.all([
    // 503 instead of catching to [] — ISR would pin an empty landing for the
    // full window, while 5xx responses are never cached.
    getCatalog().catch(() => {
      error(503, "Market data unavailable");
    }),
    getNewsFeed(12).catch(() => []),
    fetchVix(),
  ]);

  return {
    generatedAt: Date.now(),
    vix,
    marketCount: assets.length, // the real number — never "60+"
    tape: assets.slice(0, 40).map(slim),
    universe: assets.slice(0, 60).map(slim),
    directory: assets.map((asset) => ({
      slug: asset.slug,
      symbol: asset.symbol,
      hub: asset.hub,
    })),
    news: news.slice(0, 6),
  };
};

function slim(asset: Awaited<ReturnType<typeof getCatalog>>[number]) {
  return {
    slug: asset.slug,
    symbol: asset.symbol,
    name: asset.name,
    imageUrl: asset.imageUrl,
    hub: asset.hub,
    price: asset.price,
    change24hPct: asset.change24hPct,
    volume24hUsd: asset.volume24hUsd,
  };
}

async function fetchVix(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=2d",
      { headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
    };
    const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}
