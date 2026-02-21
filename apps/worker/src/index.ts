import { requireUser } from "./auth";

import { getUserSubscription, toSubscriptionView } from "./billing";
import { USDC_MINT } from "./defaults";
import { executeSwapViaRouter } from "./execution/router";
import {
  type ExperienceLevel,
  evaluateOnboarding,
  mergeConsumerProfile,
  parseConsumerProfileSummary,
  parseExperienceLevel,
  parseLevelSource,
  validateOnboardingInput,
} from "./experience";
import { fetchHistoricalOhlcvRuntime } from "./historical_ohlcv";
import { JupiterClient } from "./jupiter";
import {
  LOOP_A_COORDINATOR_NAME,
  LoopACoordinator,
} from "./loop_a/coordinator";
import { readLoopAHealthFromKv, recordLoopAHealthTick } from "./loop_a/health";
import { runLoopATickPipeline } from "./loop_a/pipeline";
import { MinuteAccumulator } from "./loop_b/minute_accumulator";
import { Recommender } from "./loop_c/recommender";
import {
  fetchMacroEtfFlows,
  fetchMacroFredIndicators,
  fetchMacroOilAnalytics,
  fetchMacroSignals,
  fetchMacroStablecoinHealth,
} from "./macro_sources";
import { computeMarketIndicators } from "./market_indicators";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet } from "./privy";
import { gatherMarketSnapshot } from "./research";
import { json, okCors, withCors } from "./response";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";
import type { UserRow } from "./users_db";
import {
  findUserByPrivyUserId,
  setUserExperience,
  setUserOnboardingStatus,
  setUserProfile,
  setUserWallet,
  upsertUser,
} from "./users_db";
import { requireX402Payment, withX402SettlementHeader } from "./x402";

const X402_READ_RPC_ENDPOINT_FALLBACK = "https://api.mainnet-beta.solana.com";
const X402_READ_JUPITER_BASE_URL = "https://lite-api.jup.ag";
const X402_SOL_MINT = "So11111111111111111111111111111111111111112";
const MAX_EXPERIENCE_EVENTS = 200;

type ExperienceEventName =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "level_assigned_auto"
  | "level_overridden_manual"
  | "degen_acknowledged"
  | "terminal_opened_from_consumer";

const EXPERIENCE_EVENT_NAMES = new Set<ExperienceEventName>([
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "level_assigned_auto",
  "level_overridden_manual",
  "degen_acknowledged",
  "terminal_opened_from_consumer",
]);

export { LoopACoordinator, MinuteAccumulator, Recommender };

function resolveX402ReadRpcEndpoint(env: Env): string {
  const balanceRpc = String(env.BALANCE_RPC_ENDPOINT ?? "").trim();
  if (balanceRpc) return balanceRpc;
  const rpc = String(env.RPC_ENDPOINT ?? "").trim();
  if (rpc) return rpc;
  return X402_READ_RPC_ENDPOINT_FALLBACK;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    if (request.method === "OPTIONS") {
      return okCors(env);
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        const loopAHealth = await readLoopAHealthFromKv(env);
        if (!loopAHealth) {
          return withCors(json({ ok: true }), env);
        }
        return withCors(
          json({
            ok: loopAHealth.status !== "error",
            loopA: loopAHealth,
          }),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/waitlist") {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
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
        let ohlcv: Awaited<ReturnType<typeof fetchHistoricalOhlcvRuntime>>;
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
        let ohlcv: Awaited<ReturnType<typeof fetchHistoricalOhlcvRuntime>>;
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

      if (request.method === "POST" && url.pathname === "/api/trade/swap") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }

        const payload = await readPayload(request);
        const inputMint = String(payload.inputMint ?? "").trim();
        const outputMint = String(payload.outputMint ?? "").trim();
        const amount = String(payload.amount ?? "").trim();
        const slippageBps = toBoundedInt(payload.slippageBps, 50, 1, 5_000);
        const source = String(payload.source ?? "")
          .trim()
          .slice(0, 80);
        const reason = String(payload.reason ?? "")
          .trim()
          .slice(0, 240);

        if (
          !inputMint ||
          !outputMint ||
          inputMint === outputMint ||
          !amount ||
          !/^\d+$/.test(amount)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-trade-request" },
              { status: 400 },
            ),
            env,
          );
        }

        if (
          (inputMint !== X402_SOL_MINT && inputMint !== USDC_MINT) ||
          (outputMint !== X402_SOL_MINT && outputMint !== USDC_MINT)
        ) {
          return withCors(
            json(
              {
                ok: false,
                error: "unsupported-trade-pair",
                supportedMints: [X402_SOL_MINT, USDC_MINT],
              },
              { status: 400 },
            ),
            env,
          );
        }

        const rpcEndpoint = String(env.RPC_ENDPOINT ?? "").trim();
        if (!rpcEndpoint) {
          return withCors(
            json({ ok: false, error: "rpc-endpoint-missing" }, { status: 500 }),
            env,
          );
        }

        const jupiter = new JupiterClient(
          String(env.JUPITER_BASE_URL ?? "").trim() ||
            X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const rpc = new SolanaRpc(rpcEndpoint);
        const policy = normalizePolicy({
          allowedMints: [X402_SOL_MINT, USDC_MINT],
          slippageBps,
          maxPriceImpactPct: 0.05,
          minSolReserveLamports: "50000000",
          commitment: "confirmed",
        });

        const walletAddress = user.walletAddress;
        const inputAmount = BigInt(amount);
        if (inputAmount <= 0n) {
          return withCors(
            json(
              { ok: false, error: "invalid-trade-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (inputMint === X402_SOL_MINT) {
          const balanceLamports = await rpc.getBalanceLamports(walletAddress);
          const minSolReserveLamports = BigInt(policy.minSolReserveLamports);
          if (inputAmount + minSolReserveLamports > balanceLamports) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "insufficient-sol-reserve",
                  reserveLamports: minSolReserveLamports.toString(),
                  balanceLamports: balanceLamports.toString(),
                },
                { status: 400 },
              ),
              env,
            );
          }
        } else {
          const tokenBalance = await rpc.getTokenBalanceAtomic(
            walletAddress,
            inputMint,
          );
          if (inputAmount > tokenBalance) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "insufficient-token-balance",
                  balanceAtomic: tokenBalance.toString(),
                },
                { status: 400 },
              ),
              env,
            );
          }
        }

        const quoteResponse = await jupiter.quote({
          inputMint,
          outputMint,
          amount,
          slippageBps: policy.slippageBps,
          swapMode: "ExactIn",
        });
        enforcePolicy(policy, quoteResponse);

        const result = await executeSwapViaRouter({
          env,
          policy,
          rpc,
          jupiter,
          quoteResponse,
          userPublicKey: walletAddress,
          privyWalletId: user.privyWalletId,
          log(level, message, meta) {
            console[level]("trade.swap", {
              userId: user.id,
              inputMint,
              outputMint,
              amount,
              slippageBps: policy.slippageBps,
              source: source || "TERMINAL",
              reason: reason || undefined,
              message,
              ...(meta ?? {}),
            });
          },
        });

        return withCors(
          json({
            ok: true,
            status: result.status,
            signature: result.signature,
            refreshed: result.refreshed,
            lastValidBlockHeight: result.lastValidBlockHeight,
            quote: summarizeJupiterQuote(
              result.usedQuote as unknown as Record<string, unknown>,
            ),
            source: source || "TERMINAL",
            err: result.err ?? null,
          }),
          env,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        const experience = buildExperienceView(user);
        const consumerProfile = parseConsumerProfileSummary(
          user.profile,
          user.feedSeedVersion,
        );
        return withCors(
          json({
            ok: true,
            user,
            wallet:
              user.walletAddress && user.privyWalletId
                ? {
                    signerType: user.signerType ?? "privy",
                    privyWalletId: user.privyWalletId,
                    walletAddress: user.walletAddress,
                    walletMigratedAt: user.walletMigratedAt ?? null,
                  }
                : null,
            experience,
            consumerProfile,
          }),
          env,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/wallet/balance") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        const balanceRpcEndpoint =
          String(env.BALANCE_RPC_ENDPOINT ?? "").trim() ||
          String(env.RPC_ENDPOINT ?? "").trim();
        if (!balanceRpcEndpoint) {
          return withCors(
            json({ ok: false, error: "rpc-endpoint-missing" }, { status: 500 }),
            env,
          );
        }
        const rpc = new SolanaRpc(balanceRpcEndpoint);
        let lamports = 0n;
        let usdcAtomic = 0n;
        const balanceErrors: string[] = [];

        try {
          lamports = await rpc.getBalanceLamports(user.walletAddress);
        } catch (error) {
          balanceErrors.push(
            `sol:${error instanceof Error ? error.message : String(error)}`,
          );
        }

        try {
          usdcAtomic = await rpc.getTokenBalanceAtomic(
            user.walletAddress,
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

      if (
        request.method === "PUT" &&
        url.pathname === "/api/onboarding/complete"
      ) {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const validated = validateOnboardingInput(payload);
        if (!validated.ok) {
          return withCors(
            json({ ok: false, error: validated.error }, { status: 400 }),
            env,
          );
        }

        const nowIso = new Date().toISOString();
        const evaluated = evaluateOnboarding(validated.input);
        const mergedProfile = mergeConsumerProfile(user.profile, {
          ...evaluated.consumerProfile,
          completedAt: nowIso,
        });

        await setUserProfile(env, user.id, mergedProfile);
        await setUserExperience(env, {
          userId: user.id,
          experienceLevel: evaluated.level,
          levelSource: "auto",
          onboardingCompletedAt: nowIso,
          onboardingVersion: 1,
          feedSeedVersion: 1,
          degenAcknowledgedAt: null,
        });
        await setUserOnboardingStatus(env, user.id, "active");

        const experience = {
          level: evaluated.level,
          levelSource: "auto" as const,
          onboardingCompleted: true,
          onboardingCompletedAt: nowIso,
          onboardingVersion: 1,
        };
        const consumerProfile = {
          goalPrimary: evaluated.consumerProfile.goalPrimary,
          riskBand: evaluated.riskBand,
          timeHorizon: evaluated.consumerProfile.timeHorizon,
          literacyScore: evaluated.literacyScore,
          feedSeedVersion: 1,
        };

        return withCors(
          json({
            ok: true,
            experience,
            consumerProfile,
          }),
          env,
        );
      }

      if (
        request.method === "PATCH" &&
        url.pathname === "/api/me/experience-level"
      ) {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const level = String(payload.level ?? "").trim();
        if (
          level !== "beginner" &&
          level !== "intermediate" &&
          level !== "pro" &&
          level !== "degen"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-experience-level" },
              { status: 400 },
            ),
            env,
          );
        }

        const currentOnboardingCompletedAt = user.onboardingCompletedAt ?? null;
        const onboardingCompleted =
          Boolean(currentOnboardingCompletedAt) ||
          user.onboardingStatus === "active";
        if (!onboardingCompleted) {
          return withCors(
            json(
              { ok: false, error: "onboarding-not-complete" },
              { status: 400 },
            ),
            env,
          );
        }

        const acknowledgeHighRisk = payload.acknowledgeHighRisk === true;
        if (level === "degen" && !acknowledgeHighRisk) {
          return withCors(
            json(
              {
                ok: false,
                error: "missing-high-risk-acknowledgement",
              },
              { status: 400 },
            ),
            env,
          );
        }

        const degenAcknowledgedAt =
          level === "degen"
            ? new Date().toISOString()
            : (user.degenAcknowledgedAt ?? null);

        await setUserExperience(env, {
          userId: user.id,
          experienceLevel: level as ExperienceLevel,
          levelSource: "manual",
          onboardingCompletedAt:
            currentOnboardingCompletedAt ?? new Date().toISOString(),
          onboardingVersion: user.onboardingVersion,
          feedSeedVersion: user.feedSeedVersion,
          degenAcknowledgedAt,
        });

        const experience = {
          level,
          levelSource: "manual" as const,
          onboardingCompleted: true,
          onboardingCompletedAt:
            currentOnboardingCompletedAt ?? new Date().toISOString(),
          onboardingVersion:
            Number.isFinite(user.onboardingVersion) &&
            user.onboardingVersion > 0
              ? user.onboardingVersion
              : 1,
        };

        return withCors(json({ ok: true, experience }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/events") {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const name = parseExperienceEventName(payload.name ?? payload.event);
        if (!name) {
          return withCors(
            json({ ok: false, error: "invalid-event-name" }, { status: 400 }),
            env,
          );
        }
        const properties = sanitizeEventProperties(payload.properties);
        const profile = appendExperienceEventToProfile(user.profile, {
          name,
          ts: new Date().toISOString(),
          properties,
        });
        await setUserProfile(env, user.id, profile);
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

      if (
        url.pathname === "/api/bots" ||
        url.pathname.startsWith("/api/bots/") ||
        url.pathname.startsWith("/api/admin/bots/") ||
        url.pathname === "/api/config" ||
        url.pathname === "/api/trades" ||
        url.pathname === "/api/loop/status" ||
        url.pathname === "/api/loop/start" ||
        url.pathname === "/api/loop/stop" ||
        url.pathname === "/api/loop/tick"
      ) {
        return withCors(
          json({ ok: false, error: "bot-runtime-removed" }, { status: 410 }),
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
          : message === "manual-onboarding-required"
            ? 403
            : message === "d1-migrations-not-applied" ||
                message.startsWith("x402-route-config-")
              ? 503
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

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const startedAtMs = Date.now();
    const slotSourceEnabled =
      String(env.LOOP_A_SLOT_SOURCE_ENABLED ?? "0").trim() === "1";
    if (!slotSourceEnabled) return;

    if (!env.CONFIG_KV) {
      console.warn("loop_a.slot_source.skipped", {
        reason: "loop-a-config-kv-missing",
      });
      return;
    }

    const coordinatorEnabled =
      String(env.LOOP_A_COORDINATOR_ENABLED ?? "0").trim() === "1";

    if (coordinatorEnabled && env.LOOP_A_COORDINATOR_DO) {
      try {
        const id = env.LOOP_A_COORDINATOR_DO.idFromName(
          LOOP_A_COORDINATOR_NAME,
        );
        const stub = env.LOOP_A_COORDINATOR_DO.get(id);
        const response = await stub.fetch("https://internal/loop-a/tick", {
          method: "POST",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          console.error("loop_a.coordinator.tick.failed", {
            status: response.status,
            body: text.slice(0, 1000),
          });
        }
        return;
      } catch (error) {
        console.error("loop_a.coordinator.scheduled.error", {
          message: error instanceof Error ? error.message : "unknown-error",
          stack: error instanceof Error ? error.stack : undefined,
        });
        return;
      }
    }
    if (coordinatorEnabled && !env.LOOP_A_COORDINATOR_DO) {
      console.warn("loop_a.coordinator.skipped", {
        reason: "loop-a-coordinator-binding-missing",
      });
    }

    try {
      const tickResult = await runLoopATickPipeline(env);
      await recordLoopAHealthTick(env, {
        ok: true,
        trigger: "scheduled",
        startedAtMs,
        tickResult,
      });
    } catch (error) {
      try {
        await recordLoopAHealthTick(env, {
          ok: false,
          trigger: "scheduled",
          startedAtMs,
          error,
        });
      } catch (healthError) {
        console.error("loop_a.health.scheduled.error", {
          message:
            healthError instanceof Error
              ? healthError.message
              : "unknown-health-error",
        });
      }
      console.error("loop_a.scheduled.error", {
        message: error instanceof Error ? error.message : "unknown-error",
        stack: error instanceof Error ? error.stack : undefined,
      });
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

async function ensureUserWallet(env: Env, user: UserRow): Promise<UserRow> {
  if (user.walletAddress && user.privyWalletId) return user;
  const wallet = await createPrivySolanaWallet(env);
  await setUserWallet(env, {
    userId: user.id,
    signerType: "privy",
    privyWalletId: wallet.walletId,
    walletAddress: wallet.address,
    walletMigratedAt: new Date().toISOString(),
  });
  return {
    ...user,
    signerType: "privy",
    privyWalletId: wallet.walletId,
    walletAddress: wallet.address,
    walletMigratedAt: new Date().toISOString(),
  };
}

function buildExperienceView(user: UserRow): {
  level: ExperienceLevel;
  levelSource: "auto" | "manual";
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingVersion: number;
} {
  const onboardingCompletedAt = user.onboardingCompletedAt ?? null;
  const onboardingCompleted =
    Boolean(onboardingCompletedAt) || user.onboardingStatus === "active";
  return {
    level: parseExperienceLevel(user.experienceLevel),
    levelSource: parseLevelSource(user.levelSource),
    onboardingCompleted,
    onboardingCompletedAt,
    onboardingVersion:
      Number.isFinite(user.onboardingVersion) && user.onboardingVersion > 0
        ? Math.floor(user.onboardingVersion)
        : 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseExperienceEventName(value: unknown): ExperienceEventName | null {
  const raw = String(value ?? "").trim() as ExperienceEventName;
  return EXPERIENCE_EVENT_NAMES.has(raw) ? raw : null;
}

function sanitizeEventProperties(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {};
  const output: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim()) continue;
    if (typeof raw === "string") {
      output[key] = raw.slice(0, 200);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = raw;
    } else if (typeof raw === "boolean") {
      output[key] = raw;
    } else {
      continue;
    }
    count += 1;
    if (count >= 20) break;
  }
  return output;
}

function appendExperienceEventToProfile(
  existingProfile: Record<string, unknown> | null,
  event: {
    name: ExperienceEventName;
    ts: string;
    properties: Record<string, string | number | boolean>;
  },
): Record<string, unknown> {
  const profile = isRecord(existingProfile) ? { ...existingProfile } : {};
  const analyticsRaw = profile.analytics;
  const analytics = isRecord(analyticsRaw) ? { ...analyticsRaw } : {};
  const eventsRaw = Array.isArray(analytics.events) ? analytics.events : [];
  const nextEvents = [...eventsRaw, event].slice(-MAX_EXPERIENCE_EVENTS);
  analytics.events = nextEvents;
  profile.analytics = analytics;
  return profile;
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
