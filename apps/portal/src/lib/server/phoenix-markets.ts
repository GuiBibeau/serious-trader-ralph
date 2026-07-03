// Which symbols have a live Phoenix perp market — gates the Long/Short CTAs
// on spotlight pages. Memoized with stale-on-error plus a static fallback so
// the pages render even if the exchange API is down.

const PHOENIX_API = "https://perp-api.phoenix.trade";
const TTL_MS = 10 * 60_000;

// Snapshot 2026-06; only used when the live fetch fails with a cold cache.
const FALLBACK = [
  "NVDA",
  "ONDO",
  "WTIOIL",
  "TAO",
  "SUI",
  "TON",
  "FET",
  "ETH",
  "SOL",
  "ZEC",
  "TRX",
  "ADA",
  "JUP",
  "BNB",
  "GOLD",
  "AAVE",
  "MEGA",
  "DOGE",
  "SKR",
  "COPPER",
  "XRP",
  "MET",
  "JTO",
  "VVV",
  "SILVER",
  "BTC",
  "CHIP",
  "AAPL",
  "RENDER",
  "WLD",
  "VIRTUAL",
  "HYPE",
  "XLM",
  "XPL",
  "FARTCOIN",
  "NEAR",
  "MORPHO",
  "ENA",
  "MON",
  "PUMP",
  "LIT",
];

let cache: { symbols: Set<string>; at: number } | null = null;

export async function getPerpSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.symbols;
  try {
    const response = await fetch(`${PHOENIX_API}/exchange`);
    if (!response.ok) throw new Error(`phoenix-${response.status}`);
    const data = (await response.json()) as { markets?: { symbol?: string }[] };
    const symbols = new Set(
      (data.markets ?? [])
        .map((market) => String(market.symbol ?? "").toUpperCase())
        .filter(Boolean),
    );
    if (symbols.size === 0) throw new Error("phoenix-empty");
    cache = { symbols, at: now };
    return symbols;
  } catch {
    if (cache) return cache.symbols;
    return new Set(FALLBACK);
  }
}
