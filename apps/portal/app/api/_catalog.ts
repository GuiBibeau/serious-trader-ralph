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

export const X402_CATALOG_VERSION = "2026-02-20";

export const X402_OVERVIEW: CatalogDoc["overview"] = {
  offering:
    "Solana-focused x402 read endpoints for market and macro intelligence.",
  scope:
    "This catalog includes only publicly callable x402 routes under /api/x402/read/*.",
  notes: [
    "Catalog and discovery endpoints are public. The listed x402 routes require payment authorization.",
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
    summary: "Single Jupiter quote for exact-in swap sizing.",
    access: "public-x402-paid",
    requiredFields: [
      {
        name: "inputMint",
        type: "string",
        description: "Input token mint.",
      },
      {
        name: "outputMint",
        type: "string",
        description: "Output token mint.",
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
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000000",
      slippageBps: 50,
    },
    responseExample: {
      ok: true,
      quote: {
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "1000000000",
        outAmount: "145230000",
        priceImpactPct: "0.0008",
        slippageBps: 50,
        swapMode: "ExactIn",
      },
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
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000000",
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
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "1000000000",
            outAmount: "145230000",
            priceImpactPct: "0.0008",
            route: "Meteora DLMM -> Orca V2",
          },
        },
      ],
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
      baseMint: "So11111111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      lookbackHours: 168,
      limit: 168,
      resolutionMinutes: 60,
    },
    responseExample: {
      ok: true,
      ohlcv: {
        baseMint: "So11111111111111111111111111111111111111112",
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
      baseMint: "So11111111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      lookbackHours: 168,
      limit: 168,
      resolutionMinutes: 60,
    },
    responseExample: {
      ok: true,
      ohlcv: {
        baseMint: "So11111111111111111111111111111111111111112",
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
];
