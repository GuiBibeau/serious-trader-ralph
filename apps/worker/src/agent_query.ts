const MAX_QUERY_LENGTH = 512;

const ENDPOINT_INDEX = [
  {
    id: "market_snapshot",
    path: "/x402/read/market_snapshot",
    reason: "Wallet-level spot valuation snapshot.",
    keywords: ["snapshot", "wallet", "portfolio", "allocation", "balance"],
  },
  {
    id: "market_snapshot_v2",
    path: "/x402/read/market_snapshot_v2",
    reason: "Snapshot with tracked per-mint balances.",
    keywords: ["tracked", "mint", "holdings", "balances"],
  },
  {
    id: "market_jupiter_quote",
    path: "/x402/read/market_jupiter_quote",
    reason: "Single swap quote and price impact.",
    keywords: ["quote", "swap", "price", "route", "slippage"],
  },
  {
    id: "market_jupiter_quote_batch",
    path: "/x402/read/market_jupiter_quote_batch",
    reason: "Batch swap quoting for multiple requests.",
    keywords: ["batch", "quotes", "bulk", "multi"],
  },
  {
    id: "market_ohlcv",
    path: "/x402/read/market_ohlcv",
    reason: "Historical OHLCV bars for supported pairs.",
    keywords: ["ohlcv", "candles", "history", "historical", "bars"],
  },
  {
    id: "market_indicators",
    path: "/x402/read/market_indicators",
    reason: "Derived market indicators (EMA/RSI/MACD).",
    keywords: ["indicators", "rsi", "ema", "macd", "trend"],
  },
  {
    id: "solana_marks_latest",
    path: "/x402/read/solana_marks_latest",
    reason: "Latest Loop A marks.",
    keywords: ["marks", "loop a", "mark engine", "slot"],
  },
  {
    id: "solana_scores_latest",
    path: "/x402/read/solana_scores_latest",
    reason: "Latest Loop B scoring output.",
    keywords: ["scores", "scoring", "loop b", "alpha"],
  },
  {
    id: "solana_views_top",
    path: "/x402/read/solana_views_top",
    reason: "Top movers, liquidity stress, and anomalies.",
    keywords: ["top", "movers", "anomaly", "liquidity", "stress"],
  },
  {
    id: "macro_signals",
    path: "/x402/read/macro_signals",
    reason: "Top-level macro regime and signal verdict.",
    keywords: ["macro", "signals", "risk on", "risk off", "regime"],
  },
  {
    id: "macro_fred_indicators",
    path: "/x402/read/macro_fred_indicators",
    reason: "FRED series and observation changes.",
    keywords: ["fred", "rates", "unemployment", "series", "economics"],
  },
  {
    id: "macro_etf_flows",
    path: "/x402/read/macro_etf_flows",
    reason: "ETF flow and volume analytics.",
    keywords: ["etf", "flows", "inflow", "outflow", "volume"],
  },
  {
    id: "macro_stablecoin_health",
    path: "/x402/read/macro_stablecoin_health",
    reason: "Stablecoin peg and system health analytics.",
    keywords: ["stablecoin", "peg", "usdc", "usdt", "health"],
  },
  {
    id: "macro_oil_analytics",
    path: "/x402/read/macro_oil_analytics",
    reason: "Oil and energy macro analytics.",
    keywords: ["oil", "wti", "brent", "energy", "eia"],
  },
  {
    id: "perps_funding_surface",
    path: "/x402/read/perps_funding_surface",
    reason: "Cross-venue funding rate surface.",
    keywords: ["perps", "funding", "funding rate", "surface", "basis"],
  },
  {
    id: "perps_open_interest_surface",
    path: "/x402/read/perps_open_interest_surface",
    reason: "Open interest distribution across venues.",
    keywords: ["open interest", "oi", "perps", "venue", "dominance"],
  },
  {
    id: "perps_venue_score",
    path: "/x402/read/perps_venue_score",
    reason: "Venue-level scorecard for perps execution context.",
    keywords: ["venue score", "exchange", "hyperliquid", "dydx", "ranking"],
  },
] as const;

type SuggestedEndpoint = {
  id: string;
  path: string;
  runtimePath: string;
  url: string;
  reason: string;
};

type AgentQueryResponse = {
  ok: true;
  query: string;
  answer: string;
  suggestedEndpoints: SuggestedEndpoint[];
  discovery: {
    html: string;
    json: string;
    text: string;
    llms: string;
    skills: string;
    openapi: string;
    metadata: string;
  };
};

function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function runtimePath(path: string): string {
  return path.startsWith("/api/") ? path : `/api${path}`;
}

function discovery(baseUrl: string) {
  return {
    html: `${baseUrl}/api`,
    json: `${baseUrl}/endpoints.json`,
    text: `${baseUrl}/endpoints.txt`,
    llms: `${baseUrl}/llms.txt`,
    skills: `${baseUrl}/dev-skills.txt`,
    openapi: `${baseUrl}/openapi.json`,
    metadata: `${baseUrl}/agent-registry/metadata.json`,
  };
}

function pickSuggestions(query: string, baseUrl: string): SuggestedEndpoint[] {
  if (!query) {
    return ENDPOINT_INDEX.slice(0, 3).map((item) => ({
      id: item.id,
      path: item.path,
      runtimePath: runtimePath(item.path),
      url: `${baseUrl}${runtimePath(item.path)}`,
      reason: item.reason,
    }));
  }

  const q = query.toLowerCase();
  const matched = ENDPOINT_INDEX.filter((item) =>
    item.keywords.some((keyword) => q.includes(keyword)),
  );
  const selected = (
    matched.length > 0 ? matched : ENDPOINT_INDEX.slice(0, 3)
  ).slice(0, 5);

  return selected.map((item) => ({
    id: item.id,
    path: item.path,
    runtimePath: runtimePath(item.path),
    url: `${baseUrl}${runtimePath(item.path)}`,
    reason: item.reason,
  }));
}

function answerForQuery(query: string): string {
  if (!query) {
    return "Trader Ralph exposes public discovery docs plus x402 paid read endpoints for market, macro, loop, and perps intelligence.";
  }

  if (/(perps|funding|open interest|oi|venue)/i.test(query)) {
    return "Use the perps endpoints for cross-venue funding, open-interest, and venue scoring analytics.";
  }
  if (/(macro|fred|etf|stablecoin|oil|regime)/i.test(query)) {
    return "Use macro endpoints for regime signals, FRED indicators, ETF flows, stablecoin health, and oil analytics.";
  }
  if (/(loop|marks|scores|views|anomaly|stress)/i.test(query)) {
    return "Use loop endpoints for latest marks, scores, and top market views.";
  }
  if (/(quote|swap|ohlcv|indicator|snapshot|wallet|portfolio)/i.test(query)) {
    return "Use market endpoints for wallet snapshots, Jupiter quotes, OHLCV history, and derived indicators.";
  }
  return "Query matched Trader Ralph public intelligence capabilities. Suggested endpoints below are the best-fit public routes.";
}

export function buildAgentQueryResponse(
  rawQuery: unknown,
  requestUrl: URL,
): AgentQueryResponse {
  const query = normalizeQuery(rawQuery);
  const baseUrl = removeTrailingSlash(requestUrl.origin);
  return {
    ok: true,
    query,
    answer: answerForQuery(query),
    suggestedEndpoints: pickSuggestions(query, baseUrl),
    discovery: discovery(baseUrl),
  };
}
