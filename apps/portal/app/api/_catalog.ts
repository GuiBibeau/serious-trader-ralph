import {
  SUPPORTED_PAIRS,
  TOKEN_CONFIGS,
} from "../terminal/components/trade-pairs";

export type FieldSpec = {
  name: string;
  type: string;
  description: string;
};

export type X402EndpointSpec = {
  id: string;
  method: "POST";
  path: string;
  summary: string;
  access: "public-x402-paid";
  requiredFields: FieldSpec[];
  optionalFields: FieldSpec[];
  requestExample: Record<string, unknown>;
  responseExample: Record<string, unknown>;
};

export type CatalogDoc = {
  name: string;
  version: string;
  basePath: string;
  supportedTrading: {
    tokens: Array<{
      symbol: string;
      mint: string;
      decimals: number;
    }>;
    pairs: Array<{
      id: string;
      baseSymbol: string;
      quoteSymbol: string;
      baseMint: string;
      quoteMint: string;
    }>;
  };
  auth: {
    type: "x402";
    requestHeader: "payment-signature";
    paymentRequiredHeader: "payment-required";
    paymentResponseHeader: "payment-response";
  };
  overview: {
    offering: string;
    scope: string;
    notes: string[];
  };
  endpoints: X402EndpointSpec[];
};

export const X402_CATALOG_VERSION = "2026-02-28";

const X402_SUPPORTED_TRADING_TOKENS = Object.values(TOKEN_CONFIGS).map(
  (token) => ({
    symbol: token.symbol,
    mint: token.mint,
    decimals: token.decimals,
  }),
);

const X402_SUPPORTED_TRADING_PAIRS = SUPPORTED_PAIRS.map((pair) => ({
  id: pair.id,
  baseSymbol: pair.baseSymbol,
  quoteSymbol: pair.quoteSymbol,
  baseMint: TOKEN_CONFIGS[pair.baseSymbol].mint,
  quoteMint: TOKEN_CONFIGS[pair.quoteSymbol].mint,
}));

export const X402_SUPPORTED_TRADING: CatalogDoc["supportedTrading"] = {
  tokens: X402_SUPPORTED_TRADING_TOKENS,
  pairs: X402_SUPPORTED_TRADING_PAIRS,
};

const X402_SUPPORTED_MINTS = X402_SUPPORTED_TRADING.tokens.map(
  (token) => token.mint,
);
const X402_SUPPORTED_PAIR_IDS = X402_SUPPORTED_TRADING.pairs.map(
  (pair) => pair.id,
);

export const X402_OVERVIEW: CatalogDoc["overview"] = {
  offering:
    "Solana-focused x402 read endpoints for market, macro, and cross-venue perps intelligence.",
  scope:
    "This catalog includes only publicly callable x402 routes under /api/x402/read/*.",
  notes: [
    "Catalog and discovery endpoints are public. The listed x402 routes require payment authorization.",
    "payment-signature must be a valid on-chain Solana transaction signature that settles the required amount to payTo.",
    "Environment policy: dev expects devnet USDC; staging and production expect mainnet USDC.",
    "Supported terminal trading universe (tokens and pair presets) is included under supportedTrading.",
    "Pricing is dynamic per route config. Read the payment-required header (HTTP 402) as source of truth.",
    "Authenticated account and trading routes are intentionally excluded from this catalog.",
  ],
};

export const X402_PAYMENT_REQUIRED_RESPONSE_EXAMPLE: Record<string, unknown> = {
  ok: false,
  error: "payment-required",
  paymentRequired: {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "solana-mainnet",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "25000",
        payTo: "MerchantWalletAddress",
        maxTimeoutSeconds: 60,
        extra: {
          route: "market_snapshot",
          priceUsd: "0.025",
        },
      },
    ],
    resource: {
      uri: "/api/x402/read/market_snapshot",
      method: "POST",
    },
  },
};

export const X402_ENDPOINTS: X402EndpointSpec[] = [
  {
    id: "market_snapshot",
    method: "POST",
    path: "/api/x402/read/market_snapshot",
    summary: "Point-in-time market/account snapshot with valuation context.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "walletAddress",
        type: "string",
        description: "Wallet public key to evaluate.",
      },
    ],
    optionalFields: [
      {
        name: "quoteMint",
        type: "string",
        description: "Quote asset mint used for valuation context.",
      },
      {
        name: "quoteDecimals",
        type: "number",
        description: "Quote asset decimals when quoteMint is custom.",
      },
    ],
    requestExample: {
      walletAddress: "YourWalletAddress",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      quoteDecimals: 6,
    },
    responseExample: {
      ok: true,
      snapshot: {
        ts: "2026-02-20T19:32:00.000Z",
        baseMint: "So11111111111111111111111111111111111111112",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        quoteDecimals: 6,
        baseBalanceAtomic: "1250000000",
        quoteBalanceAtomic: "42000000",
        basePriceQuote: "145.23",
        portfolioValueQuote: "223.54",
        baseAllocationPct: 81.1,
      },
    },
  },
  {
    id: "market_snapshot_v2",
    method: "POST",
    path: "/api/x402/read/market_snapshot_v2",
    summary:
      "Extended snapshot including per-mint balances for tracked assets.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "walletAddress",
        type: "string",
        description: "Wallet public key to evaluate.",
      },
    ],
    optionalFields: [
      {
        name: "quoteMint",
        type: "string",
        description: "Quote asset mint used for valuation context.",
      },
      {
        name: "quoteDecimals",
        type: "number",
        description: "Quote asset decimals when quoteMint is custom.",
      },
      {
        name: "trackedMints",
        type: "string[]",
        description: "Additional mints to include in the balances section.",
      },
    ],
    requestExample: {
      walletAddress: "YourWalletAddress",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      trackedMints: [
        "So11111111111111111111111111111111111111112",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ],
    },
    responseExample: {
      ok: true,
      snapshot: {
        ts: "2026-02-20T19:32:00.000Z",
        baseMint: "So11111111111111111111111111111111111111112",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        quoteDecimals: 6,
        baseBalanceAtomic: "1250000000",
        quoteBalanceAtomic: "42000000",
        basePriceQuote: "145.23",
        portfolioValueQuote: "223.54",
        baseAllocationPct: 81.1,
      },
      balances: [
        {
          mint: "So11111111111111111111111111111111111111112",
          balanceAtomic: "1250000000",
        },
        {
          mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          balanceAtomic: "42000000",
        },
      ],
    },
  },
  {
    id: "market_token_balance",
    method: "POST",
    path: "/api/x402/read/market_token_balance",
    summary: "Token balance lookup for one wallet and one mint.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "walletAddress",
        type: "string",
        description: "Wallet public key to inspect.",
      },
      {
        name: "mint",
        type: "string",
        description: "Token mint to query (SOL mint supported).",
      },
    ],
    optionalFields: [],
    requestExample: {
      walletAddress: "YourWalletAddress",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    responseExample: {
      ok: true,
      balance: {
        walletAddress: "YourWalletAddress",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        balanceAtomic: "42000000",
        ts: "2026-02-20T19:32:00.000Z",
      },
    },
  },
  {
    id: "market_jupiter_quote",
    method: "POST",
    path: "/api/x402/read/market_jupiter_quote",
    summary:
      "Single Jupiter quote for exact-in swap sizing across the supported trading universe.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "inputMint",
        type: "string",
        description: "Input token mint from supportedTrading.tokens.",
      },
      {
        name: "outputMint",
        type: "string",
        description: "Output token mint from supportedTrading.tokens.",
      },
      {
        name: "amount",
        type: "string",
        description: "Input amount in atomic units.",
      },
    ],
    optionalFields: [
      {
        name: "slippageBps",
        type: "number",
        description: "Requested slippage in basis points.",
      },
    ],
    requestExample: {
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      amount: "100000000",
      slippageBps: 50,
    },
    responseExample: {
      ok: true,
      quote: {
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        outputMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        inAmount: "100000000",
        outAmount: "99964011",
        priceImpactPct: "0.0003",
        slippageBps: 50,
        swapMode: "ExactIn",
      },
      supportedMints: X402_SUPPORTED_MINTS,
      supportedPairs: X402_SUPPORTED_PAIR_IDS,
    },
  },
  {
    id: "market_jupiter_quote_batch",
    method: "POST",
    path: "/api/x402/read/market_jupiter_quote_batch",
    summary: "Batch Jupiter quotes (1..20 requests).",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "requests",
        type: "Array<{inputMint,outputMint,amount,slippageBps?}>",
        description: "Array of quote requests.",
      },
    ],
    optionalFields: [],
    requestExample: {
      requests: [
        {
          inputMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "25000000",
          slippageBps: 50,
        },
      ],
    },
    responseExample: {
      ok: true,
      successCount: 1,
      errorCount: 0,
      results: [
        {
          ok: true,
          index: 0,
          quote: {
            inputMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "25000000",
            outAmount: "58510231",
            priceImpactPct: "0.0012",
            route: "Meteora DLMM -> Orca V2",
          },
        },
      ],
      supportedMints: X402_SUPPORTED_MINTS,
      supportedPairs: X402_SUPPORTED_PAIR_IDS,
    },
  },
  {
    id: "market_ohlcv",
    method: "POST",
    path: "/api/x402/read/market_ohlcv",
    summary: "Hourly OHLCV bars for a mint pair.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "baseMint",
        type: "string",
        description: "Base asset mint.",
      },
      {
        name: "quoteMint",
        type: "string",
        description: "Quote asset mint.",
      },
    ],
    optionalFields: [
      {
        name: "lookbackHours",
        type: "number",
        description: "Historical lookback window.",
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum number of bars in response.",
      },
      {
        name: "resolutionMinutes",
        type: "number",
        description: "Currently only 60 is supported.",
      },
      {
        name: "endMs",
        type: "number",
        description: "End timestamp (ms) for the query window.",
      },
    ],
    requestExample: {
      baseMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      lookbackHours: 168,
      limit: 168,
      resolutionMinutes: 60,
    },
    responseExample: {
      ok: true,
      ohlcv: {
        baseMint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        resolutionMinutes: 60,
        startMs: 1739990400000,
        endMs: 1740595200000,
        limit: 168,
        lookbackHours: 168,
        sourcePriorityUsed: ["birdeye", "dune"],
        bars: [
          {
            ts: "2026-02-20T18:00:00.000Z",
            source: "birdeye",
            open: 144.1,
            high: 145,
            low: 143.8,
            close: 144.7,
            volume: 1823400,
          },
        ],
      },
      supportedMints: X402_SUPPORTED_MINTS,
      supportedPairs: X402_SUPPORTED_PAIR_IDS,
    },
  },
  {
    id: "market_indicators",
    method: "POST",
    path: "/api/x402/read/market_indicators",
    summary: "Hourly OHLCV + derived indicators for a mint pair.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "baseMint",
        type: "string",
        description: "Base asset mint.",
      },
      {
        name: "quoteMint",
        type: "string",
        description: "Quote asset mint.",
      },
    ],
    optionalFields: [
      {
        name: "lookbackHours",
        type: "number",
        description: "Historical lookback window.",
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum number of bars in response.",
      },
      {
        name: "resolutionMinutes",
        type: "number",
        description: "Currently only 60 is supported.",
      },
      {
        name: "endMs",
        type: "number",
        description: "End timestamp (ms) for the query window.",
      },
    ],
    requestExample: {
      baseMint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      lookbackHours: 168,
      limit: 168,
      resolutionMinutes: 60,
    },
    responseExample: {
      ok: true,
      ohlcv: {
        baseMint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        resolutionMinutes: 60,
        startMs: 1739990400000,
        endMs: 1740595200000,
        limit: 168,
        lookbackHours: 168,
        sourcePriorityUsed: ["birdeye", "dune"],
        bars: [
          {
            ts: "2026-02-20T18:00:00.000Z",
            source: "birdeye",
            open: 144.1,
            high: 145,
            low: 143.8,
            close: 144.7,
            volume: 1823400,
          },
        ],
      },
      indicators: {
        barCount: 168,
        latestTs: "2026-02-20T18:00:00.000Z",
        latestClose: 144.7,
        sma20: 142.91,
        ema20: 143.06,
        rsi14: 56.28,
        macd: {
          line: 0.37,
          signal: 0.29,
          histogram: 0.08,
        },
        returnsPct: {
          h1: 0.22,
          h24: 2.1,
          h168: 11.4,
        },
      },
      supportedMints: X402_SUPPORTED_MINTS,
      supportedPairs: X402_SUPPORTED_PAIR_IDS,
    },
  },
  {
    id: "solana_marks_latest",
    method: "POST",
    path: "/api/x402/read/solana_marks_latest",
    summary: "Latest Loop A mark set from KV hot cache.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "commitment",
        type: '"processed" | "confirmed" | "finalized"',
        description: "Mark commitment filter (default: confirmed).",
      },
    ],
    requestExample: {
      commitment: "confirmed",
    },
    responseExample: {
      ok: true,
      commitment: "confirmed",
      marks: {
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:10:00.000Z",
        commitment: "confirmed",
        latestSlot: 321490020,
        count: 1,
        marks: [
          {
            baseMint: "So11111111111111111111111111111111111111112",
            quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            px: "145.2204",
            confidence: 0.73,
            slot: 321490020,
          },
        ],
      },
    },
  },
  {
    id: "solana_scores_latest",
    method: "POST",
    path: "/api/x402/read/solana_scores_latest",
    summary: "Latest Loop B score set with optional pair filter.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "pairId",
        type: "string",
        description: "Optional pair id filter (for example SOL:USDC).",
      },
    ],
    requestExample: {
      pairId: "SOL:USDC",
    },
    responseExample: {
      ok: true,
      pairId: "SOL:USDC",
      scores: {
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:11:00.000Z",
        minute: "2026-02-21T20:11:00.000Z",
        count: 1,
        rows: [
          {
            pairId: "SOL:USDC",
            finalScore: 0.91,
            explain: ["momentum:+0.48", "confidence:+0.30"],
          },
        ],
      },
    },
  },
  {
    id: "solana_views_top",
    method: "POST",
    path: "/api/x402/read/solana_views_top",
    summary: "Latest Loop B top views (top movers, stress, anomaly).",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "view",
        type: '"all" | "top_movers" | "liquidity_stress" | "anomaly_feed"',
        description: "Optional top-view selector (default: all).",
      },
    ],
    requestExample: {
      view: "top_movers",
    },
    responseExample: {
      ok: true,
      view: "top_movers",
      topMovers: {
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:12:00.000Z",
        minute: "2026-02-21T20:12:00.000Z",
        freshnessMs: 540,
        count: 1,
        movers: [
          {
            pairId: "SOL:USDC",
            pctChange: 0.024,
            avgConfidence: 0.71,
          },
        ],
      },
    },
  },
  {
    id: "macro_signals",
    method: "POST",
    path: "/api/x402/read/macro_signals",
    summary: "Top-level macro signals bundle.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [],
    requestExample: {},
    responseExample: {
      ok: true,
      timestamp: "2026-02-20T19:32:00.000Z",
      verdict: "BUY",
      bullishCount: 5,
      totalCount: 7,
      signals: {
        liquidity: {
          status: "BULLISH",
          value: 1.18,
          sparkline: [1.05, 1.09, 1.15, 1.18],
        },
        flowStructure: {
          status: "BULLISH",
          btcReturn5: 3.42,
          qqqReturn5: 1.23,
        },
        macroRegime: {
          status: "RISK_ON",
          qqqRoc20: 6.8,
          xlpRoc20: 1.4,
        },
        technicalTrend: {
          status: "BULLISH",
          btcPrice: 58234.2,
          sma50: 56010.8,
          sma200: 51120.1,
          vwap30d: 55890.2,
          mayerMultiple: 1.14,
          sparkline: [54120, 55210, 56600, 58234],
        },
        hashRate: {
          status: "STABLE",
          change30d: 1.9,
        },
        miningCost: {
          status: "NEUTRAL",
        },
        fearGreed: {
          status: "GREED",
          value: 66,
          history: [
            {
              value: 63,
              date: "2026-02-18",
            },
            {
              value: 66,
              date: "2026-02-19",
            },
          ],
        },
      },
      meta: {
        qqqSparkline: [488.2, 491.7, 493.1, 495.6],
      },
    },
  },
  {
    id: "macro_fred_indicators",
    method: "POST",
    path: "/api/x402/read/macro_fred_indicators",
    summary: "FRED indicator set with optional series filters.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "seriesIds",
        type: "string[]",
        description: "Restrict to specific FRED series ids.",
      },
      {
        name: "observationStart",
        type: "string",
        description: "Start date in YYYY-MM-DD format.",
      },
      {
        name: "observationEnd",
        type: "string",
        description: "End date in YYYY-MM-DD format.",
      },
    ],
    requestExample: {
      seriesIds: ["DGS10", "UNRATE"],
      observationStart: "2024-01-01",
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-20T19:32:00.000Z",
      configured: true,
      series: [
        {
          id: "DGS10",
          name: "DGS10",
          value: 4.2,
          previousValue: 4.18,
          change: 0.02,
          changePercent: 0.48,
          date: "2026-02-19",
          unit: "%",
        },
      ],
    },
  },
  {
    id: "macro_etf_flows",
    method: "POST",
    path: "/api/x402/read/macro_etf_flows",
    summary: "ETF flow analytics with optional ticker filters.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "tickers",
        type: "string[]",
        description: "Restrict ETF flow output to selected tickers.",
      },
    ],
    requestExample: {
      tickers: ["SPY", "QQQ"],
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-20T19:32:00.000Z",
      summary: {
        etfCount: 2,
        totalVolume: 100934200,
        totalEstFlow: 489000000,
        netDirection: "NET INFLOW",
        inflowCount: 2,
        outflowCount: 0,
      },
      etfs: [
        {
          ticker: "SPY",
          issuer: "State Street",
          price: 512.24,
          priceChange: 0.42,
          volume: 65321000,
          avgVolume: 70210000,
          volumeRatio: 0.93,
          direction: "inflow",
          estFlow: 3340000000,
        },
      ],
    },
  },
  {
    id: "macro_stablecoin_health",
    method: "POST",
    path: "/api/x402/read/macro_stablecoin_health",
    summary: "Stablecoin system-health metrics with optional coin filters.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "coins",
        type: "string[]",
        description: "Restrict output to selected stablecoin symbols.",
      },
    ],
    requestExample: {
      coins: ["USDC", "USDT"],
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-20T19:32:00.000Z",
      summary: {
        totalMarketCap: 150456000000,
        totalVolume24h: 38421000000,
        coinCount: 2,
        depeggedCount: 0,
        healthStatus: "HEALTHY",
      },
      stablecoins: [
        {
          id: "usd-coin",
          symbol: "USDC",
          name: "USD Coin",
          price: 1,
          deviation: 0,
          pegStatus: "ON PEG",
          marketCap: 41234567890,
          volume24h: 5321000000,
          change24h: 0,
          change7d: 0,
          image: null,
        },
      ],
    },
  },
  {
    id: "macro_oil_analytics",
    method: "POST",
    path: "/api/x402/read/macro_oil_analytics",
    summary: "Oil and energy macro analytics bundle.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [],
    requestExample: {},
    responseExample: {
      ok: true,
      timestamp: "2026-02-20T19:32:00.000Z",
      configured: true,
      fetchedAt: "2026-02-20T19:32:00.000Z",
      wtiPrice: {
        id: "wti-crude",
        name: "WTI Crude",
        current: 78.4,
        previous: 77.9,
        changePct: 0.6,
        unit: "USD per barrel",
        trend: "up",
        lastUpdated: "2026-02-14",
      },
      brentPrice: {
        id: "brent-crude",
        name: "Brent Crude",
        current: 82.1,
        previous: 81.8,
        changePct: 0.4,
        unit: "USD per barrel",
        trend: "stable",
        lastUpdated: "2026-02-14",
      },
      usProduction: {
        id: "us-production",
        name: "US Production",
        current: 13.2,
        previous: 13.1,
        changePct: 0.8,
        unit: "million barrels/day",
        trend: "up",
        lastUpdated: "2026-02-14",
      },
      usInventory: {
        id: "us-inventory",
        name: "US Inventory",
        current: 427.5,
        previous: 430.1,
        changePct: -0.6,
        unit: "million barrels",
        trend: "down",
        lastUpdated: "2026-02-14",
      },
    },
  },
  {
    id: "perps_funding_surface",
    method: "POST",
    path: "/api/x402/read/perps_funding_surface",
    summary: "Cross-venue perps funding surface for selected symbols.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "symbols",
        type: "string[]",
        description: "Optional symbol filter (for example BTC, ETH, SOL).",
      },
      {
        name: "venues",
        type: '("hyperliquid" | "dydx")[]',
        description: "Optional venue filter.",
      },
      {
        name: "includeInactive",
        type: "boolean",
        description: "Include delisted/final-settlement markets.",
      },
    ],
    requestExample: {
      symbols: ["BTC", "ETH", "SOL"],
      venues: ["hyperliquid", "dydx"],
      includeInactive: false,
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-27T16:20:00.000Z",
      symbols: ["BTC", "ETH", "SOL"],
      venues: ["dydx", "hyperliquid"],
      includeInactive: false,
      count: 6,
      rows: [
        {
          symbol: "BTC",
          spreadBps1h: 0.0217,
          meanFundingBps1h: 0.1072,
          maxAbsFundingBps1h: 0.1189,
          byVenue: [
            {
              venue: "dydx",
              market: "BTC-USD",
              status: "ACTIVE",
              fundingRate1h: 0.0000119,
              fundingBps1h: 0.119,
              openInterestUsd: 27425750.12,
              volume24hUsd: 104666475.36,
            },
            {
              venue: "hyperliquid",
              market: "BTC-PERP",
              status: "ACTIVE",
              fundingRate1h: 0.0000098,
              fundingBps1h: 0.098,
              openInterestUsd: 1393855608.24,
              volume24hUsd: 2054621458.48,
            },
          ],
        },
      ],
      unavailableVenues: [],
    },
  },
  {
    id: "perps_open_interest_surface",
    method: "POST",
    path: "/api/x402/read/perps_open_interest_surface",
    summary: "Cross-venue perps open-interest and dominance surface.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "symbols",
        type: "string[]",
        description: "Optional symbol filter (for example BTC, ETH, SOL).",
      },
      {
        name: "venues",
        type: '("hyperliquid" | "dydx")[]',
        description: "Optional venue filter.",
      },
      {
        name: "includeInactive",
        type: "boolean",
        description: "Include delisted/final-settlement markets.",
      },
    ],
    requestExample: {
      symbols: ["BTC", "ETH", "SOL"],
      includeInactive: false,
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-27T16:20:00.000Z",
      symbols: ["BTC", "ETH", "SOL"],
      venues: ["dydx", "hyperliquid"],
      includeInactive: false,
      count: 6,
      rows: [
        {
          symbol: "BTC",
          totalOpenInterestUsd: 1421281358.36,
          leaderVenue: "hyperliquid",
          leaderSharePct: 98.07,
          byVenue: [
            {
              venue: "dydx",
              market: "BTC-USD",
              status: "ACTIVE",
              markPrice: 65747.67,
              openInterestNative: 417.1607,
              openInterestUsd: 27425750.12,
              sharePct: 1.93,
            },
            {
              venue: "hyperliquid",
              market: "BTC-PERP",
              status: "ACTIVE",
              markPrice: 65705,
              openInterestNative: 21196.49314,
              openInterestUsd: 1393855608.24,
              sharePct: 98.07,
            },
          ],
        },
      ],
      unavailableVenues: [],
    },
  },
  {
    id: "perps_venue_score",
    method: "POST",
    path: "/api/x402/read/perps_venue_score",
    summary: "Venue-level scorecard across selected perps symbols.",
    access: "public-x402-paid",
    requiredFields: [],
    optionalFields: [
      {
        name: "symbols",
        type: "string[]",
        description: "Optional symbol filter (for example BTC, ETH, SOL).",
      },
      {
        name: "venues",
        type: '("hyperliquid" | "dydx")[]',
        description: "Optional venue filter.",
      },
      {
        name: "includeInactive",
        type: "boolean",
        description: "Include delisted/final-settlement markets.",
      },
    ],
    requestExample: {
      symbols: ["BTC", "ETH", "SOL"],
      venues: ["hyperliquid", "dydx"],
      includeInactive: false,
    },
    responseExample: {
      ok: true,
      timestamp: "2026-02-27T16:20:00.000Z",
      symbols: ["BTC", "ETH", "SOL"],
      venues: ["dydx", "hyperliquid"],
      includeInactive: false,
      recommendedVenue: "hyperliquid",
      scores: [
        {
          venue: "hyperliquid",
          score: 100,
          symbolsCovered: 3,
          marketsCount: 3,
          totalOpenInterestUsd: 2841203150.41,
          totalVolume24hUsd: 3228901091.73,
          avgAbsFundingBps1h: 0.0732,
          components: {
            oiLog: 21.7669,
            volumeLog: 21.8953,
            coverage: 3,
            fundingPenalty: 0.0732,
          },
        },
        {
          venue: "dydx",
          score: 0,
          symbolsCovered: 3,
          marketsCount: 3,
          totalOpenInterestUsd: 49641012.2,
          totalVolume24hUsd: 142322832.15,
          avgAbsFundingBps1h: 0.0483,
          components: {
            oiLog: 17.7205,
            volumeLog: 18.7734,
            coverage: 3,
            fundingPenalty: 0.0483,
          },
        },
      ],
      unavailableVenues: [],
    },
  },
];
