import { expect, test } from "bun:test";
import type { AgentToolRuntime } from "../../apps/worker/src/agent_tools";
import { buildAgentToolset } from "../../apps/worker/src/agent_tools";
import { JupiterClient } from "../../apps/worker/src/jupiter";
import { normalizePolicy } from "../../apps/worker/src/policy";
import { SolanaRpc } from "../../apps/worker/src/solana_rpc";
import {
  createInitialSnapshot,
  createWorkerLiveEnv,
  hasLiveOhlcvProviderConfig,
  MAINNET_USDC_MINT,
  resolveSnapshotWallet,
  runWorkerLiveIntegration,
  SOL_MINT,
  withRetries,
} from "./_worker_live_test_utils";

const integrationTest = runWorkerLiveIntegration ? test : test.skip;

function createRuntime(): AgentToolRuntime {
  const env = createWorkerLiveEnv({
    overrides: {
      // Bot tools should not depend on x402 payment config.
      X402_NETWORK: undefined,
      X402_PAY_TO: undefined,
      X402_ASSET_MINT: undefined,
      X402_MAX_TIMEOUT_SECONDS: undefined,
      X402_MARKET_SNAPSHOT_PRICE_USD: undefined,
      X402_MARKET_SNAPSHOT_V2_PRICE_USD: undefined,
      X402_MARKET_TOKEN_BALANCE_PRICE_USD: undefined,
      X402_MARKET_JUPITER_QUOTE_PRICE_USD: undefined,
      X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD: undefined,
      X402_MARKET_OHLCV_PRICE_USD: undefined,
      X402_MARKET_INDICATORS_PRICE_USD: undefined,
    },
  });
  const rpcEndpoint =
    String(env.BALANCE_RPC_ENDPOINT ?? "").trim() ||
    String(env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("Missing RPC endpoint for live agent tool tests.");
  }
  const jupiterBaseUrl =
    String(env.JUPITER_BASE_URL ?? "").trim() || "https://lite-api.jup.ag";
  const wallet = resolveSnapshotWallet(env);
  return {
    env,
    tenantId: "integration-bot",
    runId: `run-${Date.now()}`,
    logKey: "integration.agent.tools",
    log() {},
    rpc: new SolanaRpc(rpcEndpoint),
    jupiter: new JupiterClient(jupiterBaseUrl, env.JUPITER_API_KEY),
    wallet,
    policy: normalizePolicy({
      slippageBps: 50,
      maxPriceImpactPct: 0.05,
      dryRun: true,
    }),
    strategy: {
      type: "agent",
      quoteMint: MAINNET_USDC_MINT,
      quoteDecimals: 6,
      maxStepsPerTick: 4,
      maxToolCallsPerStep: 4,
      mandate:
        "Integration test mandate. Verify market tool connectivity and response shaping.",
    },
    memory: {
      thesis: "integration",
      observations: [],
      reflections: [],
      tradesProposedToday: 0,
      lastTradeDate: "",
      updatedAt: new Date().toISOString(),
    },
    snapshot: createInitialSnapshot(),
    recentTrades: [],
    stopRequested: false,
    tradeExecuted: false,
  };
}

integrationTest(
  "bot market tools return live mainnet data without x402 payment config",
  async () => {
    if (!hasLiveOhlcvProviderConfig()) {
      throw new Error(
        "Missing OHLCV provider config. Set BIRDEYE_API_KEY or DUNE_API_KEY+DUNE_QUERY_ID.",
      );
    }

    const runtime = createRuntime();
    const { handlers } = buildAgentToolset(runtime.strategy);

    const snapshotTool = handlers.market_snapshot;
    const tokenBalanceTool = handlers.market_token_balance;
    const quoteTool = handlers.market_jupiter_quote;
    const quoteBatchTool = handlers.market_jupiter_quote_batch;
    const ohlcvTool = handlers.market_ohlcv_history;
    const indicatorsTool = handlers.market_indicators;
    const macroSignalsTool = handlers.macro_signals;
    const macroFredTool = handlers.macro_fred_indicators;
    const macroEtfTool = handlers.macro_etf_flows;
    const macroStablecoinTool = handlers.macro_stablecoin_health;
    const macroOilTool = handlers.macro_oil_analytics;

    expect(typeof snapshotTool).toBe("function");
    expect(typeof tokenBalanceTool).toBe("function");
    expect(typeof quoteTool).toBe("function");
    expect(typeof quoteBatchTool).toBe("function");
    expect(typeof ohlcvTool).toBe("function");
    expect(typeof indicatorsTool).toBe("function");
    expect(typeof macroSignalsTool).toBe("function");
    expect(typeof macroFredTool).toBe("function");
    expect(typeof macroEtfTool).toBe("function");
    expect(typeof macroStablecoinTool).toBe("function");
    expect(typeof macroOilTool).toBe("function");

    const snapshot = (await withRetries(() => snapshotTool({}, runtime))) as {
      ok?: boolean;
      snapshot?: {
        quoteMint?: string;
        quoteDecimals?: number;
        basePriceQuote?: string;
        portfolioValueQuote?: string;
      };
    };
    expect(snapshot.ok).toBe(true);
    expect(snapshot.snapshot?.quoteMint).toBe(MAINNET_USDC_MINT);
    expect(snapshot.snapshot?.quoteDecimals).toBe(6);
    expect(Number(snapshot.snapshot?.basePriceQuote ?? "0")).toBeGreaterThan(0);
    expect(
      Number(snapshot.snapshot?.portfolioValueQuote ?? "0"),
    ).toBeGreaterThanOrEqual(0);

    const tokenBalance = (await withRetries(() =>
      tokenBalanceTool({ mint: MAINNET_USDC_MINT }, runtime),
    )) as {
      ok?: boolean;
      mint?: string;
      balanceAtomic?: string;
    };
    expect(tokenBalance.ok).toBe(true);
    expect(tokenBalance.mint).toBe(MAINNET_USDC_MINT);
    expect(/^\d+$/.test(String(tokenBalance.balanceAtomic ?? ""))).toBe(true);

    const quote = (await withRetries(() =>
      quoteTool(
        {
          inputMint: SOL_MINT,
          outputMint: MAINNET_USDC_MINT,
          amount: "1000000",
          slippageBps: 50,
        },
        runtime,
      ),
    )) as {
      ok?: boolean;
      quote?: {
        inputMint?: string;
        outputMint?: string;
        inAmount?: string;
        outAmount?: string;
      };
    };
    expect(quote.ok).toBe(true);
    expect(quote.quote?.inputMint).toBe(SOL_MINT);
    expect(quote.quote?.outputMint).toBe(MAINNET_USDC_MINT);
    expect(BigInt(quote.quote?.inAmount ?? "0")).toBeGreaterThan(0n);
    expect(BigInt(quote.quote?.outAmount ?? "0")).toBeGreaterThan(0n);

    const quoteBatch = (await withRetries(() =>
      quoteBatchTool(
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
        runtime,
      ),
    )) as {
      ok?: boolean;
      successCount?: number;
      results?: Array<{ ok?: boolean }>;
    };
    expect(quoteBatch.ok).toBe(true);
    expect(Number(quoteBatch.successCount ?? 0)).toBeGreaterThan(0);
    expect((quoteBatch.results ?? []).some((row) => row.ok === true)).toBe(
      true,
    );

    const ohlcv = (await withRetries(() =>
      ohlcvTool(
        {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          lookbackHours: 48,
          limit: 48,
          endMs: Date.now(),
        },
        runtime,
      ),
    )) as {
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
        sourcePriorityUsed?: string[];
        resolutionMinutes?: number;
      };
    };

    expect(ohlcv.ok).toBe(true);
    expect(ohlcv.ohlcv?.resolutionMinutes).toBe(60);
    const bars = ohlcv.ohlcv?.bars ?? [];
    expect(bars.length).toBeGreaterThan(0);
    expect((ohlcv.ohlcv?.sourcePriorityUsed ?? []).length).toBeGreaterThan(0);
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

    const indicators = (await withRetries(() =>
      indicatorsTool(
        {
          baseMint: SOL_MINT,
          quoteMint: MAINNET_USDC_MINT,
          lookbackHours: 72,
          limit: 48,
        },
        runtime,
      ),
    )) as {
      ok?: boolean;
      indicators?: {
        latestClose?: number | null;
        rsi14?: number | null;
        macd?: { line?: number | null };
      };
      ohlcv?: { bars?: Array<unknown> };
    };
    expect(indicators.ok).toBe(true);
    expect(Array.isArray(indicators.ohlcv?.bars)).toBe(true);
    expect((indicators.ohlcv?.bars ?? []).length).toBeGreaterThan(0);
    expect(Number(indicators.indicators?.latestClose ?? 0)).toBeGreaterThan(0);
    expect(indicators.indicators?.rsi14).not.toBeUndefined();
    expect(indicators.indicators?.macd?.line).not.toBeUndefined();

    const macroSignals = (await withRetries(() =>
      macroSignalsTool({}, runtime),
    )) as {
      ok?: boolean;
      verdict?: string;
      totalCount?: number;
      signals?: Record<string, unknown>;
    };
    expect(macroSignals.ok).toBe(true);
    expect(typeof macroSignals.verdict).toBe("string");
    expect(typeof macroSignals.totalCount).toBe("number");
    expect(typeof macroSignals.signals).toBe("object");

    const macroFred = (await withRetries(() =>
      macroFredTool({}, runtime),
    )) as {
      ok?: boolean;
      configured?: boolean;
      series?: Array<unknown>;
    };
    expect(macroFred.ok).toBe(true);
    expect(typeof macroFred.configured).toBe("boolean");
    expect(Array.isArray(macroFred.series)).toBe(true);

    const macroEtf = (await withRetries(() =>
      macroEtfTool({}, runtime),
    )) as {
      ok?: boolean;
      summary?: { etfCount?: number; netDirection?: string };
      etfs?: Array<unknown>;
    };
    expect(macroEtf.ok).toBe(true);
    expect(typeof macroEtf.summary?.etfCount).toBe("number");
    expect(typeof macroEtf.summary?.netDirection).toBe("string");
    expect(Array.isArray(macroEtf.etfs)).toBe(true);

    const macroStablecoin = (await withRetries(() =>
      macroStablecoinTool({}, runtime),
    )) as {
      ok?: boolean;
      summary?: { coinCount?: number; healthStatus?: string };
      stablecoins?: Array<unknown>;
    };
    expect(macroStablecoin.ok).toBe(true);
    expect(typeof macroStablecoin.summary?.coinCount).toBe("number");
    expect(typeof macroStablecoin.summary?.healthStatus).toBe("string");
    expect(Array.isArray(macroStablecoin.stablecoins)).toBe(true);

    const macroOil = (await withRetries(() =>
      macroOilTool({}, runtime),
    )) as {
      ok?: boolean;
      configured?: boolean;
      wtiPrice?: { current?: number } | null;
      brentPrice?: { current?: number } | null;
    };
    expect(macroOil.ok).toBe(true);
    expect(typeof macroOil.configured).toBe("boolean");
    expect(
      macroOil.wtiPrice === null || typeof macroOil.wtiPrice?.current === "number",
    ).toBe(true);
    expect(
      macroOil.brentPrice === null ||
        typeof macroOil.brentPrice?.current === "number",
    ).toBe(true);
  },
);
