import { requireUser } from "./auth";

export { BotLoop } from "./bot_loop_do";

import {
  createBotRow,
  getBotForUser,
  listBotsForUser,
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
import { listTrades } from "./trade_index";
import type { Env } from "./types";
import { validatePolicy, validateStrategy } from "./validation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        const bots = await listBotsForUser(env, user.id);
        return withCors(json({ ok: true, user, bots }), env);
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

      if (url.pathname === "/api/bots" && request.method === "GET") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);
        const bots = await listBotsForUser(env, user.id);
        return withCors(json({ ok: true, bots }), env);
      }

      if (url.pathname === "/api/bots" && request.method === "POST") {
        const auth = await requireUser(request, env);
        const user = await upsertUser(env, auth.privyUserId);

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
            const doPayload = (await botLoopFetchJson(env, botId, "/config", {
              method: "PATCH",
              body: JSON.stringify(payload),
            })) as { config?: unknown };
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
          const rpc = SolanaRpc.fromEnv(env);
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
