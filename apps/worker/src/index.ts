import { requireUser } from "./auth";

export { BotLoop } from "./bot_loop_do";

import {
  createCheckoutIntent,
  findBillingPlan,
  getUserSubscription,
  isSubscriptionActive,
  listBillingPlans,
  resolveIntentStatus,
  toCheckoutIntentView,
  toSubscriptionView,
} from "./billing";
import {
  createBotRow,
  getBotById,
  getBotForUser,
  listBotsForUser,
  setBotEnabledById,
  setBotEnabledForUser,
  setUserProfile,
  upsertUser,
} from "./bots_db";
import { getLoopConfig, requireAdmin, updateLoopConfig } from "./config";
import { defaultAgentStrategy, SOL_MINT, USDC_MINT } from "./defaults";
import { runAutopilotTick } from "./loop";
import { getAgentMemory, saveAgentMemory } from "./memory";
import { createPrivySolanaWallet } from "./privy";
import { json, okCors, withCors } from "./response";
import { SolanaRpc } from "./solana_rpc";
import {
  checkStrategyStartGate,
  markStrategyCandidateFromConfigChange,
  maybeRevalidateAndTuneForTenant,
  runValidationForTenant,
} from "./strategy_validation/engine";
import {
  getRuntimeState,
  getLatestValidation,
  listStrategyEvents,
  listValidationRuns,
  recordStrategyEvent,
  updateRuntimeState,
} from "./strategy_validation/repo";
import {
  handleChatHistory,
  handleChatRequest,
  handleTelemetry,
} from "./conversation/router";
import type { ConversationRequest } from "./conversation/types";
import { listRecentBotEvents } from "./bot_events";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BILLING_RPC_DEFAULT = "https://api.devnet.solana.com";
const BALANCE_RPC_DEFAULT = "https://api.mainnet-beta.solana.com";

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
        const payload = await readPayload(request);
        const email = String(payload.email ?? "")
          .trim()
          .toLowerCase();
        const source = String(payload.source ?? "portal").trim();

        if (!EMAIL_RE.test(email)) {
          return withCors(
            json({ ok: false, error: "invalid-email" }, { status: 400 }),
            env,
          );
        }

        await env.WAITLIST_DB.prepare(
          "INSERT INTO waitlist (email, source) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING",
        )
          .bind(email, source)
          .run();

        return withCors(json({ ok: true }), env);
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const [bots, subscription] = await Promise.all([
          listBotsForUser(env, user.id),
          getUserSubscription(env, user.id),
        ]);
        return withCors(
          json({
            ok: true,
            user,
            bots,
            subscription: toSubscriptionView(env, subscription),
          }),
          env,
        );
      }

      if (request.method === "PATCH" && url.pathname === "/api/me/profile") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
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
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const [subscription, plans] = await Promise.all([
          getUserSubscription(env, user.id),
          Promise.resolve(listBillingPlans(env)),
        ]);
        return withCors(
          json({
            ok: true,
            plans,
            subscription: toSubscriptionView(env, subscription),
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/checkout"
      ) {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const payload = await readPayload(request);
        const planId = String(payload.planId ?? "").trim();
        const paymentAssetRaw = String(payload.paymentAsset ?? "USDC")
          .trim()
          .toUpperCase();
        if (paymentAssetRaw !== "USDC" && paymentAssetRaw !== "SOL") {
          return withCors(
            json(
              { ok: false, error: "invalid-payment-asset" },
              { status: 400 },
            ),
            env,
          );
        }
        const plan = findBillingPlan(env, planId);
        if (!plan) {
          return withCors(
            json({ ok: false, error: "invalid-plan" }, { status: 400 }),
            env,
          );
        }
        const intent = await createCheckoutIntent(env, {
          userId: user.id,
          plan,
          paymentAsset: paymentAssetRaw,
        });
        return withCors(
          json({
            ok: true,
            intent: toCheckoutIntentView(plan, intent),
          }),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/billing/checkout/")
      ) {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const intentId = url.pathname.split("/").filter(Boolean)[3] ?? "";
        if (!intentId) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }
        const rpc = new SolanaRpc(
          env.BILLING_RPC_ENDPOINT || BILLING_RPC_DEFAULT,
        );
        const { intent, subscription } = await resolveIntentStatus(env, {
          userId: user.id,
          intentId,
          rpcRequest: (method, params) => rpc.request(method, params ?? []),
        });
        const plan = findBillingPlan(env, intent.planId);
        if (!plan) throw new Error("invalid-plan");
        return withCors(
          json({
            ok: true,
            intent: toCheckoutIntentView(plan, intent),
            subscription,
          }),
          env,
        );
      }

      if (url.pathname === "/api/bots" && request.method === "GET") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const bots = await listBotsForUser(env, user.id);
        return withCors(json({ ok: true, bots }), env);
      }

      if (url.pathname === "/api/bots" && request.method === "POST") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const gate = await ensureActiveSubscription(env, user.id);
        if (gate) return withCors(gate, env);

        const existingBots = await listBotsForUser(env, user.id);
        if (existingBots.length > 0) {
          const existingBot = existingBots[0];
          const config = await getLoopConfig(env, existingBot.id).catch(
            () => null,
          );
          return withCors(
            json({ ok: true, bot: existingBot, config, existing: true }),
            env,
          );
        }

        const payload = await readPayload(request);
        const name = String(payload.name ?? "Ralph").trim();
        if (!name) {
          return withCors(
            json({ ok: false, error: "invalid-name" }, { status: 400 }),
            env,
          );
        }

        const wallet = await createPrivySolanaWallet(env);

        const bot = await createBotRow(env, {
          userId: user.id,
          name,
          enabled: false,
          signerType: "privy",
          privyWalletId: wallet.walletId,
          walletAddress: wallet.address,
        });

        const config = await updateLoopConfig(
          env,
          {
            enabled: false,
            policy: {
              dryRun: false,
              simulateOnly: true,
              allowedMints: [SOL_MINT, USDC_MINT],
              slippageBps: 50,
              maxPriceImpactPct: 0.05,
              maxTradeAmountAtomic: "0",
              minSolReserveLamports: "50000000",
            },
            strategy: defaultAgentStrategy(),
          },
          bot.id,
        );

        return withCors(json({ ok: true, bot, config }), env);
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

        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
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

        if (request.method === "POST" && action === "start") {
          const gate = await ensureActiveSubscription(env, user.id);
          if (gate) return withCors(gate, env);
          const config = await getLoopConfig(env, botId);
          const validationGate = await checkStrategyStartGate(env, botId, config);
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
          const gate = await ensureActiveSubscription(env, user.id);
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
          const gate = await ensureActiveSubscription(env, user.id);
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
              const gate = await ensureActiveSubscription(env, user.id);
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
          const rpc = new SolanaRpc(
            env.BALANCE_RPC_ENDPOINT || BALANCE_RPC_DEFAULT,
          );
          const [lamports, usdcAtomic] = await Promise.all([
            rpc.getBalanceLamports(bot.walletAddress),
            rpc.getTokenBalanceAtomic(bot.walletAddress, USDC_MINT),
          ]);
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
            }),
            env,
          );
        }

        if (request.method === "GET" && action === "events") {
          const limitRaw = url.searchParams.get("limit") ?? "40";
          const limit = Number(limitRaw);
          const events = await listRecentBotEvents(env, {
            tenantId: botId,
            limit: Number.isFinite(limit) ? Math.max(1, Math.min(120, limit)) : 40,
          });
          return withCors(json({ ok: true, events }), env);
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
        const config = await getLoopConfig(env);
        return withCors(json({ ok: true, config }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/loop/start") {
        requireAdmin(request, env);
        const config = await updateLoopConfig(env, { enabled: true });
        // Start should behave like an orchestration "kick": enable, then tick ASAP.
        ctx.waitUntil(runAutopilotTick(env, ctx, "manual"));
        return withCors(json({ ok: true, config }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/loop/stop") {
        requireAdmin(request, env);
        const config = await updateLoopConfig(env, { enabled: false });
        return withCors(json({ ok: true, config }), env);
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
        if (runNow) {
          ctx.waitUntil(runAutopilotTick(env, ctx, "manual"));
        }
        return withCors(json({ ok: true, config }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/loop/tick") {
        requireAdmin(request, env);
        ctx.waitUntil(runAutopilotTick(env, ctx, "manual"));
        return withCors(json({ ok: true }), env);
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
                afterConfig: (doPayload.config as import("./types").LoopConfig) ?? config,
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
            json({ ok: true, runtime, validation: latest, config, bot: freshBot }),
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
          : message === "strategy-not-validated" ||
              message === "strategy-validation-stale"
            ? 409
          : message === "not-found"
            ? 404
            : message.startsWith("invalid-") || message.startsWith("missing-")
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
    // Bot loops are scheduled via Durable Object alarms.
    // Keep the legacy single-tenant cron for local dev + backwards compatibility.
    await runAutopilotTick(env, ctx);
  },
};

async function ensureActiveSubscription(
  env: Env,
  userId: string,
): Promise<Response | null> {
  const sub = await getUserSubscription(env, userId);
  if (isSubscriptionActive(sub)) return null;
  return json(
    {
      ok: false,
      error: "subscription-required",
      subscription: toSubscriptionView(env, sub),
    },
    { status: 402 },
  );
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
  const id = env.BOT_LOOP.idFromName(botId);
  const stub = env.BOT_LOOP.get(id);

  const headers = new Headers(init.headers);
  headers.set("x-ralph-bot-id", botId);
  if (init.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await stub.fetch(`https://bot-loop${path}`, {
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
