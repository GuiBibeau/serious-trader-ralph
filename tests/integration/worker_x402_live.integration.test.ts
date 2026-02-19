import { expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
  DEVNET_USDC_MINT,
  decodeBase64JsonHeader,
  hasLiveOhlcvProviderConfig,
  MAINNET_USDC_MINT,
  resolveSnapshotWallet,
  runWorkerLiveIntegration,
  SOL_MINT,
  withRetries,
} from "./_worker_live_test_utils";

const integrationTest = runWorkerLiveIntegration ? test : test.skip;

const PATHS = {
  snapshot: "/api/x402/read/market_snapshot",
  snapshotV2: "/api/x402/read/market_snapshot_v2",
  tokenBalance: "/api/x402/read/market_token_balance",
  quote: "/api/x402/read/market_jupiter_quote",
  quoteBatch: "/api/x402/read/market_jupiter_quote_batch",
  ohlcv: "/api/x402/read/market_ohlcv",
  indicators: "/api/x402/read/market_indicators",
  macroSignals: "/api/x402/read/macro_signals",
  macroFredIndicators: "/api/x402/read/macro_fred_indicators",
  macroEtfFlows: "/api/x402/read/macro_etf_flows",
  macroStablecoinHealth: "/api/x402/read/macro_stablecoin_health",
  macroOilAnalytics: "/api/x402/read/macro_oil_analytics",
} as const;

function buildRequest(
  path: string,
  payload: Record<string, unknown>,
  signature?: string,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("payment-signature", signature);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function toPositiveNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

integrationTest(
  "x402 endpoints emit devnet USDC payment requirements",
  async () => {
    const env = createWorkerLiveEnv();
    const ctx = createExecutionContextStub();
    const walletAddress = resolveSnapshotWallet(env);

    const requests = [
      {
        routeKey: "market_snapshot",
        path: PATHS.snapshot,
        body: { walletAddress, quoteMint: MAINNET_USDC_MINT },
      },
      {
        routeKey: "market_snapshot_v2",
        path: PATHS.snapshotV2,
        body: {
          walletAddress,
          quoteMint: MAINNET_USDC_MINT,
          trackedMints: [SOL_MINT, MAINNET_USDC_MINT],
        },
      },
      {
        routeKey: "market_token_balance",
        path: PATHS.tokenBalance,
        body: { walletAddress, mint: MAINNET_USDC_MINT },
      },
      {
        routeKey: "market_jupiter_quote",
        path: PATHS.quote,
        body: {
          inputMint: SOL_MINT,
          outputMint: MAINNET_USDC_MINT,
          amount: "1000000",
          slippageBps: 50,
        },
      },
      {
        routeKey: "market_jupiter_quote_batch",
        path: PATHS.quoteBatch,
        body: {
          requests: [
            {
              inputMint: SOL_MINT,
              outputMint: MAINNET_USDC_MINT,
              amount: "1000000",
            },
          ],
        },
      },
      {
        routeKey: "market_ohlcv",
        path: PATHS.ohlcv,
        body: {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          lookbackHours: 48,
          limit: 24,
          resolutionMinutes: 60,
        },
      },
      {
        routeKey: "market_indicators",
        path: PATHS.indicators,
        body: {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          lookbackHours: 72,
          limit: 48,
          resolutionMinutes: 60,
        },
      },
      {
        routeKey: "macro_signals",
        path: PATHS.macroSignals,
        body: {},
      },
      {
        routeKey: "macro_fred_indicators",
        path: PATHS.macroFredIndicators,
        body: {},
      },
      {
        routeKey: "macro_etf_flows",
        path: PATHS.macroEtfFlows,
        body: {},
      },
      {
        routeKey: "macro_stablecoin_health",
        path: PATHS.macroStablecoinHealth,
        body: {},
      },
      {
        routeKey: "macro_oil_analytics",
        path: PATHS.macroOilAnalytics,
        body: {},
      },
    ] as const;

    for (const req of requests) {
      const response = await withRetries(() =>
        worker.fetch(buildRequest(req.path, req.body), env, ctx),
      );
      expect(response.status).toBe(402);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe("payment-required");

      const required = decodeBase64JsonHeader<{
        accepts?: Array<{
          network?: string;
          asset?: string;
          amount?: string;
          extra?: { route?: string };
        }>;
        resource?: { uri?: string; method?: string };
      }>(response.headers.get("payment-required"));

      const accept = required.accepts?.[0];
      expect(accept?.network).toBe("solana-devnet");
      expect(accept?.asset).toBe(DEVNET_USDC_MINT);
      expect(accept?.amount).toBe("10000");
      expect(accept?.extra?.route).toBe(req.routeKey);
      expect(required.resource?.uri).toBe(req.path);
      expect(required.resource?.method).toBe("POST");
    }
  },
);

integrationTest(
  "x402 endpoints return live data when payment signature is present",
  async () => {
    if (!hasLiveOhlcvProviderConfig()) {
      throw new Error(
        "Missing OHLCV provider config. Set BIRDEYE_API_KEY or DUNE_API_KEY+DUNE_QUERY_ID.",
      );
    }

    const env = createWorkerLiveEnv();
    const ctx = createExecutionContextStub();
    const walletAddress = resolveSnapshotWallet(env);

    const snapshotRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.snapshot,
          {
            walletAddress,
            quoteMint: MAINNET_USDC_MINT,
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.headers.get("payment-response")).toBeTruthy();
    const snapshotBody = (await snapshotRes.json()) as {
      ok?: boolean;
      snapshot?: {
        basePriceQuote?: string;
        portfolioValueQuote?: string;
        quoteMint?: string;
        quoteDecimals?: number;
      };
    };
    expect(snapshotBody.ok).toBe(true);
    expect(snapshotBody.snapshot?.quoteMint).toBe(MAINNET_USDC_MINT);
    expect(snapshotBody.snapshot?.quoteDecimals).toBe(6);
    expect(
      toPositiveNumber(snapshotBody.snapshot?.basePriceQuote),
    ).toBeGreaterThan(0);
    expect(
      toPositiveNumber(snapshotBody.snapshot?.portfolioValueQuote),
    ).toBeGreaterThanOrEqual(0);

    const snapshotV2Res = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.snapshotV2,
          {
            walletAddress,
            quoteMint: MAINNET_USDC_MINT,
            trackedMints: [SOL_MINT, MAINNET_USDC_MINT],
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(snapshotV2Res.status).toBe(200);
    expect(snapshotV2Res.headers.get("payment-response")).toBeTruthy();
    const snapshotV2Body = (await snapshotV2Res.json()) as {
      ok?: boolean;
      snapshot?: { quoteMint?: string };
      balances?: Array<{ mint?: string; balanceAtomic?: string }>;
    };
    expect(snapshotV2Body.ok).toBe(true);
    expect(snapshotV2Body.snapshot?.quoteMint).toBe(MAINNET_USDC_MINT);
    expect(Array.isArray(snapshotV2Body.balances)).toBe(true);
    expect(
      (snapshotV2Body.balances ?? []).some((row) => row.mint === SOL_MINT),
    ).toBe(true);

    const tokenBalanceRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.tokenBalance,
          {
            walletAddress,
            mint: MAINNET_USDC_MINT,
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(tokenBalanceRes.status).toBe(200);
    expect(tokenBalanceRes.headers.get("payment-response")).toBeTruthy();
    const tokenBalanceBody = (await tokenBalanceRes.json()) as {
      ok?: boolean;
      balance?: { mint?: string; balanceAtomic?: string };
    };
    expect(tokenBalanceBody.ok).toBe(true);
    expect(tokenBalanceBody.balance?.mint).toBe(MAINNET_USDC_MINT);
    expect(
      /^\d+$/.test(String(tokenBalanceBody.balance?.balanceAtomic ?? "")),
    ).toBe(true);

    const quoteRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.quote,
          {
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amount: "1000000",
            slippageBps: 50,
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.headers.get("payment-response")).toBeTruthy();
    const quoteBody = (await quoteRes.json()) as {
      ok?: boolean;
      quote?: {
        outAmount?: string;
        inAmount?: string;
        inputMint?: string;
        outputMint?: string;
      };
    };
    expect(quoteBody.ok).toBe(true);
    expect(quoteBody.quote?.inputMint).toBe(SOL_MINT);
    expect(quoteBody.quote?.outputMint).toBe(MAINNET_USDC_MINT);
    expect(BigInt(quoteBody.quote?.inAmount ?? "0")).toBeGreaterThan(0n);
    expect(BigInt(quoteBody.quote?.outAmount ?? "0")).toBeGreaterThan(0n);

    const quoteBatchRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.quoteBatch,
          {
            requests: [
              {
                inputMint: SOL_MINT,
                outputMint: MAINNET_USDC_MINT,
                amount: "1000000",
              },
              {
                inputMint: MAINNET_USDC_MINT,
                outputMint: SOL_MINT,
                amount: "1000000",
              },
            ],
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(quoteBatchRes.status).toBe(200);
    expect(quoteBatchRes.headers.get("payment-response")).toBeTruthy();
    const quoteBatchBody = (await quoteBatchRes.json()) as {
      ok?: boolean;
      successCount?: number;
      results?: Array<{ ok?: boolean }>;
    };
    expect(quoteBatchBody.ok).toBe(true);
    expect(Number(quoteBatchBody.successCount ?? 0)).toBeGreaterThan(0);
    expect((quoteBatchBody.results ?? []).some((row) => row.ok === true)).toBe(
      true,
    );

    const ohlcvRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.ohlcv,
          {
            baseMint: SOL_MINT,
            quoteMint: MAINNET_USDC_MINT,
            lookbackHours: 48,
            limit: 24,
            resolutionMinutes: 60,
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(ohlcvRes.status).toBe(200);
    expect(ohlcvRes.headers.get("payment-response")).toBeTruthy();
    const ohlcvBody = (await ohlcvRes.json()) as {
      ok?: boolean;
      ohlcv?: {
        bars?: Array<{
          ts: string;
          source: string;
          open: number;
          high: number;
          low: number;
          close: number;
        }>;
        resolutionMinutes?: number;
      };
    };
    expect(ohlcvBody.ok).toBe(true);
    expect(ohlcvBody.ohlcv?.resolutionMinutes).toBe(60);
    const bars = ohlcvBody.ohlcv?.bars ?? [];
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i]!;
      expect(["birdeye", "dune"]).toContain(bar.source);
      expect(bar.low).toBeLessThanOrEqual(bar.open);
      expect(bar.low).toBeLessThanOrEqual(bar.close);
      expect(bar.high).toBeGreaterThanOrEqual(bar.open);
      expect(bar.high).toBeGreaterThanOrEqual(bar.close);
      if (i > 0) {
        const prev = bars[i - 1]!;
        expect(Date.parse(prev.ts)).toBeLessThanOrEqual(Date.parse(bar.ts));
      }
    }

    const indicatorsRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.indicators,
          {
            baseMint: SOL_MINT,
            quoteMint: MAINNET_USDC_MINT,
            lookbackHours: 72,
            limit: 48,
            resolutionMinutes: 60,
          },
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(indicatorsRes.status).toBe(200);
    expect(indicatorsRes.headers.get("payment-response")).toBeTruthy();
    const indicatorsBody = (await indicatorsRes.json()) as {
      ok?: boolean;
      indicators?: {
        latestClose?: number | null;
        rsi14?: number | null;
        macd?: { line?: number | null };
      };
      ohlcv?: { bars?: Array<unknown> };
    };
    expect(indicatorsBody.ok).toBe(true);
    expect(Array.isArray(indicatorsBody.ohlcv?.bars)).toBe(true);
    expect((indicatorsBody.ohlcv?.bars ?? []).length).toBeGreaterThan(0);
    expect(
      toPositiveNumber(indicatorsBody.indicators?.latestClose),
    ).toBeGreaterThan(0);
    expect(indicatorsBody.indicators?.rsi14).not.toBeUndefined();
    expect(indicatorsBody.indicators?.macd?.line).not.toBeUndefined();

    const macroSignalsRes = await withRetries(() =>
      worker.fetch(
        buildRequest(PATHS.macroSignals, {}, "integration-signed-payment"),
        env,
        ctx,
      ),
    );
    expect(macroSignalsRes.status).toBe(200);
    expect(macroSignalsRes.headers.get("payment-response")).toBeTruthy();
    const macroSignalsBody = (await macroSignalsRes.json()) as {
      ok?: boolean;
      verdict?: string;
      totalCount?: number;
      signals?: Record<string, unknown>;
    };
    expect(macroSignalsBody.ok).toBe(true);
    expect(typeof macroSignalsBody.verdict).toBe("string");
    expect(typeof macroSignalsBody.totalCount).toBe("number");
    expect(typeof macroSignalsBody.signals).toBe("object");

    const macroFredRes = await withRetries(() =>
      worker.fetch(
        buildRequest(PATHS.macroFredIndicators, {}, "integration-signed-payment"),
        env,
        ctx,
      ),
    );
    expect(macroFredRes.status).toBe(200);
    expect(macroFredRes.headers.get("payment-response")).toBeTruthy();
    const macroFredBody = (await macroFredRes.json()) as {
      ok?: boolean;
      configured?: boolean;
      series?: Array<unknown>;
    };
    expect(macroFredBody.ok).toBe(true);
    expect(typeof macroFredBody.configured).toBe("boolean");
    expect(Array.isArray(macroFredBody.series)).toBe(true);

    const macroEtfRes = await withRetries(() =>
      worker.fetch(
        buildRequest(PATHS.macroEtfFlows, {}, "integration-signed-payment"),
        env,
        ctx,
      ),
    );
    expect(macroEtfRes.status).toBe(200);
    expect(macroEtfRes.headers.get("payment-response")).toBeTruthy();
    const macroEtfBody = (await macroEtfRes.json()) as {
      ok?: boolean;
      summary?: { etfCount?: number; netDirection?: string };
      etfs?: Array<unknown>;
    };
    expect(macroEtfBody.ok).toBe(true);
    expect(typeof macroEtfBody.summary?.etfCount).toBe("number");
    expect(typeof macroEtfBody.summary?.netDirection).toBe("string");
    expect(Array.isArray(macroEtfBody.etfs)).toBe(true);

    const macroStablecoinRes = await withRetries(() =>
      worker.fetch(
        buildRequest(
          PATHS.macroStablecoinHealth,
          {},
          "integration-signed-payment",
        ),
        env,
        ctx,
      ),
    );
    expect(macroStablecoinRes.status).toBe(200);
    expect(macroStablecoinRes.headers.get("payment-response")).toBeTruthy();
    const macroStablecoinBody = (await macroStablecoinRes.json()) as {
      ok?: boolean;
      summary?: { coinCount?: number; healthStatus?: string };
      stablecoins?: Array<unknown>;
    };
    expect(macroStablecoinBody.ok).toBe(true);
    expect(typeof macroStablecoinBody.summary?.coinCount).toBe("number");
    expect(typeof macroStablecoinBody.summary?.healthStatus).toBe("string");
    expect(Array.isArray(macroStablecoinBody.stablecoins)).toBe(true);

    const macroOilRes = await withRetries(() =>
      worker.fetch(
        buildRequest(PATHS.macroOilAnalytics, {}, "integration-signed-payment"),
        env,
        ctx,
      ),
    );
    expect(macroOilRes.status).toBe(200);
    expect(macroOilRes.headers.get("payment-response")).toBeTruthy();
    const macroOilBody = (await macroOilRes.json()) as {
      ok?: boolean;
      configured?: boolean;
      wtiPrice?: { current?: number } | null;
      brentPrice?: { current?: number } | null;
    };
    expect(macroOilBody.ok).toBe(true);
    expect(typeof macroOilBody.configured).toBe("boolean");
    expect(
      macroOilBody.wtiPrice === null ||
        typeof macroOilBody.wtiPrice?.current === "number",
    ).toBe(true);
    expect(
      macroOilBody.brentPrice === null ||
        typeof macroOilBody.brentPrice?.current === "number",
    ).toBe(true);
  },
);

integrationTest(
  "x402 route input validation returns 400 on malformed requests",
  async () => {
    const env = createWorkerLiveEnv();
    const ctx = createExecutionContextStub();
    const walletAddress = resolveSnapshotWallet(env);

    const invalidOhlcv = await worker.fetch(
      buildRequest(
        PATHS.ohlcv,
        {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          resolutionMinutes: 15,
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidOhlcv.status).toBe(400);
    expect(((await invalidOhlcv.json()) as { error?: string }).error).toBe(
      "invalid-ohlcv-request",
    );

    const invalidIndicators = await worker.fetch(
      buildRequest(
        PATHS.indicators,
        {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          resolutionMinutes: 15,
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidIndicators.status).toBe(400);
    expect(((await invalidIndicators.json()) as { error?: string }).error).toBe(
      "invalid-indicators-request",
    );

    const invalidQuoteBatch = await worker.fetch(
      buildRequest(
        PATHS.quoteBatch,
        {
          requests: [],
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidQuoteBatch.status).toBe(400);
    expect(((await invalidQuoteBatch.json()) as { error?: string }).error).toBe(
      "invalid-quote-batch-request",
    );

    const invalidTokenBalance = await worker.fetch(
      buildRequest(
        PATHS.tokenBalance,
        {
          walletAddress,
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidTokenBalance.status).toBe(400);
    expect(
      ((await invalidTokenBalance.json()) as { error?: string }).error,
    ).toBe("missing-mint");

    const invalidMacroFred = await worker.fetch(
      buildRequest(
        PATHS.macroFredIndicators,
        {
          seriesIds: "FEDFUNDS",
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidMacroFred.status).toBe(400);
    expect(((await invalidMacroFred.json()) as { error?: string }).error).toBe(
      "invalid-macro-fred-request",
    );

    const invalidMacroEtf = await worker.fetch(
      buildRequest(
        PATHS.macroEtfFlows,
        {
          tickers: "IBIT",
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidMacroEtf.status).toBe(400);
    expect(((await invalidMacroEtf.json()) as { error?: string }).error).toBe(
      "invalid-macro-etf-request",
    );

    const invalidMacroStablecoin = await worker.fetch(
      buildRequest(
        PATHS.macroStablecoinHealth,
        {
          coins: "tether",
        },
        "integration-signed-payment",
      ),
      env,
      ctx,
    );
    expect(invalidMacroStablecoin.status).toBe(400);
    expect(
      ((await invalidMacroStablecoin.json()) as { error?: string }).error,
    ).toBe("invalid-macro-stablecoin-request");
  },
);
