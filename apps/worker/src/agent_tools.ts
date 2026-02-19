import type { ChatTool, ChatToolCall } from "./agent_llm";
import { inferMandateProfile } from "./agent_mandate";
import {
  newBacktestRunId,
  normalizeBacktestRunRequest,
} from "./backtests/engine";
import {
  enqueueBacktestRun,
  getBacktestRun,
  listBacktestRunEvents,
  listBacktestRuns,
} from "./backtests/repo";
import { getLoopConfig } from "./config";
import { USDC_MINT } from "./defaults";
import { executeSwapViaRouter } from "./execution/router";
import { fetchHistoricalOhlcvRuntime } from "./historical_ohlcv";
import type { JupiterClient } from "./jupiter";
import {
  fetchMacroEtfFlows,
  fetchMacroFredIndicators,
  fetchMacroOilAnalytics,
  fetchMacroSignals,
  fetchMacroStablecoinHealth,
} from "./macro_sources";
import { computeMarketIndicators } from "./market_indicators";
import { addReflection, appendObservation, updateThesis } from "./memory";
import type { NormalizedPolicy } from "./policy";
import { enforcePolicy, normalizePolicy } from "./policy";
import { gatherMarketSnapshot } from "./research";
import type { SolanaRpc } from "./solana_rpc";
import type { TradeIndexResult } from "./trade_index";
import { insertTradeIndex, listTrades } from "./trade_index";
import type { AgentMemory, AgentStrategy, Env, MarketSnapshot } from "./types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const NETWORK_NOTE_MAINNET_TOOLS =
  "Network note: x402 payments are devnet test-only; agentic tools ALWAYS hit mainnet market data/liquidity, and some assets do not exist on devnet.";

const BACKTEST_NOTE =
  "Backtests run asynchronously in a background queue. Use list/get tools to inspect progress/results.";

type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

export type AgentToolRuntime = {
  env: Env;
  tenantId: string;
  configTenantId?: string;
  runId: string;
  logKey: string;
  log: LogFn;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  wallet: string;
  policy: NormalizedPolicy;
  execution?: import("./types").ExecutionConfig;
  strategy: AgentStrategy;
  privyWalletId?: string;
  memory: AgentMemory;
  snapshot: MarketSnapshot;
  recentTrades: TradeIndexResult[];
  stopRequested: boolean;
  tradeExecuted: boolean;
};

export type AgentToolHandler = (
  args: Record<string, unknown>,
  rt: AgentToolRuntime,
  call?: ChatToolCall,
) => Promise<unknown>;

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action?: NonNullable<AgentStrategy["allowedActions"]>[number];
  handler: AgentToolHandler;
};

export function buildAgentToolset(strategy: AgentStrategy): {
  tools: ChatTool[];
  handlers: Record<string, AgentToolHandler>;
} {
  const defs = filterTools(TOOLS, strategy);
  return {
    tools: defs.map((d) => ({
      type: "function",
      function: {
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      },
    })),
    handlers: Object.fromEntries(defs.map((d) => [d.name, d.handler])),
  };
}

function filterTools(all: ToolDef[], strategy: AgentStrategy): ToolDef[] {
  let out = [...all];
  const mustHave = "control_finish";
  let denied = new Set<string>();

  // allowedActions is a coarse “can the agent do X” switch. It applies only to
  // action tools; observation/research tools remain available by default.
  if (strategy.allowedActions && strategy.allowedActions.length > 0) {
    const allow = new Set(strategy.allowedActions);
    out = out.filter((t) => !t.action || allow.has(t.action));
  }

  // toolPolicy is a fine-grained allow/deny list by tool name.
  const policy = strategy.toolPolicy;
  if (policy) {
    const deny = new Set(
      Array.isArray(policy.deny)
        ? policy.deny.filter((x): x is string => typeof x === "string")
        : [],
    );
    denied = deny;
    const allow = new Set(
      Array.isArray(policy.allow)
        ? policy.allow.filter((x): x is string => typeof x === "string")
        : [],
    );

    const allowAll = Boolean(policy.allowAll);
    if (!allowAll && allow.size > 0) {
      out = out.filter((t) => allow.has(t.name) && !deny.has(t.name));
    } else {
      out = out.filter((t) => !deny.has(t.name));
    }
  }

  // Ensure the agent always has a deterministic way to stop the tick, even when
  // tool allow-lists are enabled. It can still be explicitly denied.
  if (!out.some((t) => t.name === mustHave) && !denied.has(mustHave)) {
    const control = all.find((t) => t.name === mustHave);
    if (control) out = [control, ...out];
  }

  return out;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    out.push(normalized);
    seen.add(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function quoteSummary(quote: Record<string, unknown>): Record<string, unknown> {
  const inputMint = typeof quote.inputMint === "string" ? quote.inputMint : "";
  const outputMint =
    typeof quote.outputMint === "string" ? quote.outputMint : "";
  const inAmount = typeof quote.inAmount === "string" ? quote.inAmount : "";
  const outAmount = typeof quote.outAmount === "string" ? quote.outAmount : "";
  const priceImpactPct = quote.priceImpactPct ?? 0;
  const routePlan = Array.isArray(quote.routePlan) ? quote.routePlan : [];
  const labels: string[] = [];
  for (const hop of routePlan) {
    const info = (hop as { swapInfo?: { label?: unknown } }).swapInfo;
    const label = info?.label;
    if (typeof label === "string" && label.trim()) labels.push(label.trim());
    if (labels.length >= 3) break;
  }

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    priceImpactPct,
    ...(labels.length > 0 ? { route: labels.join(" -> ") } : {}),
  };
}

async function enqueueBacktestForTenant(
  env: Env,
  tenantId: string,
): Promise<void> {
  const id = env.BACKTEST_QUEUE.idFromName(tenantId);
  const stub = env.BACKTEST_QUEUE.get(id);
  await stub.fetch("https://backtest-queue/enqueue", {
    method: "POST",
    headers: {
      "x-ralph-bot-id": tenantId,
    },
  });
}

const TOOLS: ToolDef[] = [
  {
    name: "control_finish",
    description:
      "Finish the tick. Use this when you are done (traded or decided not to).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What you did and why" },
      },
      required: ["summary"],
    },
    handler: async (args, rt) => {
      const summary = String(args.summary ?? "").trim();
      rt.log("info", "agent finished", { summary });
      rt.stopRequested = true;
      return { ok: true };
    },
  },

  {
    name: "market_snapshot",
    description: `Get the latest market snapshot for this bot (portfolio balances + SOL price in quote mint). ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (_args, rt) => {
      const snapshot = await gatherMarketSnapshot(
        rt.rpc,
        rt.jupiter,
        rt.wallet,
        rt.policy,
        {
          quoteMint: rt.strategy.quoteMint,
          quoteDecimals: rt.strategy.quoteDecimals,
        },
      );
      rt.snapshot = snapshot;
      rt.log("info", "agent tool market snapshot", {
        basePriceQuote: snapshot.basePriceQuote,
        portfolioValueQuote: snapshot.portfolioValueQuote,
        baseAllocationPct: snapshot.baseAllocationPct,
      });
      return { ok: true, snapshot };
    },
  },

  {
    name: "market_token_balance",
    description:
      "Get this bot's token balance for a mint. For SOL use the canonical SOL mint.",
    parameters: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Token mint address" },
      },
      required: ["mint"],
    },
    handler: async (args, rt) => {
      const mint = String(args.mint ?? "").trim();
      if (!mint) return { ok: false, error: "missing-mint" };
      if (mint === SOL_MINT) {
        const lamports = await rt.rpc.getBalanceLamports(rt.wallet);
        return { ok: true, mint, balanceAtomic: lamports.toString() };
      }
      const bal = await rt.rpc.getTokenBalanceAtomic(rt.wallet, mint);
      return { ok: true, mint, balanceAtomic: bal.toString() };
    },
  },

  {
    name: "market_jupiter_quote",
    description: `Get a Jupiter quote for a swap (ExactIn by default). Quote is validated against policy constraints. ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: {
      type: "object",
      properties: {
        inputMint: { type: "string" },
        outputMint: { type: "string" },
        amount: { type: "string", description: "Atomic units of inputMint" },
        swapMode: { type: "string", enum: ["ExactIn", "ExactOut"] },
        slippageBps: {
          type: "number",
          description:
            "Optional. Clamped to policy slippage tolerance; defaults to policy.",
        },
      },
      required: ["inputMint", "outputMint", "amount"],
    },
    handler: async (args, rt) => {
      const inputMint = String(args.inputMint ?? "").trim();
      const outputMint = String(args.outputMint ?? "").trim();
      const amount = String(args.amount ?? "").trim();
      const swapModeRaw = String(args.swapMode ?? "ExactIn");
      const swapMode = swapModeRaw === "ExactOut" ? "ExactOut" : "ExactIn";
      const slippageBps = clampInt(
        args.slippageBps,
        rt.policy.slippageBps,
        0,
        rt.policy.slippageBps,
      );

      if (!inputMint || !outputMint || !amount) {
        return { ok: false, error: "missing-params" };
      }

      const quote = await rt.jupiter.quote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        swapMode,
      });
      enforcePolicy(rt.policy, quote);
      const summary = quoteSummary(quote as Record<string, unknown>);
      rt.log("info", "agent tool jupiter quote", summary);
      return { ok: true, quote: summary };
    },
  },

  {
    name: "market_jupiter_quote_batch",
    description: `Get multiple Jupiter quotes in one call (ExactIn). Each quote is policy-validated and returned as a compact summary. ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: {
      type: "object",
      properties: {
        requests: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              inputMint: { type: "string" },
              outputMint: { type: "string" },
              amount: {
                type: "string",
                description: "Atomic units of input mint",
              },
              slippageBps: {
                type: "number",
                description:
                  "Optional per-request slippage, clamped to policy tolerance.",
              },
            },
            required: ["inputMint", "outputMint", "amount"],
          },
        },
      },
      required: ["requests"],
    },
    handler: async (args, rt) => {
      const requests = Array.isArray(args.requests) ? args.requests : null;
      if (!requests || requests.length < 1 || requests.length > 20) {
        return { ok: false, error: "invalid-quote-batch-request" };
      }

      const results: Array<Record<string, unknown>> = [];
      let successCount = 0;
      for (let index = 0; index < requests.length; index += 1) {
        const item = requests[index];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          results.push({ ok: false, index, error: "invalid-quote-request" });
          continue;
        }
        const req = item as Record<string, unknown>;
        const inputMint = String(req.inputMint ?? "").trim();
        const outputMint = String(req.outputMint ?? "").trim();
        const amount = String(req.amount ?? "").trim();
        const slippageBps = clampInt(
          req.slippageBps,
          rt.policy.slippageBps,
          1,
          rt.policy.slippageBps,
        );
        if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
          results.push({ ok: false, index, error: "invalid-quote-request" });
          continue;
        }

        try {
          const quote = await rt.jupiter.quote({
            inputMint,
            outputMint,
            amount,
            slippageBps,
            swapMode: "ExactIn",
          });
          enforcePolicy(rt.policy, quote);
          successCount += 1;
          results.push({
            ok: true,
            index,
            quote: quoteSummary(quote as Record<string, unknown>),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "quote-failed";
          results.push({ ok: false, index, error: "quote-failed", message });
        }
      }

      rt.log("info", "agent tool jupiter quote batch", {
        requests: requests.length,
        successCount,
        errorCount: requests.length - successCount,
      });
      if (successCount < 1) {
        return { ok: false, error: "quote-batch-failed", results };
      }
      return {
        ok: true,
        successCount,
        errorCount: requests.length - successCount,
        results,
      };
    },
  },

  {
    name: "market_ohlcv_history",
    description: `Fetch historical OHLCV bars (1h resolution only) for a mint pair. Uses live data sources only (Birdeye/Dune), never fixture fallback. ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: {
      type: "object",
      properties: {
        baseMint: {
          type: "string",
          description: "Base mint address (defaults to SOL).",
        },
        quoteMint: {
          type: "string",
          description: "Quote mint address (defaults to USDC).",
        },
        lookbackHours: {
          type: "number",
          description: "Lookback window in hours (24..720). Defaults to 72.",
        },
        limit: {
          type: "number",
          description: "Max bars returned (24..240). Defaults to 120.",
        },
        endMs: {
          type: "number",
          description:
            "Optional end timestamp (epoch milliseconds). Defaults to now.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      try {
        const cfg = await getLoopConfig(
          rt.env,
          rt.configTenantId ?? rt.tenantId,
        ).catch(() => null);
        const ohlcv = await fetchHistoricalOhlcvRuntime(rt.env, args, {
          dataSources: cfg?.dataSources,
          defaultBaseMint: SOL_MINT,
          defaultQuoteMint: USDC_MINT,
          defaultLookbackHours: 72,
          defaultLimit: 120,
          minLookbackHours: 24,
          maxLookbackHours: 720,
          minLimit: 24,
          maxLimit: 240,
          requireMints: false,
        });
        rt.log("info", "agent tool ohlcv history", {
          baseMint: ohlcv.baseMint,
          quoteMint: ohlcv.quoteMint,
          bars: ohlcv.bars.length,
          sourcePriority: ohlcv.sourcePriorityUsed.join(","),
        });
        return { ok: true, ohlcv };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "ohlcv-fetch-failed";
        if (message === "invalid-ohlcv-request") {
          return { ok: false, error: "invalid-ohlcv-request" };
        }
        return { ok: false, error: "ohlcv-fetch-failed" };
      }
    },
  },

  {
    name: "market_indicators",
    description: `Compute technical indicators from hourly OHLCV bars (SMA/EMA/RSI/MACD + returns). Uses live sources only (Birdeye/Dune). ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: {
      type: "object",
      properties: {
        baseMint: {
          type: "string",
          description: "Base mint address (defaults to SOL).",
        },
        quoteMint: {
          type: "string",
          description: "Quote mint address (defaults to USDC).",
        },
        lookbackHours: {
          type: "number",
          description: "Lookback window in hours (24..720). Defaults to 168.",
        },
        limit: {
          type: "number",
          description: "Max bars returned (24..240). Defaults to 168.",
        },
        endMs: {
          type: "number",
          description:
            "Optional end timestamp (epoch milliseconds). Defaults to now.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      try {
        const cfg = await getLoopConfig(
          rt.env,
          rt.configTenantId ?? rt.tenantId,
        ).catch(() => null);
        const ohlcv = await fetchHistoricalOhlcvRuntime(rt.env, args, {
          dataSources: cfg?.dataSources,
          defaultBaseMint: SOL_MINT,
          defaultQuoteMint: USDC_MINT,
          defaultLookbackHours: 168,
          defaultLimit: 168,
          minLookbackHours: 24,
          maxLookbackHours: 720,
          minLimit: 24,
          maxLimit: 240,
          requireMints: false,
        });
        const indicators = computeMarketIndicators(ohlcv.bars);
        rt.log("info", "agent tool market indicators", {
          baseMint: ohlcv.baseMint,
          quoteMint: ohlcv.quoteMint,
          bars: ohlcv.bars.length,
          latestClose: indicators.latestClose,
        });
        return { ok: true, ohlcv, indicators };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "indicators-fetch-failed";
        if (message === "invalid-ohlcv-request") {
          return { ok: false, error: "invalid-indicators-request" };
        }
        return { ok: false, error: "indicators-fetch-failed" };
      }
    },
  },

  {
    name: "macro_signals",
    description:
      "Fetch macro market regime signals (liquidity, risk regime, technical trend, hash-rate and fear/greed) with composite BUY/CASH verdict.",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (_args, rt) => {
      const macro = await fetchMacroSignals();
      rt.log("info", "agent tool macro signals", {
        verdict: macro.verdict,
        bullishCount: macro.bullishCount,
        totalCount: macro.totalCount,
        unavailable: Boolean(macro.unavailable),
      });
      return {
        ok: true,
        timestamp: macro.timestamp,
        verdict: macro.verdict,
        bullishCount: macro.bullishCount,
        totalCount: macro.totalCount,
        unavailable: Boolean(macro.unavailable),
        unavailableReason: macro.unavailableReason ?? null,
        signals: {
          liquidity: {
            status: macro.signals.liquidity.status,
            value: macro.signals.liquidity.value,
          },
          flowStructure: {
            status: macro.signals.flowStructure.status,
            btcReturn5: macro.signals.flowStructure.btcReturn5,
            qqqReturn5: macro.signals.flowStructure.qqqReturn5,
          },
          macroRegime: {
            status: macro.signals.macroRegime.status,
            qqqRoc20: macro.signals.macroRegime.qqqRoc20,
            xlpRoc20: macro.signals.macroRegime.xlpRoc20,
          },
          technicalTrend: {
            status: macro.signals.technicalTrend.status,
            btcPrice: macro.signals.technicalTrend.btcPrice,
            mayerMultiple: macro.signals.technicalTrend.mayerMultiple,
          },
          hashRate: {
            status: macro.signals.hashRate.status,
            change30d: macro.signals.hashRate.change30d,
          },
          miningCost: {
            status: macro.signals.miningCost.status,
          },
          fearGreed: {
            status: macro.signals.fearGreed.status,
            value: macro.signals.fearGreed.value,
          },
        },
      };
    },
  },

  {
    name: "macro_fred_indicators",
    description:
      "Fetch macro economic indicators (Fed balance sheet/rates, yield spread, unemployment, CPI, 10Y treasury, VIX) using FRED data.",
    parameters: {
      type: "object",
      properties: {
        seriesIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional FRED series ids. Defaults to WALCL,FEDFUNDS,T10Y2Y,UNRATE,CPIAUCSL,DGS10,VIXCLS.",
        },
        observationStart: {
          type: "string",
          description: "Optional YYYY-MM-DD observation start date.",
        },
        observationEnd: {
          type: "string",
          description: "Optional YYYY-MM-DD observation end date.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const macro = await fetchMacroFredIndicators(rt.env, {
        seriesIds: normalizeStringArray(args.seriesIds, 20),
        observationStart:
          typeof args.observationStart === "string"
            ? args.observationStart
            : undefined,
        observationEnd:
          typeof args.observationEnd === "string"
            ? args.observationEnd
            : undefined,
      });
      rt.log("info", "agent tool macro fred indicators", {
        configured: macro.configured,
        seriesCount: macro.series.length,
        unavailableReason: macro.unavailableReason ?? null,
      });
      return {
        ok: true,
        timestamp: macro.timestamp,
        configured: macro.configured,
        unavailableReason: macro.unavailableReason ?? null,
        series: macro.series.slice(0, 10).map((row) => ({
          id: row.id,
          name: row.name,
          value: row.value,
          changePercent: row.changePercent,
          date: row.date,
          unit: row.unit,
        })),
      };
    },
  },

  {
    name: "macro_etf_flows",
    description:
      "Fetch BTC spot ETF proxy flow structure (price/volume-based net inflow vs outflow estimates).",
    parameters: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional ETF tickers. Defaults to SOLZ,SOLT,SSK,IBIT,FBTC,ARKB,BITB,GBTC,HODL,BRRR,EZBC,BTCO,BTCW.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const macro = await fetchMacroEtfFlows({
        tickers: normalizeStringArray(args.tickers, 20),
      });
      rt.log("info", "agent tool macro etf flows", {
        etfCount: macro.summary.etfCount,
        netDirection: macro.summary.netDirection,
        unavailable: Boolean(macro.unavailable),
      });
      return {
        ok: true,
        timestamp: macro.timestamp,
        unavailable: Boolean(macro.unavailable),
        unavailableReason: macro.unavailableReason ?? null,
        summary: macro.summary,
        etfs: macro.etfs.slice(0, 6).map((row) => ({
          ticker: row.ticker,
          issuer: row.issuer,
          price: row.price,
          priceChange: row.priceChange,
          volumeRatio: row.volumeRatio,
          direction: row.direction,
          estFlow: row.estFlow,
        })),
      };
    },
  },

  {
    name: "macro_stablecoin_health",
    description:
      "Fetch stablecoin peg-health and market-cap/volume snapshot for major USD stablecoins.",
    parameters: {
      type: "object",
      properties: {
        coins: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional CoinGecko ids. Defaults to tether,usd-coin,dai,first-digital-usd,ethena-usde.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const macro = await fetchMacroStablecoinHealth({
        coins: normalizeStringArray(args.coins, 20),
      });
      rt.log("info", "agent tool macro stablecoin health", {
        coinCount: macro.summary.coinCount,
        depeggedCount: macro.summary.depeggedCount,
        healthStatus: macro.summary.healthStatus,
      });
      return {
        ok: true,
        timestamp: macro.timestamp,
        unavailable: Boolean(macro.unavailable),
        unavailableReason: macro.unavailableReason ?? null,
        summary: macro.summary,
        stablecoins: macro.stablecoins.slice(0, 6).map((row) => ({
          id: row.id,
          symbol: row.symbol,
          price: row.price,
          deviation: row.deviation,
          pegStatus: row.pegStatus,
          change24h: row.change24h,
          marketCap: row.marketCap,
        })),
      };
    },
  },

  {
    name: "macro_oil_analytics",
    description:
      "Fetch oil and energy macro metrics (WTI, Brent, US production, US inventory) from EIA.",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (_args, rt) => {
      const macro = await fetchMacroOilAnalytics(rt.env);
      rt.log("info", "agent tool macro oil analytics", {
        configured: macro.configured,
        wti: macro.wtiPrice?.current ?? null,
        brent: macro.brentPrice?.current ?? null,
        unavailableReason: macro.unavailableReason ?? null,
      });
      return {
        ok: true,
        timestamp: macro.timestamp,
        configured: macro.configured,
        fetchedAt: macro.fetchedAt,
        unavailableReason: macro.unavailableReason ?? null,
        wtiPrice: macro.wtiPrice,
        brentPrice: macro.brentPrice,
        usProduction: macro.usProduction,
        usInventory: macro.usInventory,
      };
    },
  },

  {
    name: "backtest_run_create",
    description: `Queue a background backtest run for this bot. ${BACKTEST_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["validation", "strategy_json"],
          description: "Backtest mode. Defaults to validation.",
        },
        fixturePattern: {
          type: "string",
          enum: ["uptrend", "downtrend", "whipsaw"],
          description: "Optional validation fixture override.",
        },
        spec: {
          type: "object",
          description:
            "Required for strategy_json. Shape: { strategy, market, validation?, dataSources? }.",
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      try {
        const request = normalizeBacktestRunRequest({
          kind: args.kind ?? "validation",
          fixturePattern: args.fixturePattern,
          spec: args.spec,
        });
        const run = await enqueueBacktestRun(rt.env, {
          runId: newBacktestRunId(),
          tenantId: rt.tenantId,
          kind: request.kind,
          request,
        });
        await enqueueBacktestForTenant(rt.env, rt.tenantId);
        rt.log("info", "agent tool backtest run queued", {
          runId: run.runId,
          kind: run.kind,
        });
        return {
          ok: true,
          run: {
            runId: run.runId,
            status: run.status,
            kind: run.kind,
            queuedAt: run.queuedAt,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "backtest-create-failed";
        return { ok: false, error: message };
      }
    },
  },

  {
    name: "backtest_run_list",
    description: `List recent backtest runs for this bot. ${BACKTEST_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (1..50).",
        },
        status: {
          type: "string",
          enum: ["queued", "running", "completed", "failed", "canceled"],
        },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const limit = clampInt(args.limit, 10, 1, 50);
      const statusRaw = String(args.status ?? "").trim();
      const status =
        statusRaw === "queued" ||
        statusRaw === "running" ||
        statusRaw === "completed" ||
        statusRaw === "failed" ||
        statusRaw === "canceled"
          ? statusRaw
          : undefined;
      const runs = await listBacktestRuns(rt.env, rt.tenantId, {
        limit,
        status,
      });
      return { ok: true, runs };
    },
  },

  {
    name: "backtest_run_get",
    description: `Get one backtest run with result metadata and recent events. ${BACKTEST_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Backtest run id." },
        eventLimit: {
          type: "number",
          description: "Events to include (1..200).",
        },
      },
      required: ["runId"],
    },
    handler: async (args, rt) => {
      const runId = String(args.runId ?? "").trim();
      if (!runId) return { ok: false, error: "missing-run-id" };

      const run = await getBacktestRun(rt.env, rt.tenantId, runId);
      if (!run) return { ok: false, error: "not-found" };
      const events = await listBacktestRunEvents(
        rt.env,
        rt.tenantId,
        runId,
        clampInt(args.eventLimit, 80, 1, 200),
      );

      let result: Record<string, unknown> | null = null;
      if (run.resultRef && rt.env.LOGS_BUCKET) {
        const object = await rt.env.LOGS_BUCKET.get(run.resultRef).catch(
          () => null,
        );
        if (object) {
          const raw = await object.text().catch(() => "");
          if (raw.trim()) {
            try {
              const parsed = JSON.parse(raw);
              if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
              ) {
                result = parsed as Record<string, unknown>;
              }
            } catch {
              // ignore
            }
          }
        }
      }
      return {
        ok: true,
        run: {
          runId: run.runId,
          status: run.status,
          kind: run.kind,
          request: run.request,
          summary: run.summary,
          resultRef: run.resultRef,
          errorCode: run.errorCode,
          errorMessage: run.errorMessage,
          queuedAt: run.queuedAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        },
        result,
        events,
      };
    },
  },

  {
    name: "trades_list_recent",
    description: "List recent trades for this bot (from D1 trade_index).",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (1..200)" },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const limit = clampInt(args.limit, 10, 1, 200);
      const trades = await listTrades(rt.env, rt.tenantId, limit);
      rt.recentTrades = trades;
      return { ok: true, trades };
    },
  },

  {
    name: "memory_update_thesis",
    description:
      "Update the agent's thesis (persists between ticks). Use when your view changes.",
    parameters: {
      type: "object",
      properties: {
        thesis: { type: "string", description: "Complete updated thesis" },
        reasoning: { type: "string", description: "What changed and why" },
      },
      required: ["thesis", "reasoning"],
    },
    action: "update_thesis",
    handler: async (args, rt) => {
      const thesis = String(args.thesis ?? "");
      const reasoning = String(args.reasoning ?? "");
      rt.memory = updateThesis(rt.memory, thesis);
      if (reasoning.trim()) {
        rt.memory = addReflection(
          rt.memory,
          `Thesis update: ${reasoning.trim()}`,
        );
      }
      rt.log("info", "agent tool thesis updated", {
        reasoning: reasoning.trim(),
      });
      return { ok: true };
    },
  },

  {
    name: "memory_log_observation",
    description: "Record a market observation in memory for future reference.",
    parameters: {
      type: "object",
      properties: {
        observation: { type: "string", description: "What you observed" },
        category: {
          type: "string",
          enum: ["market", "pattern", "risk", "opportunity"],
        },
      },
      required: ["observation", "category"],
    },
    action: "log_observation",
    handler: async (args, rt) => {
      const observation = String(args.observation ?? "").trim();
      const categoryRaw = String(args.category ?? "market");
      const category =
        categoryRaw === "pattern" ||
        categoryRaw === "risk" ||
        categoryRaw === "opportunity"
          ? categoryRaw
          : "market";
      if (!observation) return { ok: false, error: "empty-observation" };
      rt.memory = appendObservation(rt.memory, {
        ts: new Date().toISOString(),
        category,
        content: observation,
      });
      rt.log("info", "agent tool observation logged", {
        category,
        observation,
      });
      return { ok: true };
    },
  },

  {
    name: "memory_add_reflection",
    description:
      "Append a short learning/reflection to memory (persists between ticks).",
    parameters: {
      type: "object",
      properties: {
        reflection: { type: "string", description: "One concise learning" },
      },
      required: ["reflection"],
    },
    action: "log_observation",
    handler: async (args, rt) => {
      const reflection = String(args.reflection ?? "").trim();
      if (!reflection) return { ok: false, error: "empty-reflection" };
      rt.memory = addReflection(rt.memory, reflection);
      rt.log("info", "agent tool reflection added");
      return { ok: true };
    },
  },

  {
    name: "trade_jupiter_swap",
    description: `Execute a Jupiter swap for this bot. Honors policy (allowed mints, price impact, caps, dryRun/simulateOnly). ${NETWORK_NOTE_MAINNET_TOOLS}`,
    parameters: {
      type: "object",
      properties: {
        inputMint: { type: "string" },
        outputMint: { type: "string" },
        amount: { type: "string", description: "Atomic units of inputMint" },
        reasoning: { type: "string", description: "Why this trade, why now" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["inputMint", "outputMint", "amount", "reasoning"],
    },
    action: "trade",
    handler: async (args, rt) => {
      const inputMint = String(args.inputMint ?? "").trim();
      const outputMint = String(args.outputMint ?? "").trim();
      const amount = String(args.amount ?? "").trim();
      const reasoning = String(args.reasoning ?? "").trim();
      const confidenceRaw = String(args.confidence ?? "low");
      const confidence =
        confidenceRaw === "high" || confidenceRaw === "medium"
          ? confidenceRaw
          : "low";

      if (!inputMint || !outputMint || !amount || !reasoning) {
        return { ok: false, error: "missing-params" };
      }
      if (!/^\d+$/.test(amount) || amount === "0") {
        return { ok: false, error: "invalid-amount" };
      }
      if (!rt.memory.thesis.trim()) {
        return { ok: false, error: "missing-thesis" };
      }
      const mandateProfile = inferMandateProfile(rt.strategy.mandate);
      rt.log("debug", "mandate-driven trade gating", {
        aggressive: mandateProfile.aggressive,
        opportunistic: mandateProfile.opportunistic,
        configuredMinConfidence: rt.strategy.minConfidence ?? null,
        confidence,
      });

      // Basic balance checks (best-effort). Policy enforcement still happens on the quote.
      const reserveLamports = BigInt(rt.policy.minSolReserveLamports);
      const solBalanceLamports = await rt.rpc.getBalanceLamports(rt.wallet);
      const amountAtomic = BigInt(amount);
      if (inputMint === SOL_MINT) {
        const needed = amountAtomic + reserveLamports;
        if (solBalanceLamports < needed) {
          rt.log("warn", "insufficient SOL for trade (after reserve)", {
            solBalanceLamports: solBalanceLamports.toString(),
            reserveLamports: reserveLamports.toString(),
            amount,
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-sol" };
        }
      } else {
        if (solBalanceLamports < reserveLamports) {
          rt.log("warn", "insufficient SOL for fees (reserve)", {
            solBalanceLamports: solBalanceLamports.toString(),
            reserveLamports: reserveLamports.toString(),
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-sol-reserve" };
        }
        const inBal = await rt.rpc.getTokenBalanceAtomic(rt.wallet, inputMint);
        if (inBal < amountAtomic) {
          rt.log("warn", "insufficient input token balance", {
            mint: inputMint,
            have: inBal.toString(),
            need: amount,
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-input-balance" };
        }
      }

      const quote = await rt.jupiter.quote({
        inputMint,
        outputMint,
        amount,
        slippageBps: rt.policy.slippageBps,
        swapMode: "ExactIn",
      });
      enforcePolicy(rt.policy, quote);

      // Count trade attempts once we've got a valid quote.
      rt.memory.tradesProposedToday += 1;
      rt.memory.lastTradeDate = new Date().toISOString().slice(0, 10);
      rt.tradeExecuted = true;

      rt.log("info", "agent tool trade quote", {
        ...quoteSummary(quote as Record<string, unknown>),
        reasoning,
        confidence,
      });

      if (rt.policy.dryRun) {
        await insertTradeIndex(rt.env, {
          tenantId: rt.tenantId,
          runId: rt.runId,
          venue: "jupiter",
          market: `${quote.inputMint}->${quote.outputMint}`,
          side: "agent_swap",
          size: quote.inAmount,
          price: quote.outAmount,
          status: "dry_run",
          logKey: rt.logKey,
          signature: null,
          reasoning,
        });
        return {
          ok: true,
          status: "dry_run",
          quote: quoteSummary(quote as Record<string, unknown>),
        };
      }

      const executionResult = await executeSwapViaRouter({
        env: rt.env,
        execution: rt.execution,
        policy: rt.policy,
        rpc: rt.rpc,
        jupiter: rt.jupiter,
        quoteResponse: quote,
        userPublicKey: rt.wallet,
        privyWalletId: rt.privyWalletId,
        log: rt.log,
        guardEnabled: async () => {
          await assertLoopStillEnabled(rt.env, rt.log, rt.configTenantId);
        },
      });

      if (executionResult.refreshed) {
        rt.log("warn", "agent: quote refreshed due to swap 422", {
          inAmount: executionResult.usedQuote.inAmount,
          outAmount: executionResult.usedQuote.outAmount,
        });
      }

      await insertTradeIndex(rt.env, {
        tenantId: rt.tenantId,
        runId: rt.runId,
        venue: "jupiter",
        market: `${executionResult.usedQuote.inputMint}->${executionResult.usedQuote.outputMint}`,
        side: "agent_swap",
        size: executionResult.usedQuote.inAmount,
        price: executionResult.usedQuote.outAmount,
        status: executionResult.status,
        logKey: rt.logKey,
        signature: executionResult.signature,
        reasoning,
      });

      return {
        ok: executionResult.status !== "error",
        signature: executionResult.signature,
        status: executionResult.status,
        err: executionResult.err ?? null,
      };
    },
  },
];

async function assertLoopStillEnabled(
  env: Env,
  log: LogFn,
  tenantId?: string,
): Promise<void> {
  const config = await getLoopConfig(env, tenantId);
  if (!config.enabled) {
    log("warn", "loop disabled during tick, aborting before execution");
    throw new Error("loop-disabled");
  }
  const p = normalizePolicy(config.policy);
  if (p.killSwitch) {
    log("warn", "kill switch enabled during tick, aborting before execution");
    throw new Error("kill-switch-enabled");
  }
}
