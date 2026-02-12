import { recordBotTickResult } from "./bots_db";
import { getLoopConfig, updateLoopConfig } from "./config";
import { defaultAgentStrategy, SOL_MINT, USDC_MINT } from "./defaults";
import { runAutopilotTickForTenant } from "./loop";
import { json } from "./response";
import type { Env } from "./types";
import { validatePolicy, validateStrategy } from "./validation";

type TickReason = "cron" | "manual";

const BOT_ID_HEADER = "x-ralph-bot-id";
const TICK_INTERVAL_MS = 60_000;
const MAX_TICK_RUNTIME_MS = 120_000;

type BotMeta = {
  enabled: boolean;
  walletAddress: string;
  privyWalletId: string;
};

export class BotLoop {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // In-memory lock for background ticks. Durable Objects are single-instance
  // per id, so this is enough to prevent concurrent ticks for the same bot.
  private inFlight: { promise: Promise<void>; startedAt: number } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // DO instances don't know their idFromName() name. The worker passes botId
    // on every call so alarms can later resolve it.
    const botId = request.headers.get(BOT_ID_HEADER)?.trim();
    let storedBotId = (await this.state.storage.get<string>("botId")) ?? "";
    if (botId && botId !== storedBotId) {
      await this.state.storage.put("botId", botId);
      storedBotId = botId;
    }
    if (!storedBotId) {
      return json({ ok: false, error: "missing-bot-id" }, { status: 400 });
    }

    try {
      if (request.method === "GET" && path === "/status") {
        const config = await getLoopConfig(this.env, storedBotId);
        const alarmAt = await this.state.storage.getAlarm();
        return json({
          ok: true,
          botId: storedBotId,
          enabled: config.enabled,
          alarmAt,
          tickInFlight: Boolean(this.inFlight),
        });
      }

      if (path === "/config") {
        if (request.method === "GET") {
          const config = await getLoopConfig(this.env, storedBotId);
          return json({ ok: true, config });
        }
        if (request.method === "PATCH") {
          const payload = await readPayload(request);
          const runNow = Boolean(payload.runNow);
          const update: Partial<import("./types").LoopConfig> = {};
          if (payload.enabled !== undefined) {
            if (typeof payload.enabled !== "boolean") {
              throw new Error("invalid-enabled");
            }
            update.enabled = payload.enabled;
          }
          if (payload.policy !== undefined) {
            validatePolicy(payload.policy);
            update.policy = payload.policy as import("./types").LoopPolicy;
          }
          if (payload.strategy !== undefined) {
            if (
              !payload.strategy ||
              typeof payload.strategy !== "object" ||
              Array.isArray(payload.strategy)
            ) {
              throw new Error("invalid-strategy");
            }
            validateStrategy(payload.strategy);
            update.strategy =
              payload.strategy as import("./types").StrategyConfig;
          }

          const config = await updateLoopConfig(this.env, update, storedBotId);
          if (config.enabled) {
            await this.ensureAlarm();
            if (runNow) this.enqueueTick("manual");
          } else {
            await this.disableAlarm();
          }
          return json({ ok: true, config });
        }
      }

      if (request.method === "POST" && path === "/start") {
        const current = await getLoopConfig(this.env, storedBotId);
        const strat = current.strategy as { type?: unknown } | undefined;
        const policyAllowed = current.policy?.allowedMints;
        const update: Partial<import("./types").LoopConfig> = { enabled: true };
        if (!strat || strat.type === "noop") {
          update.strategy = defaultAgentStrategy();
        }
        if (!Array.isArray(policyAllowed) || policyAllowed.length === 0) {
          update.policy = { allowedMints: [SOL_MINT, USDC_MINT] };
        }
        const config = await updateLoopConfig(this.env, update, storedBotId);
        await this.ensureAlarm();
        this.enqueueTick("manual");
        return json({ ok: true, config });
      }

      if (request.method === "POST" && path === "/stop") {
        const config = await updateLoopConfig(
          this.env,
          { enabled: false },
          storedBotId,
        );
        await this.disableAlarm();
        return json({ ok: true, config });
      }

      if (request.method === "POST" && path === "/tick") {
        this.enqueueTick("manual");
        return json({ ok: true, submitted: true });
      }

      if (request.method === "POST" && path === "/ensure") {
        const meta = await this.getBotMeta(storedBotId);
        const config = await getLoopConfig(this.env, storedBotId);
        if (meta?.enabled && config.enabled) {
          await this.ensureAlarm();
        } else {
          await this.disableAlarm();
        }
        return json({ ok: true });
      }

      return json({ ok: false, error: "not-found" }, { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.startsWith("invalid-") || message.startsWith("missing-")
          ? 400
          : 500;
      return json({ ok: false, error: message }, { status });
    }
  }

  async alarm(): Promise<void> {
    // Alarm is the durable "cron": it queues a tick and the tick reschedules
    // the next alarm (if still enabled).
    this.enqueueTick("cron");
  }

  private enqueueTick(reason: TickReason): void {
    const now = Date.now();
    if (this.inFlight) {
      const age = now - this.inFlight.startedAt;
      if (age < MAX_TICK_RUNTIME_MS) return;
      // Stale lock; allow a new tick.
      this.inFlight = null;
    }

    const promise = this.runTick(reason)
      .catch((err) => {
        console.error("bot_loop.tick.error", {
          err: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });

    this.inFlight = { promise, startedAt: now };
    this.state.waitUntil(promise);
  }

  private async runTick(reason: TickReason): Promise<void> {
    const botId = (await this.state.storage.get<string>("botId")) ?? "";
    if (!botId) return;

    const meta = await this.getBotMeta(botId);
    if (!meta || !meta.enabled) {
      await this.disableAlarm();
      return;
    }

    const config = await getLoopConfig(this.env, botId);
    if (!config.enabled) {
      await this.disableAlarm();
      return;
    }

    const result = await runAutopilotTickForTenant(
      this.env,
      // DurableObjectState has waitUntil(); that's all the loop needs.
      this.state as unknown as ExecutionContext,
      {
        tenantId: botId,
        walletAddress: meta.walletAddress,
        privyWalletId: meta.privyWalletId,
      },
      reason,
      { skipLock: true },
    );

    await recordBotTickResult(this.env, {
      botId,
      ok: result.ok,
      error: result.error,
    }).catch(() => {});

    // Reschedule next tick if still enabled.
    const nextConfig = await getLoopConfig(this.env, botId);
    if (!nextConfig.enabled) {
      await this.disableAlarm();
      return;
    }
    const nextMeta = await this.getBotMeta(botId);
    if (!nextMeta?.enabled) {
      await this.disableAlarm();
      return;
    }
    await this.ensureAlarm();
  }

  private async ensureAlarm(now = Date.now()): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current && current > now) return;

    // Align to the next minute boundary to keep ticks predictable.
    const next =
      Math.floor(now / TICK_INTERVAL_MS) * TICK_INTERVAL_MS + TICK_INTERVAL_MS;
    await this.state.storage.setAlarm(next);
  }

  private async disableAlarm(): Promise<void> {
    await this.state.storage.deleteAlarm();
  }

  private async getBotMeta(botId: string): Promise<BotMeta | null> {
    const row = (await this.env.WAITLIST_DB.prepare(
      "SELECT enabled, wallet_address as walletAddress, privy_wallet_id as privyWalletId FROM bots WHERE id = ?1",
    )
      .bind(botId)
      .first()) as unknown;

    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    const walletAddress = String(r.walletAddress ?? "").trim();
    const privyWalletId = String(r.privyWalletId ?? "").trim();
    if (!walletAddress || !privyWalletId) return null;
    return {
      enabled: Number(r.enabled) === 1,
      walletAddress,
      privyWalletId,
    };
  }
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
