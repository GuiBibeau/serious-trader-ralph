import { requireUser } from "./auth";
import { getAgentByName, routeAgentRequest } from "agents";

export { BacktestQueue } from "./backtest_queue_do";
export { BotLoop } from "./bot_loop_do";
export { TradingOrchestratorAgent } from "./agents_runtime/trading_orchestrator_agent";

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
import {
  getUserSubscription,
  isSubscriptionActive,
  toSubscriptionView,
} from "./billing";
import { listRecentBotEvents } from "./bot_events";
import { computeBotCreationLimits, MAX_FREE_BOTS } from "./bot_limits";
import {
  enqueueSteeringMessage,
  listSteeringMessages,
} from "./agents_runtime/runtime_repo";
import type { UserRow } from "./bots_db";
import {
  createBotRow,
  findUserByPrivyUserId,
  getBotById,
  getBotForUser,
  listEnabledBots,
  listBotsForUser,
  setBotEnabledById,
  setBotEnabledForUser,
  setUserOnboardingStatus,
  setUserProfile,
  upsertUser,
} from "./bots_db";
import { getLoopConfig, requireAdmin, updateLoopConfig } from "./config";
import {
  handleChatHistory,
  handleChatRequest,
  handleTelemetry,
} from "./conversation/router";
import type { ConversationRequest } from "./conversation/types";
import { USDC_MINT } from "./defaults";
import { fetchHistoricalOhlcvRuntime } from "./historical_ohlcv";
import {
  assertBotInferenceProviderHealthy,
  getBotInferenceProviderView,
  patchBotInferenceProvider,
  pingBotInferenceProvider,
  pingInferenceProviderConfig,
  setBotInferenceProvider,
} from "./inference_provider";
import { JupiterClient } from "./jupiter";
import { computeMarketIndicators } from "./market_indicators";
import {
  fetchMacroEtfFlows,
  fetchMacroFredIndicators,
  fetchMacroOilAnalytics,
  fetchMacroSignals,
  fetchMacroStablecoinHealth,
} from "./macro_sources";
import { getAgentMemory, saveAgentMemory } from "./memory";
import { normalizePolicy } from "./policy";
import { createPrivySolanaWallet } from "./privy";
import { gatherMarketSnapshot } from "./research";
import { json, okCors, withCors } from "./response";
import { SolanaRpc } from "./solana_rpc";
import {
  checkStrategyStartGate,
  markStrategyCandidateFromConfigChange,
  maybeRevalidateAndTuneForTenant,
  runValidationForTenant,
} from "./strategy_validation/engine";
import {
  getLatestValidation,
  getRuntimeState,
  listStrategyEvents,
  listValidationRuns,
  recordStrategyEvent,
  updateRuntimeState,
} from "./strategy_validation/repo";
import { listTrades } from "./trade_index";
import type { Env } from "./types";
import {
  validateAutotuneConfig,
  validateDataSourcesConfig,
  validateExecutionConfig,
  validatePolicy,
  validateStrategy,
  validateValidationConfig,
} from "./validation";
import { requireX402Payment, withX402SettlementHeader } from "./x402";

const X402_READ_RPC_ENDPOINT_FALLBACK = "https://api.mainnet-beta.solana.com";
const X402_READ_JUPITER_BASE_URL = "https://lite-api.jup.ag";
const X402_SOL_MINT = "So11111111111111111111111111111111111111112";

function resolveX402ReadRpcEndpoint(env: Env): string {
  const balanceRpc = String(env.BALANCE_RPC_ENDPOINT ?? "").trim();
  if (balanceRpc) return balanceRpc;
  const rpc = String(env.RPC_ENDPOINT ?? "").trim();
  if (rpc) return rpc;
  return X402_READ_RPC_ENDPOINT_FALLBACK;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === "OPTIONS") {
      return okCors(env);
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return withCors(json({ ok: true }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/waitlist") {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
      }

      if (env.TRADING_ORCHESTRATOR) {
        const routed = await routeAgentRequest(request, env);
        if (routed) return routed;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_snapshot"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_snapshot",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }

        const quoteMintRaw = String(payload.quoteMint ?? "").trim();
        const quoteDecimalsRaw = Number(payload.quoteDecimals);
        const quoteDecimals = Number.isFinite(quoteDecimalsRaw)
          ? quoteDecimalsRaw
          : undefined;

        // Public x402 read routes always serve mainnet market data.
        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const snapshot = await gatherMarketSnapshot(
          rpc,
          jupiter,
          walletAddress,
          normalizePolicy(undefined),
          {
            quoteMint: quoteMintRaw || undefined,
            quoteDecimals,
          },
        );
        const base = json({ ok: true, snapshot });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_snapshot",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_snapshot_v2"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_snapshot_v2",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.trackedMints !== undefined &&
          !Array.isArray(payload.trackedMints)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-snapshot-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const quoteMintRaw = String(payload.quoteMint ?? "").trim();
        const quoteDecimalsRaw = Number(payload.quoteDecimals);
        const quoteDecimals = Number.isFinite(quoteDecimalsRaw)
          ? quoteDecimalsRaw
          : undefined;
        const trackedMints = toUniqueStrings(payload.trackedMints, 32);

        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const snapshot = await gatherMarketSnapshot(
          rpc,
          jupiter,
          walletAddress,
          normalizePolicy(undefined),
          {
            quoteMint: quoteMintRaw || undefined,
            quoteDecimals,
          },
        );

        const balanceMints = Array.from(
          new Set([X402_SOL_MINT, snapshot.quoteMint, ...trackedMints]),
        );
        const balances = await Promise.all(
          balanceMints.map(async (mint) => {
            const balanceAtomic =
              mint === X402_SOL_MINT
                ? await rpc.getBalanceLamports(walletAddress)
                : await rpc.getTokenBalanceAtomic(walletAddress, mint);
            return {
              mint,
              balanceAtomic: balanceAtomic.toString(),
            };
          }),
        );

        const base = json({ ok: true, snapshot, balances });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_snapshot_v2",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_token_balance"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_token_balance",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        const mint = String(payload.mint ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }
        if (!mint) {
          return withCors(
            json({ ok: false, error: "missing-mint" }, { status: 400 }),
            env,
          );
        }

        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const balanceAtomic =
          mint === X402_SOL_MINT
            ? await rpc.getBalanceLamports(walletAddress)
            : await rpc.getTokenBalanceAtomic(walletAddress, mint);
        const base = json({
          ok: true,
          balance: {
            walletAddress,
            mint,
            balanceAtomic: balanceAtomic.toString(),
            ts: new Date().toISOString(),
          },
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_token_balance",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_jupiter_quote"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_jupiter_quote",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const inputMint = String(payload.inputMint ?? "").trim();
        const outputMint = String(payload.outputMint ?? "").trim();
        const amount = String(payload.amount ?? "").trim();
        const slippageBpsRaw = Number(payload.slippageBps);
        const slippageBps = Number.isFinite(slippageBpsRaw)
          ? Math.max(1, Math.min(5_000, Math.floor(slippageBpsRaw)))
          : 50;
        if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
          return withCors(
            json(
              { ok: false, error: "invalid-quote-request" },
              { status: 400 },
            ),
            env,
          );
        }

        // Public x402 read routes always serve mainnet market data.
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const quote = await jupiter.quote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          swapMode: "ExactIn",
        });
        const base = json({ ok: true, quote });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_jupiter_quote",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_jupiter_quote_batch"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_jupiter_quote_batch",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const requests = Array.isArray(payload.requests)
          ? payload.requests
          : null;
        if (!requests || requests.length < 1 || requests.length > 20) {
          return withCors(
            json(
              { ok: false, error: "invalid-quote-batch-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const results: Array<Record<string, unknown>> = [];
        let successCount = 0;
        for (let index = 0; index < requests.length; index += 1) {
          const item = requests[index];
          if (!isRecord(item)) {
            results.push({ ok: false, index, error: "invalid-quote-request" });
            continue;
          }

          const inputMint = String(item.inputMint ?? "").trim();
          const outputMint = String(item.outputMint ?? "").trim();
          const amount = String(item.amount ?? "").trim();
          const slippageBps = toBoundedInt(item.slippageBps, 50, 1, 5_000);
          if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
            results.push({ ok: false, index, error: "invalid-quote-request" });
            continue;
          }

          try {
            const quote = await jupiter.quote({
              inputMint,
              outputMint,
              amount,
              slippageBps,
              swapMode: "ExactIn",
            });
            successCount += 1;
            results.push({
              ok: true,
              index,
              quote: summarizeJupiterQuote(quote as Record<string, unknown>),
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "quote-failed";
            results.push({ ok: false, index, error: "quote-failed", message });
          }
        }

        if (successCount < 1) {
          return withCors(
            json(
              {
                ok: false,
                error: "quote-batch-failed",
                results,
              },
              { status: 503 },
            ),
            env,
          );
        }

        const base = json({
          ok: true,
          successCount,
          errorCount: requests.length - successCount,
          results,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_jupiter_quote_batch",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_ohlcv"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_ohlcv",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        let ohlcv;
        try {
          ohlcv = await fetchHistoricalOhlcvRuntime(env, payload, {
            defaultLookbackHours: 168,
            defaultLimit: 168,
            minLookbackHours: 24,
            maxLookbackHours: 720,
            minLimit: 24,
            maxLimit: 720,
            requireMints: true,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "ohlcv-fetch-failed";
          if (message === "invalid-ohlcv-request") {
            return withCors(
              json(
                { ok: false, error: "invalid-ohlcv-request" },
                { status: 400 },
              ),
              env,
            );
          }
          return withCors(
            json({ ok: false, error: "ohlcv-fetch-failed" }, { status: 503 }),
            env,
          );
        }

        const base = json({ ok: true, ohlcv });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_ohlcv",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_indicators"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "market_indicators",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        let ohlcv;
        try {
          ohlcv = await fetchHistoricalOhlcvRuntime(env, payload, {
            defaultLookbackHours: 168,
            defaultLimit: 168,
            minLookbackHours: 24,
            maxLookbackHours: 720,
            minLimit: 24,
            maxLimit: 720,
            requireMints: true,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "indicators-fetch-failed";
          if (message === "invalid-ohlcv-request") {
            return withCors(
              json(
                { ok: false, error: "invalid-indicators-request" },
                { status: 400 },
              ),
              env,
            );
          }
          return withCors(
            json(
              { ok: false, error: "indicators-fetch-failed" },
              { status: 503 },
            ),
            env,
          );
        }

        const indicators = computeMarketIndicators(ohlcv.bars);
        const base = json({ ok: true, ohlcv, indicators });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_indicators",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_signals"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "macro_signals",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const macro = await fetchMacroSignals();
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_signals",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_fred_indicators"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "macro_fred_indicators",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (
          payload.seriesIds !== undefined &&
          !Array.isArray(payload.seriesIds)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.observationStart !== undefined &&
          typeof payload.observationStart !== "string"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.observationEnd !== undefined &&
          typeof payload.observationEnd !== "string"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroFredIndicators(env, {
          seriesIds: toUniqueStrings(payload.seriesIds, 20),
          observationStart:
            typeof payload.observationStart === "string"
              ? payload.observationStart
              : undefined,
          observationEnd:
            typeof payload.observationEnd === "string"
              ? payload.observationEnd
              : undefined,
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_fred_indicators",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_etf_flows"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "macro_etf_flows",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (payload.tickers !== undefined && !Array.isArray(payload.tickers)) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-etf-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroEtfFlows({
          tickers: toUniqueStrings(payload.tickers, 20),
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_etf_flows",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_stablecoin_health"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "macro_stablecoin_health",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (payload.coins !== undefined && !Array.isArray(payload.coins)) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-stablecoin-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroStablecoinHealth({
          coins: toUniqueStrings(payload.coins, 20),
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_stablecoin_health",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_oil_analytics"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = requireX402Payment(
            request,
            env,
            "macro_oil_analytics",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const macro = await fetchMacroOilAnalytics(env);
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_oil_analytics",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        let user = await requireOnboardedUser(request, env);
        const [bots, subscription] = await Promise.all([
          listBotsForUser(env, user.id),
          getUserSubscription(env, user.id),
        ]);
        const onboardingStatus =
          user.onboardingStatus === "active" ||
          isSubscriptionActive(subscription)
            ? "active"
            : "being_onboarded";
        if (onboardingStatus !== user.onboardingStatus) {
          await setUserOnboardingStatus(env, user.id, onboardingStatus).catch(
            () => {},
          );
          user = { ...user, onboardingStatus };
        }
        const botLimits = await computeBotCreationLimits(env, bots, {
          strictValuation: false,
        });
        return withCors(
          json({
            ok: true,
            user,
            onboardingStatus,
            workspaceStatus: onboardingStatus,
            bots,
            subscription: toSubscriptionView(env, subscription),
            limits: {
              botCreation: {
                maxFreeBots: botLimits.maxFreeBots,
                requiredUsdForExtraBots: botLimits.requiredUsdForExtraBots,
                currentUsd: botLimits.currentUsd,
                canCreateExtraBot: botLimits.canCreateExtraBot,
                assetBasis: botLimits.assetBasis,
                valuationState: botLimits.valuationState,
              },
            },
          }),
          env,
        );
      }

      if (request.method === "PATCH" && url.pathname === "/api/me/profile") {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const profile = payload.profile;
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
          return withCors(
            json({ ok: false, error: "invalid-profile" }, { status: 400 }),
            env,
          );
        }
        await setUserProfile(env, user.id, profile as Record<string, unknown>);
        return withCors(json({ ok: true }), env);
      }

      if (request.method === "GET" && url.pathname === "/api/billing/plans") {
        const user = await requireOnboardedUser(request, env);
        const subscription = await getUserSubscription(env, user.id);
        return withCors(
          json({
            ok: true,
            plans: [],
            mode: "manual_onboarding",
            subscription: toSubscriptionView(env, subscription),
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/checkout"
      ) {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/billing/checkout/")
      ) {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
      }

      if (url.pathname === "/api/bots" && request.method === "GET") {
        const user = await requireOnboardedUser(request, env);
        const bots = await listBotsForUser(env, user.id);
        return withCors(json({ ok: true, bots }), env);
      }

      if (url.pathname === "/api/bots" && request.method === "POST") {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const createInput = parseCreateBotPayload(payload);
        await pingInferenceProviderConfig({
          providerKind: createInput.providerKind,
          baseUrl: createInput.baseUrl,
          model: createInput.model,
          apiKey: createInput.apiKey,
        });
        const existingBots = await listBotsForUser(env, user.id);

        if (existingBots.length >= MAX_FREE_BOTS) {
          const limits = await computeBotCreationLimits(env, existingBots, {
            strictValuation: true,
          });
          if (!limits.canCreateExtraBot) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "bot-cap-threshold-not-met",
                  maxFreeBots: limits.maxFreeBots,
                  requiredUsd: limits.requiredUsdForExtraBots,
                  currentUsd: limits.currentUsd,
                  assetBasis: limits.assetBasis,
                },
                { status: 403 },
              ),
              env,
            );
          }
        }

        const wallet = await createPrivySolanaWallet(env);
        const bot = await createBotRow(env, {
          userId: user.id,
          name: createInput.name,
          enabled: false,
          signerType: "privy",
          privyWalletId: wallet.walletId,
          walletAddress: wallet.address,
        });

        const provider = await setBotInferenceProvider(
          env,
          {
            botId: bot.id,
            providerKind: createInput.providerKind,
            baseUrl: createInput.baseUrl,
            model: createInput.model,
            apiKey: createInput.apiKey,
          },
          { skipPing: true },
        );
        await updateLoopConfig(env, { enabled: false }, bot.id);

        const nextBots = [bot, ...existingBots];
        const nextLimits = await computeBotCreationLimits(env, nextBots, {
          strictValuation: false,
        });
        return withCors(
          json({
            ok: true,
            bot,
            inferenceProvider: provider,
            limits: {
              botCreation: {
                maxFreeBots: nextLimits.maxFreeBots,
                requiredUsdForExtraBots: nextLimits.requiredUsdForExtraBots,
                currentUsd: nextLimits.currentUsd,
                canCreateExtraBot: nextLimits.canCreateExtraBot,
                assetBasis: nextLimits.assetBasis,
                valuationState: nextLimits.valuationState,
              },
            },
          }),
          env,
        );
      }

      // Bot actions: /api/bots/:id/(start|stop|tick|config|trades)
      if (url.pathname.startsWith("/api/bots/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const botId = parts[2] ?? "";
        const action = parts[3] ?? "";
        if (!botId) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }

        const user = await requireOnboardedUser(request, env);
        const bot = await getBotForUser(env, user.id, botId);
        if (!bot) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }

        if (request.method === "GET" && !action) {
          return withCors(json({ ok: true, bot }), env);
        }

        if (action === "inference") {
          if (request.method === "GET") {
            const provider = await getBotInferenceProviderView(env, bot.id);
            return withCors(json({ ok: true, provider }), env);
          }
          if (request.method === "POST" && parts[4] === "ping") {
            const payload = await readPayload(request);
            const pingInput = parseInferencePingPayload(payload);
            await pingBotInferenceProvider(env, {
              botId: bot.id,
              ...pingInput,
            });
            return withCors(json({ ok: true, ping: "ok" }), env);
          }
          if (request.method === "PATCH") {
            const payload = await readPayload(request);
            const patch = parseInferencePatchPayload(payload);
            let provider;
            try {
              provider = await patchBotInferenceProvider(env, {
                botId: bot.id,
                ...patch,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              if (message !== "inference-provider-not-configured") throw error;
              if (
                patch.baseUrl === undefined ||
                patch.model === undefined ||
                patch.apiKey === undefined
              ) {
                throw new Error("missing-inference-provider-config");
              }
              provider = await setBotInferenceProvider(env, {
                botId: bot.id,
                providerKind: patch.providerKind,
                baseUrl: patch.baseUrl,
                model: patch.model,
                apiKey: patch.apiKey,
              });
            }
            return withCors(json({ ok: true, provider }), env);
          }
        }

        if (request.method === "POST" && action === "start") {
          const gate = await ensureManualAccess(env, user.id);
          if (gate) return withCors(gate, env);
          let providerHealthy = true;
          let providerError = "inference-provider-unreachable";
          try {
            await assertBotInferenceProviderHealthy(env, botId);
          } catch (error) {
            providerHealthy = false;
            const message =
              error instanceof Error ? error.message : String(error);
            providerError = message;
            if (
              message !== "inference-provider-not-configured" &&
              message !== "inference-provider-unreachable"
            ) {
              throw error;
            }
          }
          if (!providerHealthy) {
            return withCors(
              json(
                { ok: false, error: providerError },
                { status: 409 },
              ),
              env,
            );
          }
          const config = await getLoopConfig(env, botId);
          const validationGate = await checkStrategyStartGate(
            env,
            botId,
            config,
          );
          if (!validationGate.ok) {
            return withCors(
              json(
                {
                  ok: false,
                  error: validationGate.reason ?? "strategy-not-validated",
                },
                { status: 409 },
              ),
              env,
            );
          }
          const nextBot = await setBotEnabledForUser(env, user.id, botId, true);
          try {
            const payload = (await botLoopFetchJson(env, botId, "/start", {
              method: "POST",
            })) as { config?: unknown };
            return withCors(
              json({ ok: true, bot: nextBot, config: payload.config }),
              env,
            );
          } catch (err) {
            // Rollback the enabled flag if the DO refused to start.
            await setBotEnabledForUser(env, user.id, botId, false).catch(
              () => {},
            );
            throw err;
          }
        }

        if (request.method === "POST" && action === "validate") {
          const gate = await ensureManualAccess(env, user.id);
          if (gate) return withCors(gate, env);
          const payload = await readPayload(request);
          const fixturePatternRaw = String(payload.fixturePattern ?? "").trim();
          const fixturePattern =
            fixturePatternRaw === "uptrend" ||
            fixturePatternRaw === "downtrend" ||
            fixturePatternRaw === "whipsaw"
              ? fixturePatternRaw
              : undefined;
          const result = await runValidationForTenant(env, botId, {
            actor: "user",
            reason: "manual-validate",
            fixturePattern,
          });
          ctx.waitUntil(
            botLoopFetchJson(env, botId, "/ensure", {
              method: "POST",
            }).catch(() => {}),
          );
          return withCors(json({ ok: true, validation: result }), env);
        }

        if (request.method === "GET" && action === "validation" && !parts[4]) {
          const latest = await getLatestValidation(env, botId);
          return withCors(json({ ok: true, validation: latest }), env);
        }

        if (
          request.method === "GET" &&
          action === "validation" &&
          parts[4] === "runs"
        ) {
          const limitRaw = url.searchParams.get("limit") ?? "20";
          const limit = Number(limitRaw);
          const runs = await listValidationRuns(
            env,
            botId,
            Number.isFinite(limit) ? limit : 20,
          );
          return withCors(json({ ok: true, runs }), env);
        }

        if (action === "backtests") {
          if (request.method === "POST" && !parts[4]) {
            const gate = await ensureManualAccess(env, user.id);
            if (gate) return withCors(gate, env);
            const payload = await readPayload(request);
            const runRequest = normalizeBacktestRunRequest(payload);
            const run = await enqueueBacktestRun(env, {
              runId: newBacktestRunId(),
              tenantId: botId,
              kind: runRequest.kind,
              request: runRequest,
            });
            ctx.waitUntil(
              backtestQueueFetchJson(env, botId, "/enqueue", {
                method: "POST",
              }).catch(() => {}),
            );
            return withCors(
              json({
                ok: true,
                run: {
                  runId: run.runId,
                  status: run.status,
                  queuedAt: run.queuedAt,
                },
              }),
              env,
            );
          }

          if (request.method === "GET" && !parts[4]) {
            const limitRaw = Number(url.searchParams.get("limit") ?? "20");
            const statusRaw = String(
              url.searchParams.get("status") ?? "",
            ).trim();
            const status =
              statusRaw === "queued" ||
              statusRaw === "running" ||
              statusRaw === "completed" ||
              statusRaw === "failed" ||
              statusRaw === "canceled"
                ? statusRaw
                : undefined;
            const runs = await listBacktestRuns(env, botId, {
              limit: Number.isFinite(limitRaw) ? limitRaw : 20,
              status,
            });
            return withCors(json({ ok: true, runs }), env);
          }

          if (request.method === "GET" && parts[4]) {
            const runId = String(parts[4] ?? "").trim();
            if (!runId) {
              return withCors(
                json({ ok: false, error: "not-found" }, { status: 404 }),
                env,
              );
            }

            if (parts[5] === "events") {
              const limitRaw = Number(url.searchParams.get("limit") ?? "200");
              const events = await listBacktestRunEvents(
                env,
                botId,
                runId,
                Number.isFinite(limitRaw) ? limitRaw : 200,
              );
              return withCors(json({ ok: true, events }), env);
            }

            const run = await getBacktestRun(env, botId, runId);
            if (!run) {
              return withCors(
                json({ ok: false, error: "not-found" }, { status: 404 }),
                env,
              );
            }
            const events = await listBacktestRunEvents(env, botId, runId, 80);
            let result: Record<string, unknown> | null = null;
            if (run.resultRef && env.LOGS_BUCKET) {
              const object = await env.LOGS_BUCKET.get(run.resultRef).catch(
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
                    // best effort
                  }
                }
              }
            }
            if (!result) {
              const completionEvent = [...events]
                .reverse()
                .find((event) => event.message === "backtest-run-completed");
              if (
                completionEvent?.meta?.result &&
                typeof completionEvent.meta.result === "object" &&
                !Array.isArray(completionEvent.meta.result)
              ) {
                result = completionEvent.meta.result as Record<string, unknown>;
              }
            }

            return withCors(
              json({
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
                  createdAt: run.createdAt,
                  strategyLabel:
                    run.summary?.strategyLabel ??
                    (run.kind === "validation"
                      ? "validation"
                      : String(
                          (run.request.kind === "strategy_json" &&
                          run.request.spec &&
                          typeof run.request.spec.strategy === "object"
                            ? (
                                run.request.spec.strategy as Record<
                                  string,
                                  unknown
                                >
                              ).type
                            : "strategy_json") ?? "strategy_json",
                        )),
                },
                result,
                events,
              }),
              env,
            );
          }
        }

        if (request.method === "POST" && action === "stop") {
          // Stop should take effect as fast as possible; disable config first.
          let config: unknown = null;
          try {
            const payload = (await botLoopFetchJson(env, botId, "/stop", {
              method: "POST",
            })) as { config?: unknown };
            config = payload.config ?? null;
          } catch {
            // Safety fallback: disable config even if DO isn't reachable.
            config = await updateLoopConfig(env, { enabled: false }, botId);
          }
          const nextBot = await setBotEnabledForUser(
            env,
            user.id,
            botId,
            false,
          );
          return withCors(json({ ok: true, bot: nextBot, config }), env);
        }

        if (request.method === "POST" && action === "tick") {
          const gate = await ensureManualAccess(env, user.id);
          if (gate) return withCors(gate, env);
          await botLoopFetchJson(env, botId, "/tick", { method: "POST" });
          return withCors(json({ ok: true, submitted: true }), env);
        }

        if (action === "config") {
          if (request.method === "GET") {
            const config = await getLoopConfig(env, botId);
            if (bot.enabled && config.enabled) {
              ctx.waitUntil(
                botLoopFetchJson(env, botId, "/ensure", {
                  method: "POST",
                }).catch(() => {}),
              );
            }
            return withCors(json({ ok: true, config }), env);
          }
          if (request.method === "PATCH") {
            const payload = await readPayload(request);
            if (payload.enabled === true || payload.runNow === true) {
              const gate = await ensureManualAccess(env, user.id);
              if (gate) return withCors(gate, env);
            }
            const beforeConfig = await getLoopConfig(env, botId);
            const doPayload = (await botLoopFetchJson(env, botId, "/config", {
              method: "PATCH",
              body: JSON.stringify(payload),
            })) as { config?: unknown };
            const afterConfig =
              doPayload.config &&
              typeof doPayload.config === "object" &&
              !Array.isArray(doPayload.config)
                ? (doPayload.config as import("./types").LoopConfig)
                : await getLoopConfig(env, botId);
            await markStrategyCandidateFromConfigChange(env, botId, {
              actor: "user",
              reason: "config-patch",
              beforeConfig,
              afterConfig,
            }).catch(() => {});
            return withCors(json({ ok: true, config: doPayload.config }), env);
          }
        }

        if (request.method === "GET" && action === "trades") {
          const limitRaw = url.searchParams.get("limit") ?? "50";
          const limit = Number(limitRaw);
          const trades = await listTrades(
            env,
            botId,
            Number.isFinite(limit) ? limit : 50,
          );
          return withCors(json({ ok: true, trades }), env);
        }

        if (request.method === "GET" && action === "balance") {
          if (!env.BALANCE_RPC_ENDPOINT) {
            return withCors(
              json(
                { ok: false, error: "rpc-endpoint-missing" },
                { status: 500 },
              ),
              env,
            );
          }
          const rpc = new SolanaRpc(env.BALANCE_RPC_ENDPOINT);

          let lamports = 0n;
          let usdcAtomic = 0n;
          const balanceErrors: string[] = [];

          try {
            lamports = await rpc.getBalanceLamports(bot.walletAddress);
          } catch (error) {
            balanceErrors.push(
              `sol:${error instanceof Error ? error.message : String(error)}`,
            );
          }

          try {
            usdcAtomic = await rpc.getTokenBalanceAtomic(
              bot.walletAddress,
              USDC_MINT,
            );
          } catch (error) {
            balanceErrors.push(
              `usdc:${error instanceof Error ? error.message : String(error)}`,
            );
          }

          return withCors(
            json({
              ok: true,
              balances: {
                sol: {
                  lamports: lamports.toString(),
                  display: (Number(lamports) / 1e9)
                    .toFixed(9)
                    .replace(/0+$/, "")
                    .replace(/\.$/, ".0"),
                },
                usdc: {
                  atomic: usdcAtomic.toString(),
                  display: (Number(usdcAtomic) / 1e6)
                    .toFixed(6)
                    .replace(/0+$/, "")
                    .replace(/\.$/, ".0"),
                },
              },
              ...(balanceErrors.length > 0
                ? { errors: balanceErrors }
                : Object.create(null)),
            }),
            env,
          );
        }

        if (request.method === "GET" && action === "events") {
          const limitRaw = url.searchParams.get("limit") ?? "40";
          const limit = Number(limitRaw);
          const events = await listRecentBotEvents(env, {
            tenantId: botId,
            limit: Number.isFinite(limit)
              ? Math.max(1, Math.min(120, limit))
              : 40,
          });
          return withCors(json({ ok: true, events }), env);
        }

        if (action === "steering") {
          if (request.method === "POST") {
            const payload = await readPayload(request);
            const message = String(payload.message ?? "").trim();
            if (!message) {
              return withCors(
                json(
                  { ok: false, error: "invalid-steering-message" },
                  { status: 400 },
                ),
                env,
              );
            }
            const queued = await enqueueSteeringMessage(env, {
              botId,
              message,
            });
            return withCors(
              json({
                ok: true,
                queued: true,
                queueId: queued.queueId,
                queuePosition: queued.queuePosition,
              }),
              env,
            );
          }
          if (request.method === "GET") {
            const limitRaw = Number(url.searchParams.get("limit") ?? "50");
            const steering = await listSteeringMessages(
              env,
              botId,
              Number.isFinite(limitRaw) ? limitRaw : 50,
            );
            return withCors(json({ ok: true, messages: steering }), env);
          }
        }

        if (request.method === "POST" && action === "chat") {
          const payload = (await readPayload(request)) as ConversationRequest;
          const chat = await handleChatRequest(env, botId, payload);
          return withCors(json({ ok: true, ...chat }), env);
        }

        if (request.method === "GET" && action === "chat") {
          const history = await handleChatHistory(env, botId, request);
          return withCors(json(history), env);
        }

        if (request.method === "GET" && action === "telemetry") {
          const telemetry = await handleTelemetry(env, botId, request);
          return withCors(json(telemetry), env);
        }

        if (
          request.method === "GET" &&
          action === "strategy" &&
          parts[4] === "events"
        ) {
          const limitRaw = url.searchParams.get("limit") ?? "40";
          const limit = Number(limitRaw);
          const events = await listStrategyEvents(
            env,
            botId,
            Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 40,
          );
          return withCors(json({ ok: true, events }), env);
        }

        if (action === "agent" && parts[4] === "memory") {
          if (request.method === "GET") {
            const memory = await getAgentMemory(env, bot.id);
            return withCors(json({ ok: true, memory }), env);
          }
          if (request.method === "PATCH") {
            const payload = await readPayload(request);
            const memory = await getAgentMemory(env, bot.id);
            if (typeof payload.thesis === "string") {
              memory.thesis = payload.thesis;
            }
            if (typeof payload.mandate === "string") {
              // Mandate is stored in the strategy config, not memory.
              // We update it via the loop config.
              const config = await getLoopConfig(env, bot.id);
              const strat = config.strategy;
              if (
                strat &&
                typeof strat === "object" &&
                (strat as Record<string, unknown>).type === "agent"
              ) {
                (strat as Record<string, unknown>).mandate = payload.mandate;
                await updateLoopConfig(
                  env,
                  { strategy: strat as import("./types").StrategyConfig },
                  bot.id,
                );
              }
            }
            await saveAgentMemory(env, bot.id, memory);
            return withCors(json({ ok: true, memory }), env);
          }
        }
      }

      if (request.method === "GET" && url.pathname === "/api/loop/status") {
        return withCors(
          json(
            { ok: false, error: "legacy-loop-runtime-disabled" },
            { status: 410 },
          ),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/loop/start") {
        requireAdmin(request, env);
        return withCors(
          json(
            { ok: false, error: "legacy-loop-runtime-disabled" },
            { status: 410 },
          ),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/loop/stop") {
        requireAdmin(request, env);
        return withCors(
          json(
            { ok: false, error: "legacy-loop-runtime-disabled" },
            { status: 410 },
          ),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/config") {
        requireAdmin(request, env);
        const payload = await readPayload(request);
        const runNow = Boolean(payload.runNow);
        const adminUpdate: Partial<import("./types").LoopConfig> = {};
        if (payload.policy !== undefined) {
          validatePolicy(payload.policy);
          adminUpdate.policy = payload.policy as import("./types").LoopPolicy;
        }
        if (payload.strategy && typeof payload.strategy === "object") {
          validateStrategy(payload.strategy);
          adminUpdate.strategy =
            payload.strategy as import("./types").StrategyConfig;
        }
        if (payload.validation !== undefined) {
          validateValidationConfig(payload.validation);
          adminUpdate.validation =
            payload.validation as import("./types").LoopValidationConfig;
        }
        if (payload.autotune !== undefined) {
          validateAutotuneConfig(payload.autotune);
          adminUpdate.autotune =
            payload.autotune as import("./types").LoopAutotuneConfig;
        }
        if (payload.execution !== undefined) {
          validateExecutionConfig(payload.execution);
          adminUpdate.execution =
            payload.execution as import("./types").ExecutionConfig;
        }
        if (payload.dataSources !== undefined) {
          validateDataSourcesConfig(payload.dataSources);
          adminUpdate.dataSources =
            payload.dataSources as import("./types").DataSourcesConfig;
        }
        const config = await updateLoopConfig(env, adminUpdate);
        return withCors(
          json({
            ok: true,
            config,
            ...(runNow
              ? {
                  runNowIgnored: true,
                  note: "runNow is disabled; trigger per-bot start/tick through the orchestrator runtime",
                }
              : Object.create(null)),
          }),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/loop/tick") {
        requireAdmin(request, env);
        return withCors(
          json(
            { ok: false, error: "legacy-loop-runtime-disabled" },
            { status: 410 },
          ),
          env,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/trades") {
        requireAdmin(request, env);
        const limitRaw = url.searchParams.get("limit") ?? "50";
        const limit = Number(limitRaw);
        const tenantId = env.TENANT_ID ?? "default";
        const trades = await listTrades(
          env,
          tenantId,
          Number.isFinite(limit) ? limit : 50,
        );
        return withCors(json({ ok: true, trades }), env);
      }

      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/admin/bots/")
      ) {
        requireAdmin(request, env);
        const parts = url.pathname.split("/").filter(Boolean);
        const botId = parts[3] ?? "";
        const action = parts[4] ?? "";
        if (!botId) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }
        const bot = await getBotById(env, botId);
        if (!bot) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }

        if (action === "start") {
          const payload = await readPayload(request);
          const overrideValidation = Boolean(payload.overrideValidation);
          const reason = String(payload.reason ?? "admin-start").slice(0, 300);
          let providerError = "";
          try {
            await assertBotInferenceProviderHealthy(env, botId);
          } catch (error) {
            providerError =
              error instanceof Error ? error.message : String(error);
          }
          if (
            providerError === "inference-provider-not-configured" ||
            providerError === "inference-provider-unreachable"
          ) {
            return withCors(
              json(
                {
                  ok: false,
                  error: providerError,
                },
                { status: 409 },
              ),
              env,
            );
          }
          const config = await getLoopConfig(env, botId);
          const gate = await checkStrategyStartGate(env, botId, config);
          if (
            !gate.ok &&
            (!overrideValidation || gate.overrideAllowed === false)
          ) {
            return withCors(
              json(
                {
                  ok: false,
                  error: gate.reason ?? "strategy-not-validated",
                },
                { status: 409 },
              ),
              env,
            );
          }
          await setBotEnabledById(env, botId, true);
          try {
            const doPayload = (await botLoopFetchJson(env, botId, "/start", {
              method: "POST",
              headers:
                overrideValidation && gate.ok === false
                  ? { "x-validation-override": "1" }
                  : undefined,
            })) as { config?: unknown };

            if (overrideValidation && !gate.ok) {
              await recordStrategyEvent(env, {
                tenantId: botId,
                eventType: "start_override",
                actor: "admin",
                reason,
                beforeConfig: config,
                afterConfig:
                  (doPayload.config as import("./types").LoopConfig) ?? config,
              }).catch(() => {});
            }

            return withCors(
              json({ ok: true, botId, config: doPayload.config ?? null }),
              env,
            );
          } catch (err) {
            await setBotEnabledById(env, botId, false).catch(() => {});
            throw err;
          }
        }

        if (action === "validate") {
          const payload = await readPayload(request);
          const fixturePatternRaw = String(payload.fixturePattern ?? "").trim();
          const fixturePattern =
            fixturePatternRaw === "uptrend" ||
            fixturePatternRaw === "downtrend" ||
            fixturePatternRaw === "whipsaw"
              ? fixturePatternRaw
              : undefined;
          const result = await runValidationForTenant(env, botId, {
            actor: "admin",
            reason: "admin-validate",
            fixturePattern,
          });
          ctx.waitUntil(
            botLoopFetchJson(env, botId, "/ensure", {
              method: "POST",
            }).catch(() => {}),
          );
          return withCors(json({ ok: true, validation: result }), env);
        }

        if (action === "revalidate") {
          const payload = await readPayload(request);
          if (payload.force === true) {
            await updateRuntimeState(env, botId, {
              nextRevalidateAt: new Date(0).toISOString(),
            });
          }
          await maybeRevalidateAndTuneForTenant(env, botId);
          const runtime = await getRuntimeState(env, botId);
          const latest = await getLatestValidation(env, botId);
          const config = await getLoopConfig(env, botId);
          const freshBot = await getBotById(env, botId);
          return withCors(
            json({
              ok: true,
              runtime,
              validation: latest,
              config,
              bot: freshBot,
            }),
            env,
          );
        }

        if (action === "config") {
          const payload = await readPayload(request);
          if (payload.policy !== undefined) {
            validatePolicy(payload.policy);
          }
          if (payload.strategy !== undefined) {
            if (
              !payload.strategy ||
              typeof payload.strategy !== "object" ||
              Array.isArray(payload.strategy)
            ) {
              return withCors(
                json({ ok: false, error: "invalid-strategy" }, { status: 400 }),
                env,
              );
            }
            validateStrategy(payload.strategy);
          }
          if (payload.validation !== undefined) {
            validateValidationConfig(payload.validation);
          }
          if (payload.autotune !== undefined) {
            validateAutotuneConfig(payload.autotune);
          }
          if (payload.execution !== undefined) {
            validateExecutionConfig(payload.execution);
          }
          if (payload.dataSources !== undefined) {
            validateDataSourcesConfig(payload.dataSources);
          }

          const beforeConfig = await getLoopConfig(env, botId);
          const doPayload = (await botLoopFetchJson(env, botId, "/config", {
            method: "PATCH",
            body: JSON.stringify(payload),
          })) as { config?: unknown };
          const afterConfig =
            doPayload.config &&
            typeof doPayload.config === "object" &&
            !Array.isArray(doPayload.config)
              ? (doPayload.config as import("./types").LoopConfig)
              : await getLoopConfig(env, botId);
          await markStrategyCandidateFromConfigChange(env, botId, {
            actor: "admin",
            reason: "admin-config-patch",
            beforeConfig,
            afterConfig,
          }).catch(() => {});
          return withCors(json({ ok: true, config: doPayload.config }), env);
        }

        return withCors(
          json({ ok: false, error: "not-found" }, { status: 404 }),
          env,
        );
      }

      return withCors(
        json({ ok: false, error: "not-found" }, { status: 404 }),
        env,
      );
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "unknown-error";
      const message = /JWS Protected Header is invalid/i.test(rawMessage)
        ? "unauthorized"
        : /no such table/i.test(rawMessage) ||
            /no such column/i.test(rawMessage)
          ? "d1-migrations-not-applied"
          : rawMessage;
      const status =
        message === "unauthorized"
          ? 401
          : message === "inference-provider-not-configured"
            ? 404
            : message === "inference-provider-unreachable"
              ? 503
            : message.startsWith("inference-provider-ping-failed")
              ? 400
              : message === "inference-provider-ping-timeout"
                ? 504
                : message === "inference-encryption-key-missing" ||
                    message === "invalid-inference-encryption-key"
                  ? 503
                  : message === "manual-onboarding-required" ||
                      message === "manual-access-required"
                    ? 403
                    : message === "trading-orchestrator-binding-missing"
                      ? 503
                    : message === "bot-limit-valuation-unavailable" ||
                        message.startsWith("x402-route-config-")
                      ? 503
                      : message === "strategy-not-validated" ||
                          message === "strategy-validation-stale"
                        ? 409
                        : message === "not-found"
                          ? 404
                          : message.startsWith("invalid-") ||
                              message.startsWith("missing-")
                            ? 400
                            : 500;
      if (status >= 500) {
        // Avoid leaking request headers or secrets; log only safe metadata.
        console.error("api.error", {
          method: request.method,
          path: url.pathname,
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      return withCors(json({ ok: false, error: message }, { status }), env);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // The Cloudflare Agents runtime owns autonomous tick scheduling.
    // Cron only ensures enabled bots keep their orchestrator schedules healthy.
    const enabledBots = await listEnabledBots(env, 200).catch(() => []);
    for (const bot of enabledBots) {
      ctx.waitUntil(
        (async () => {
          await botLoopFetchJson(env, bot.id, "/ensure", {
            method: "POST",
          }).catch((error) => {
            console.error("trading-orchestrator.ensure.failed", {
              botId: bot.id,
              err: error instanceof Error ? error.message : String(error),
            });
          });
        })(),
      );
    }
  },
};

async function requireOnboardedUser(
  request: Request,
  env: Env,
): Promise<UserRow> {
  const auth = await requireUser(request, env);
  const existing = await findUserByPrivyUserId(env, auth.privyUserId);
  if (existing) return existing;
  return await upsertUser(env, auth.privyUserId);
}

async function ensureManualAccess(
  env: Env,
  userId: string,
): Promise<Response | null> {
  const sub = await getUserSubscription(env, userId);
  if (isSubscriptionActive(sub)) return null;
  return json(
    {
      ok: false,
      error: "manual-access-required",
      message:
        "Access is provisioned manually. Contact the Trader Ralph team to activate your workspace.",
      subscription: toSubscriptionView(env, sub),
    },
    { status: 403 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function toUniqueStrings(value: unknown, maxItems: number): string[] {
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

function summarizeJupiterQuote(
  quote: Record<string, unknown>,
): Record<string, unknown> {
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

function parseCreateBotPayload(payload: Record<string, unknown>): {
  name: string;
  providerKind?: unknown;
  baseUrl: unknown;
  model: unknown;
  apiKey: unknown;
} {
  const name = String(payload.name ?? "").trim();
  if (!name || name.length > 120) throw new Error("invalid-bot-name");

  const provider = isRecord(payload.provider) ? payload.provider : payload;
  const providerKind = provider.providerKind ?? provider.kind;
  const baseUrl = provider.baseUrl ?? provider.url;
  const model = provider.model;
  const apiKey = provider.apiKey ?? provider.api_key;
  if (baseUrl === undefined || model === undefined || apiKey === undefined) {
    throw new Error("missing-inference-provider-config");
  }

  return {
    name,
    providerKind,
    baseUrl,
    model,
    apiKey,
  };
}

function parseInferencePatchPayload(payload: Record<string, unknown>): {
  providerKind?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
} {
  const provider = isRecord(payload.provider) ? payload.provider : payload;
  const next: {
    providerKind?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
  } = {};
  if (provider.providerKind !== undefined || provider.kind !== undefined) {
    next.providerKind = provider.providerKind ?? provider.kind;
  }
  if (provider.baseUrl !== undefined || provider.url !== undefined) {
    next.baseUrl = provider.baseUrl ?? provider.url;
  }
  if (provider.model !== undefined) {
    next.model = provider.model;
  }
  if (provider.apiKey !== undefined || provider.api_key !== undefined) {
    next.apiKey = provider.apiKey ?? provider.api_key;
  }
  if (
    next.providerKind === undefined &&
    next.baseUrl === undefined &&
    next.model === undefined &&
    next.apiKey === undefined
  ) {
    throw new Error("invalid-inference-provider-patch");
  }
  return next;
}

function parseInferencePingPayload(payload: Record<string, unknown>): {
  providerKind?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
} {
  const provider = isRecord(payload.provider) ? payload.provider : payload;
  const next: {
    providerKind?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
  } = {};
  if (provider.providerKind !== undefined || provider.kind !== undefined) {
    next.providerKind = provider.providerKind ?? provider.kind;
  }
  if (provider.baseUrl !== undefined || provider.url !== undefined) {
    next.baseUrl = provider.baseUrl ?? provider.url;
  }
  if (provider.model !== undefined) {
    next.model = provider.model;
  }
  if (provider.apiKey !== undefined || provider.api_key !== undefined) {
    next.apiKey = provider.apiKey ?? provider.api_key;
  }
  return next;
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  if (contentType.includes("form")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return {};
}

async function botLoopFetchJson(
  env: Env,
  botId: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  if (!env.TRADING_ORCHESTRATOR) {
    throw new Error("trading-orchestrator-binding-missing");
  }
  const stub = await getAgentByName(env.TRADING_ORCHESTRATOR, botId);

  const headers = new Headers(init.headers);
  headers.set("x-ralph-bot-id", botId);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await stub.fetch(`https://trading-orchestrator${path}`, {
    ...init,
    headers,
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const msg =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : `bot-loop-http-${response.status}`;
    throw new Error(msg);
  }
  return payload;
}

async function backtestQueueFetchJson(
  env: Env,
  botId: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const id = env.BACKTEST_QUEUE.idFromName(botId);
  const stub = env.BACKTEST_QUEUE.get(id);

  const headers = new Headers(init.headers);
  headers.set("x-ralph-bot-id", botId);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await stub.fetch(`https://backtest-queue${path}`, {
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const msg =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : `backtest-queue-http-${response.status}`;
    throw new Error(msg);
  }
  return payload;
}
