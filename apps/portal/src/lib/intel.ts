// Free, keyless intelligence feeds (Crucix-inspired): Yahoo Finance macro
// quotes, GDELT event/news stream, and an OFAC sanctioned-address screen.
// Fetches route through same-origin dev proxies (see vite.config.ts) to dodge
// CORS; the OFAC list is fetched directly (raw GitHub sends CORS headers).

import type { DataPanel, DataRow, RowTone } from "./edge-data";

type YahooQuote = {
  price: number | null;
  prevClose: number | null;
  changePct: number | null;
};

export type NewsItem = {
  title: string;
  url: string;
  domain: string;
  seenMs: number;
};

const quoteCache = new Map<string, { quote: YahooQuote; at: number }>();
const QUOTE_TTL_MS = 30_000;

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function signedPct(value: number | null): string | undefined {
  if (value === null) return undefined;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneFromChange(value: number | null): RowTone {
  if (value === null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

async function yahooQuote(symbol: string, nowMs: number): Promise<YahooQuote> {
  const cached = quoteCache.get(symbol);
  if (cached && nowMs - cached.at < QUOTE_TTL_MS) return cached.quote;
  const response = await fetch(
    `/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
  );
  if (!response.ok) throw new Error(`yahoo-${response.status}`);
  const data = (await response.json()) as {
    chart?: { result?: { meta?: Record<string, unknown> }[] };
  };
  const meta = data.chart?.result?.[0]?.meta ?? {};
  const price = num(meta.regularMarketPrice);
  const prevClose = num(meta.chartPreviousClose ?? meta.previousClose);
  const changePct =
    price !== null && prevClose
      ? ((price - prevClose) / prevClose) * 100
      : null;
  const quote = { price, prevClose, changePct };
  quoteCache.set(symbol, { quote, at: nowMs });
  return quote;
}

async function yahooQuotes(
  symbols: string[],
  nowMs: number,
): Promise<Record<string, YahooQuote>> {
  const out: Record<string, YahooQuote> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        out[symbol] = await yahooQuote(symbol, nowMs);
      } catch {
        // leave missing — caller renders "--"
      }
    }),
  );
  return out;
}

function quoteRow(
  label: string,
  quote: YahooQuote | undefined,
  decimals: number,
  suffix = "",
): DataRow {
  if (!quote || quote.price === null) {
    return { label, value: "--", status: "no data", tone: "flat" };
  }
  return {
    label,
    value: `${quote.price.toFixed(decimals)}${suffix}`,
    status: signedPct(quote.changePct) ? "24h" : "—",
    change: signedPct(quote.changePct),
    tone: toneFromChange(quote.changePct),
  };
}

export async function fetchRatesPanel(nowMs: number): Promise<DataPanel> {
  const symbols = ["^TNX", "^TYX", "DX-Y.NYB", "^VIX", "^GSPC", "BTC-USD"];
  try {
    const q = await yahooQuotes(symbols, nowMs);
    const rows: DataRow[] = [
      quoteRow("US 10Y", q["^TNX"], 2, "%"),
      quoteRow("US 30Y", q["^TYX"], 2, "%"),
      quoteRow("DXY", q["DX-Y.NYB"], 2),
      quoteRow("VIX", q["^VIX"], 2),
      quoteRow("S&P 500", q["^GSPC"], 0),
      quoteRow("BTC", q["BTC-USD"], 0),
    ];
    const vix = q["^VIX"]?.price ?? null;
    return {
      rows,
      status: "ready",
      source: "Yahoo Finance",
      summary: riskRegime(vix),
    };
  } catch (error) {
    return feedError(error);
  }
}

export async function fetchOilPanel(nowMs: number): Promise<DataPanel> {
  const symbols = ["CL=F", "BZ=F", "GC=F"];
  try {
    const q = await yahooQuotes(symbols, nowMs);
    const wti = q["CL=F"]?.price ?? null;
    const brent = q["BZ=F"]?.price ?? null;
    const rows: DataRow[] = [
      quoteRow("WTI Crude", q["CL=F"], 2, ""),
      quoteRow("Brent", q["BZ=F"], 2, ""),
      quoteRow("Gold", q["GC=F"], 1, ""),
    ];
    if (wti !== null && brent !== null) {
      rows.push({
        label: "Brent-WTI",
        value: `$${(brent - wti).toFixed(2)}`,
        status: "spread",
        tone: "flat",
      });
    }
    const wtiChange = q["CL=F"]?.changePct ?? null;
    return {
      rows,
      status: "ready",
      source: "Yahoo Finance",
      summary:
        wtiChange === null
          ? undefined
          : {
              label: `WTI ${wtiChange >= 0 ? "bid" : "soft"}`,
              tone: toneFromChange(wtiChange),
            },
    };
  } catch (error) {
    return feedError(error);
  }
}

function riskRegime(vix: number | null): DataPanel["summary"] {
  if (vix === null) return undefined;
  if (vix >= 25)
    return { label: `RISK-OFF · VIX ${vix.toFixed(1)}`, tone: "down" };
  if (vix >= 20)
    return { label: `CAUTION · VIX ${vix.toFixed(1)}`, tone: "warn" };
  if (vix >= 16)
    return { label: `NEUTRAL · VIX ${vix.toFixed(1)}`, tone: "flat" };
  return { label: `RISK-ON · VIX ${vix.toFixed(1)}`, tone: "up" };
}

function feedError(error: unknown): DataPanel {
  const message = error instanceof Error ? error.message : "feed-error";
  return {
    rows: [{ label: "Status", value: "Feed unavailable", status: message }],
    status: "not connected",
    source: "",
  };
}

let gdeltCache: { items: NewsItem[]; at: number } | null = null;
const GDELT_TTL_MS = 60_000;
const GDELT_QUERY =
  '(bitcoin OR solana OR ethereum OR crypto OR "federal reserve" OR "interest rate" OR ETF OR sanctions OR stablecoin) sourcelang:english';

export async function fetchNews(nowMs: number): Promise<NewsItem[]> {
  if (gdeltCache && nowMs - gdeltCache.at < GDELT_TTL_MS)
    return gdeltCache.items;
  const params = new URLSearchParams({
    query: GDELT_QUERY,
    mode: "artlist",
    maxrecords: "20",
    format: "json",
    sort: "datedesc",
  });
  try {
    const response = await fetch(`/gdelt/api/v2/doc/doc?${params}`);
    if (!response.ok) throw new Error(`gdelt-${response.status}`);
    const data = (await response.json()) as {
      articles?: {
        title?: string;
        url?: string;
        domain?: string;
        seendate?: string;
      }[];
    };
    const items: NewsItem[] = (data.articles ?? [])
      .filter((article) => article.title && article.url)
      .map((article) => ({
        title: String(article.title),
        url: String(article.url),
        domain: String(article.domain ?? "").replace(/^www\./, ""),
        seenMs: parseGdeltDate(article.seendate),
      }));
    if (items.length >= 3) {
      gdeltCache = { items, at: nowMs };
      return items;
    }
    throw new Error("gdelt-empty");
  } catch (_gdeltError) {
    // GDELT rate-limits aggressively; fall back to a reliable keyless source.
    try {
      const hn = await fetchHackerNews();
      if (hn.length > 0) {
        gdeltCache = { items: hn, at: nowMs };
        return hn;
      }
    } catch {
      // ignore — fall through to last-good
    }
    if (gdeltCache) return gdeltCache.items;
    return [];
  }
}

async function fetchHackerNews(): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    query: "crypto OR solana OR bitcoin OR ethereum OR stablecoin OR ETF",
    tags: "story",
    hitsPerPage: "20",
  });
  const response = await fetch(
    `https://hn.algolia.com/api/v1/search_by_date?${params}`,
  );
  if (!response.ok) throw new Error(`hn-${response.status}`);
  const data = (await response.json()) as {
    hits?: { title?: string; url?: string; created_at_i?: number }[];
  };
  return (data.hits ?? [])
    .filter((hit) => hit.title && hit.url)
    .map((hit) => {
      let domain = "news.ycombinator.com";
      try {
        domain = new URL(String(hit.url)).hostname.replace(/^www\./, "");
      } catch {
        // keep default
      }
      return {
        title: String(hit.title),
        url: String(hit.url),
        domain,
        seenMs: (hit.created_at_i ?? 0) * 1000,
      };
    });
}

function parseGdeltDate(value: unknown): number {
  // Format: YYYYMMDDTHHMMSSZ
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return 0;
  const [, y, mo, d, h, mi, s] = match;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

let ofacSolList: Set<string> | null = null;

export async function screenSolanaAddress(
  address: string,
): Promise<{ flagged: boolean; checked: boolean }> {
  const wallet = address.trim();
  if (!wallet) return { flagged: false, checked: false };
  if (!ofacSolList) {
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt",
      );
      if (!response.ok) throw new Error(`ofac-${response.status}`);
      const text = await response.text();
      ofacSolList = new Set(
        text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch {
      ofacSolList = null;
      return { flagged: false, checked: false };
    }
  }
  return { flagged: ofacSolList.has(wallet), checked: true };
}
