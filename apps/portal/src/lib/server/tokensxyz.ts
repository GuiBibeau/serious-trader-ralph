// Server-only tokens.xyz data layer for the distribution pages (landing,
// spotlights, news, OG cards, sitemap). Never import this from client code,
// and never import browser modules (spot.ts, polyfills) from here.
//
// Caching: per-lambda in-memory memoization with stale-on-error fallback so
// ISR revalidation storms and crawler bursts don't hammer the keyed API.

import { env } from "$env/dynamic/private";
// Reserved slugs (route collisions) — shared with the `[slug=slug]` param
// matcher so routing and slug assignment agree.
import { isAssetSlug, RESERVED_SLUGS as SLUG_DENYLIST } from "$lib/slugs";

const API = "https://api.tokens.xyz/v1";
const CATALOG_TTL_MS = 60_000;
const BUNDLE_TTL_MS = 60_000;
const NEWS_TTL_MS = 120_000;

function apiHeaders(): Record<string, string> {
  return { "x-api-key": env.TOKENS_XYZ_API_KEY ?? "" };
}

// ── Types ─────────────────────────────────────────────────────────────

export type CatalogAsset = {
  assetId: string;
  slug: string;
  symbol: string;
  name: string;
  imageUrl: string;
  category: string;
  /** crypto | equities | pre-ipo — our hub taxonomy. */
  hub: "crypto" | "equities" | "pre-ipo";
  mint: string;
  decimals: number;
  trustTier: string;
  price: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
};

export type AssetProfile = {
  allTimeHigh: number | null;
  allTimeHighDate: string | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  fdv: number | null;
};

export type AssetNewsItem = {
  title: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: number | null;
};

export type SpotlightBundle = {
  asset: CatalogAsset;
  profile: AssetProfile | null;
  description: string | null;
  news: AssetNewsItem[];
  /** False when the news block fell back to market-wide headlines. */
  newsIsAssetScoped: boolean;
  candles: { ts: number; close: number; volume: number }[];
  fetchedAt: number;
};

// ── Helpers ───────────────────────────────────────────────────────────

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match for a symbol/name token inside a headline. */
export function titleMatches(title: string, token: string): boolean {
  return new RegExp(
    `(^|[^a-z0-9])[$@#]?${escapeRegex(token.toLowerCase())}([^a-z0-9]|$)`,
    "i",
  ).test(title);
}

function slugify(symbol: string): string {
  return symbol
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

// Pre-IPO names aren't on public markets — used for the hub taxonomy.
const PRE_IPO_IDS = new Set([
  "spacex",
  "anthropic",
  "openai",
  "stripe",
  "epic-games",
  "kalshi",
  "anduril",
  "xai",
  "databricks",
  "ramp",
  "figure-ai",
  "perplexity",
]);

function hubFor(
  assetId: string,
  category: string,
  name: string,
): CatalogAsset["hub"] {
  // tokens.xyz labels private-company tokens "<Name> PreStocks".
  if (PRE_IPO_IDS.has(assetId) || /prestocks?/i.test(name)) return "pre-ipo";
  if (category === "crypto" || category === "stablecoin") return "crypto";
  // equity | etf | rwa | commodity → the stocks-and-markets hub.
  return "equities";
}

// ── Catalog (memoized) ───────────────────────────────────────────────

let catalogCache: { assets: CatalogAsset[]; at: number } | null = null;

export async function getCatalog(): Promise<CatalogAsset[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.assets;
  }
  try {
    const response = await fetch(`${API}/assets/curated`, {
      headers: apiHeaders(),
    });
    if (!response.ok) throw new Error(`tokensxyz-${response.status}`);
    const data = (await response.json()) as { assets?: unknown[] };
    const raw = Array.isArray(data.assets) ? data.assets.filter(isRecord) : [];

    const assets: CatalogAsset[] = [];
    const taken = new Set<string>(SLUG_DENYLIST);
    // Slug assignment runs in assetId order so a contested bare slug always
    // resolves to the same asset across refreshes and lambda instances —
    // live-volume ordering here would let slug ownership flip between
    // renders and poison the slug-keyed caches (ISR page, OG card, desk
    // read) with different assets' content.
    const ordered = raw
      .map((item) => ({ item, id: String(item.assetId ?? "") }))
      .filter(({ id }) => id)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const { item } of ordered) {
      const variant = isRecord(item.primaryVariant)
        ? item.primaryVariant
        : null;
      const stats = isRecord(item.stats) ? item.stats : {};
      const market = variant && isRecord(variant.market) ? variant.market : {};
      const mint = variant ? String(variant.mint ?? "") : "";
      const decimals = num(market.decimals);
      const assetId = String(item.assetId ?? "");
      const symbol = String(item.symbol ?? "");
      if (!mint || decimals === null || !assetId || !symbol) continue;

      let slug = slugify(symbol);
      if (!slug || taken.has(slug)) slug = slugify(assetId);
      if (!slug || taken.has(slug))
        slug = slugify(`${symbol}-${assetId.slice(0, 6)}`);
      // Every published slug must satisfy the [slug=slug] matcher, or the
      // links we emit (sitemap, llms.txt, hubs) would 404 at the router.
      if (!slug || taken.has(slug) || !isAssetSlug(slug)) continue;
      taken.add(slug);

      const category = String(item.category ?? "crypto");
      const rawName = String(item.name ?? symbol);
      assets.push({
        assetId,
        slug,
        symbol,
        // "Anthropic PreStocks" → "Anthropic" for display; hub keeps raw name.
        name: rawName.replace(/\s+PreStocks?$/i, ""),
        imageUrl: String(item.imageUrl ?? ""),
        category,
        hub: hubFor(assetId, category, rawName),
        mint,
        decimals,
        trustTier: variant ? String(variant.trustTier ?? "") : "",
        price: num(stats.price),
        change24hPct: num(stats.priceChange24hPercent),
        volume24hUsd: num(stats.volume24hUSD),
        marketCap: num(stats.marketCap),
        liquidityUsd: num(stats.liquidity),
      });
    }
    // Consumers expect volume order (tape, universe grid, FAQ rank gating).
    assets.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
    catalogCache = { assets, at: now };
    return assets;
  } catch (error) {
    if (catalogCache) return catalogCache.assets; // stale-on-error
    throw error;
  }
}

export async function findBySlug(slug: string): Promise<CatalogAsset | null> {
  const assets = await getCatalog();
  return assets.find((asset) => asset.slug === slug) ?? null;
}

export async function findByMint(mint: string): Promise<CatalogAsset | null> {
  const assets = await getCatalog();
  return assets.find((asset) => asset.mint === mint) ?? null;
}

// ── Per-asset spotlight bundle (memoized) ────────────────────────────

const bundleCache = new Map<string, SpotlightBundle>();

export async function getSpotlightBundle(
  asset: CatalogAsset,
): Promise<SpotlightBundle> {
  const cached = bundleCache.get(asset.assetId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < BUNDLE_TTL_MS) return cached;

  const to = Math.floor(now / 1000);
  const [profileRes, descriptionRes, ohlcvRes, feed] = await Promise.all([
    fetch(`${API}/assets/${asset.assetId}/profile`, {
      headers: apiHeaders(),
    }).catch(() => null),
    fetch(`${API}/assets/${asset.assetId}/description`, {
      headers: apiHeaders(),
    }).catch(() => null),
    fetch(
      `${API}/assets/${asset.assetId}/ohlcv?interval=15m&from=${to - 7 * 86_400}&to=${to}`,
      { headers: apiHeaders() },
    ).catch(() => null),
    // The feed endpoint ignores per-asset filters — pull the (cached) global
    // feed and keyword-match below.
    getNewsFeed(60).catch(() => [] as AssetNewsItem[]),
  ]);

  const json = async (response: Response | null) =>
    response?.ok
      ? ((await response.json().catch(() => null)) as unknown)
      : null;

  const profileRaw = await json(profileRes);
  const descriptionRaw = await json(descriptionRes);
  const ohlcvRaw = await json(ohlcvRes);

  let profile: AssetProfile | null = null;
  if (isRecord(profileRaw) && isRecord(profileRaw.profile)) {
    const data = isRecord(profileRaw.profile.data)
      ? profileRaw.profile.data
      : profileRaw.profile;
    profile = {
      allTimeHigh: num(data.allTimeHigh),
      allTimeHighDate:
        typeof data.allTimeHighDate === "string" ? data.allTimeHighDate : null,
      circulatingSupply: num(data.circulatingSupply),
      totalSupply: num(data.totalSupply),
      fdv: num(data.fdv),
    };
  }

  let description: string | null = null;
  if (isRecord(descriptionRaw)) {
    const value =
      descriptionRaw.description ??
      (isRecord(descriptionRaw.data) ? descriptionRaw.data.description : null);
    if (typeof value === "string" && value.trim()) description = value.trim();
  }

  // Asset-scoped news: keyword-match the global feed on symbol/name. The
  // page treats matches as "About {asset}" and falls back to market-wide
  // headlines (labelled as such) when nothing matches.
  // Both checks are word-bounded and regex-escaped: a raw substring test
  // makes "ondo" match "London", and an unescaped symbol with regex
  // metacharacters would throw and 500 every consumer of this bundle.
  const matches = (title: string) =>
    titleMatches(title, asset.name) || titleMatches(title, asset.symbol);
  const scoped = feed.filter((item) => matches(item.title));
  const news = (scoped.length > 0 ? scoped : feed).slice(0, 8);
  const newsIsAssetScoped = scoped.length > 0;

  const candles: SpotlightBundle["candles"] = [];
  if (isRecord(ohlcvRaw) && Array.isArray(ohlcvRaw.candles)) {
    for (const candle of ohlcvRaw.candles.filter(isRecord)) {
      const ts = num(candle.time);
      const close = num(candle.close);
      if (ts === null || close === null || close <= 0) continue;
      candles.push({ ts: ts * 1000, close, volume: num(candle.volume) ?? 0 });
    }
    candles.sort((a, b) => a.ts - b.ts);
  }

  const bundle: SpotlightBundle = {
    asset,
    profile,
    description,
    news,
    newsIsAssetScoped,
    candles,
    fetchedAt: now,
  };
  bundleCache.set(asset.assetId, bundle);
  return bundle;
}

// ── Global news feed (memoized) ──────────────────────────────────────

let newsCache: { items: AssetNewsItem[]; at: number } | null = null;

// Always fetch the full window upstream and slice per caller — the cache is
// shared, so a small fetch (landing wants 12) must not starve the big
// consumers (/news and spotlight matching want 60) for the whole TTL.
const NEWS_FETCH_LIMIT = 60;

export async function getNewsFeed(limit = 40): Promise<AssetNewsItem[]> {
  const now = Date.now();
  if (newsCache && now - newsCache.at < NEWS_TTL_MS) {
    return newsCache.items.slice(0, limit);
  }
  try {
    const response = await fetch(`${API}/news/feed?limit=${NEWS_FETCH_LIMIT}`, {
      headers: apiHeaders(),
    });
    if (!response.ok) throw new Error(`tokensxyz-news-${response.status}`);
    const data = (await response.json()) as { items?: unknown[] };
    const items: AssetNewsItem[] = [];
    const seenUrls = new Set<string>(); // syndicated feeds repeat URLs; keyed {#each} blocks throw on dupes
    for (const item of (data.items ?? []).filter(isRecord)) {
      const title = String(item.title ?? "").trim();
      const url = String(item.url ?? "").trim();
      if (!title || !url) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      // Drop "headlines" that are just a bare link (raw tweet URLs).
      if (/^https?:\/\/\S+$/i.test(title)) continue;
      let source = "news";
      try {
        source = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // keep default
      }
      items.push({
        title,
        url,
        image: typeof item.image === "string" ? item.image : null,
        source,
        publishedAt: num(item.publishedAt ?? item.timestamp),
      });
    }
    newsCache = { items, at: now };
    return items.slice(0, limit);
  } catch (error) {
    if (newsCache) return newsCache.items.slice(0, limit);
    throw error;
  }
}

// ── Today's pulse (deterministic, zero-LLM) ──────────────────────────

export function computePulse(bundle: SpotlightBundle): string[] {
  const pulse: string[] = [];
  const { asset, profile, candles, news } = bundle;

  if (asset.change24hPct !== null) {
    pulse.push(
      `${asset.change24hPct >= 0 ? "Up" : "Down"} ${Math.abs(asset.change24hPct).toFixed(2)}% over the last 24 hours`,
    );
  }
  if (asset.price !== null && profile?.allTimeHigh) {
    const drawdown =
      ((profile.allTimeHigh - asset.price) / profile.allTimeHigh) * 100;
    pulse.push(
      drawdown <= 1
        ? `Trading at its all-time high of $${profile.allTimeHigh.toLocaleString()}`
        : `${drawdown.toFixed(1)}% below the all-time high of $${profile.allTimeHigh.toLocaleString()}`,
    );
  }
  if (candles.length > 100) {
    const recent = candles.slice(-96); // last 24h of 15m bars
    const prior = candles.slice(0, -96);
    const recentVol = recent.reduce((sum, candle) => sum + candle.volume, 0);
    const priorAvg =
      (prior.reduce((sum, candle) => sum + candle.volume, 0) / prior.length) *
      96;
    if (priorAvg > 0) {
      const ratio = recentVol / priorAvg;
      pulse.push(`Volume running ${ratio.toFixed(1)}x the 7-day average`);
    }
  }
  if (news.length > 0) {
    pulse.push(
      `${news.length} fresh headline${news.length === 1 ? "" : "s"} in the feed`,
    );
  }
  return pulse;
}
