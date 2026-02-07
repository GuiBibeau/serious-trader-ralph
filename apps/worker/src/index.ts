import { requireUser } from "./auth";
import {
  createBotRow,
  getBotForUser,
  listBotsForUser,
  listEnabledBots,
  recordBotTickResult,
  setBotEnabledForUser,
  upsertUser,
} from "./bots_db";
import { getLoopConfig, requireAdmin, updateLoopConfig } from "./config";
import { runAutopilotTick, runAutopilotTickForTenant } from "./loop";
import { createPrivySolanaWallet } from "./privy";
import { json, okCors, withCors } from "./response";
import { listTrades } from "./trade_index";
import type { Env } from "./types";

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
            policy: { dryRun: false, simulateOnly: true },
            strategy: { type: "noop" },
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
          const config = await updateLoopConfig(env, { enabled: true }, botId);

          // Behaves like an orchestration "kick": enable, then tick ASAP.
          ctx.waitUntil(
            runAutopilotTickForTenant(
              env,
              ctx,
              {
                tenantId: nextBot.id,
                walletAddress: nextBot.walletAddress,
                privyWalletId: nextBot.privyWalletId,
              },
              "manual",
            ).then((result) =>
              recordBotTickResult(env, {
                botId: nextBot.id,
                ok: result.ok,
                error: result.error,
              }),
            ),
          );

          return withCors(json({ ok: true, bot: nextBot, config }), env);
        }

        if (request.method === "POST" && action === "stop") {
          // Stop should take effect as fast as possible; update KV first.
          const config = await updateLoopConfig(env, { enabled: false }, botId);
          const nextBot = await setBotEnabledForUser(
            env,
            user.id,
            botId,
            false,
          );
          return withCors(json({ ok: true, bot: nextBot, config }), env);
        }

        if (request.method === "POST" && action === "tick") {
          const result = await runAutopilotTickForTenant(
            env,
            ctx,
            {
              tenantId: bot.id,
              walletAddress: bot.walletAddress,
              privyWalletId: bot.privyWalletId,
            },
            "manual",
          );
          await recordBotTickResult(env, {
            botId: bot.id,
            ok: result.ok,
            error: result.error,
          });
          return withCors(json({ ok: true, result }), env);
        }

        if (action === "config") {
          if (request.method === "GET") {
            const config = await getLoopConfig(env, botId);
            return withCors(json({ ok: true, config }), env);
          }
          if (request.method === "PATCH") {
            const payload = await readPayload(request);
            const policy =
              payload.policy && typeof payload.policy === "object"
                ? payload.policy
                : undefined;
            const strategy =
              payload.strategy && typeof payload.strategy === "object"
                ? payload.strategy
                : undefined;
            const runNow = Boolean(payload.runNow);

            const config = await updateLoopConfig(
              env,
              { policy: policy as unknown, strategy: strategy as unknown },
              botId,
            );
            if (runNow) {
              ctx.waitUntil(
                runAutopilotTickForTenant(
                  env,
                  ctx,
                  {
                    tenantId: bot.id,
                    walletAddress: bot.walletAddress,
                    privyWalletId: bot.privyWalletId,
                  },
                  "manual",
                ).then((result) =>
                  recordBotTickResult(env, {
                    botId: bot.id,
                    ok: result.ok,
                    error: result.error,
                  }),
                ),
              );
            }
            return withCors(json({ ok: true, config }), env);
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
        const policy =
          payload.policy && typeof payload.policy === "object"
            ? payload.policy
            : undefined;
        const strategy =
          payload.strategy && typeof payload.strategy === "object"
            ? payload.strategy
            : undefined;
        const runNow = Boolean(payload.runNow);
        const config = await updateLoopConfig(env, {
          policy: policy as unknown,
          strategy: strategy as unknown,
        });
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
    const enabledBots = await listEnabledBots(env, 5);
    if (enabledBots.length > 0) {
      // Keep concurrency low by default to reduce API/rpc rate limits.
      for (const bot of enabledBots) {
        const result = await runAutopilotTickForTenant(
          env,
          ctx,
          {
            tenantId: bot.id,
            walletAddress: bot.walletAddress,
            privyWalletId: bot.privyWalletId,
          },
          "cron",
        );
        await recordBotTickResult(env, {
          botId: bot.id,
          ok: result.ok,
          error: result.error,
        });
      }
      return;
    }

    // Legacy single-tenant mode (kept for local dev + backwards compatibility).
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
