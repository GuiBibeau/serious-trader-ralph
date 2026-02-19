import { Agent } from "agents";
import { json } from "../response";
import {
  getLoopConfig,
  updateLoopConfig,
  type LoopConfig,
} from "../config";
import { defaultAgentStrategy } from "../defaults";
import {
  resolveBotProviderSnapshot,
  type ProviderSnapshot,
} from "../inference_provider";
import { runAutopilotTickForTenant } from "../loop";
import { checkStrategyStartGate } from "../strategy_validation/engine";
import type { Env } from "../types";
import {
  validateAutotuneConfig,
  validateDataSourcesConfig,
  validateExecutionConfig,
  validatePolicy,
  validateStrategy,
  validateValidationConfig,
} from "../validation";
import {
  countPendingSteeringMessages,
  getBotRunState,
  listPendingSteeringMessages,
  markSteeringMessagesApplied,
  upsertBotRunState,
} from "./runtime_repo";

type TickReason = "cron" | "manual";

const TICK_INTERVAL_SECONDS = 60;
const TICK_INTERVAL_MS = TICK_INTERVAL_SECONDS * 1000;
const MAX_TICK_RUNTIME_MS = 240_000;

type OrchestratorState = {
  botId: string;
  providerSnapshot: ProviderSnapshot | null;
  intervalScheduleId: string | null;
  tickInFlight: boolean;
  lastTickStartedAt: number | null;
};

type BotMeta = {
  enabled: boolean;
  userId: string;
  walletAddress: string;
  privyWalletId: string;
};

export class TradingOrchestratorAgent extends Agent<Env, OrchestratorState> {
  initialState: OrchestratorState = {
    botId: "",
    providerSnapshot: null,
    intervalScheduleId: null,
    tickInFlight: false,
    lastTickStartedAt: null,
  };

  static options = {
    hibernate: false,
  };

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const botId = await this.resolveBotId(request);
    if (!botId) {
      return json({ ok: false, error: "missing-bot-id" }, { status: 400 });
    }

    try {
      if (request.method === "GET" && path === "/status") {
        const [config, runState, pendingSteering] = await Promise.all([
          getLoopConfig(this.env, botId),
          getBotRunState(this.env, botId),
          countPendingSteeringMessages(this.env, botId).catch(() => 0),
        ]);
        return json({
          ok: true,
          botId,
          enabled: config.enabled,
          tickInFlight: this.state.tickInFlight,
          nextTickAt:
            runState?.nextTickAt ??
            new Date(Date.now() + TICK_INTERVAL_MS).toISOString(),
          runState,
          pendingSteering,
        });
      }

      if (path === "/config") {
        if (request.method === "GET") {
          const config = await getLoopConfig(this.env, botId);
          return json({ ok: true, config });
        }
        if (request.method === "PATCH") {
          const payload = await readPayload(request);
          const runNow = Boolean(payload.runNow);
          const update = toLoopConfigUpdate(payload);
          const current = await getLoopConfig(this.env, botId);
          const enablingFromStopped =
            update.enabled === true && current.enabled === false;
          let resolvedProviderSnapshot: ProviderSnapshot | null = null;
          if (enablingFromStopped) {
            const gate = await checkStrategyStartGate(this.env, botId, {
              ...current,
              ...update,
            });
            if (!gate.ok) {
              throw new Error(gate.reason ?? "strategy-not-validated");
            }
            try {
              resolvedProviderSnapshot = await resolveBotProviderSnapshot(
                this.env,
                botId,
                {
                  verify: true,
                },
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await upsertBotRunState(this.env, {
                botId,
                state: "blocked_inference",
                blockedReason: toInferenceBlockedReason(message),
                currentRunId: null,
                nextTickAt: null,
              }).catch(() => {});
              throw error;
            }
          }
          const config = await updateLoopConfig(this.env, update, botId);

          if (config.enabled) {
            if (resolvedProviderSnapshot) {
              this.setState({
                ...this.state,
                providerSnapshot: resolvedProviderSnapshot,
              });
            }
            const nextTickAt = await this.ensureSchedule();
            await upsertBotRunState(this.env, {
              botId,
              state: "running",
              blockedReason: null,
              providerBaseUrlHash:
                resolvedProviderSnapshot?.baseUrlHash ?? this.state.providerSnapshot?.baseUrlHash ?? null,
              providerModel:
                resolvedProviderSnapshot?.model ?? this.state.providerSnapshot?.model ?? null,
              providerPingAgeMs:
                toProviderPingAgeMs(
                  resolvedProviderSnapshot?.lastPingAt ??
                    this.state.providerSnapshot?.lastPingAt ??
                    null,
                ),
              resolutionSource:
                resolvedProviderSnapshot?.resolutionSource ??
                this.state.providerSnapshot?.resolutionSource ??
                null,
              nextTickAt,
            }).catch(() => {});
            if (runNow) await this.queueTick("manual");
          } else {
            await this.clearSchedule();
            await upsertBotRunState(this.env, {
              botId,
              state: "stopped",
              blockedReason: null,
              currentRunId: null,
              nextTickAt: null,
            }).catch(() => {});
          }
          return json({ ok: true, config });
        }
      }

      if (request.method === "POST" && path === "/start") {
        const config = await this.start(botId);
        return json({ ok: true, config });
      }

      if (request.method === "POST" && path === "/stop") {
        const config = await this.stop(botId);
        return json({ ok: true, config });
      }

      if (request.method === "POST" && path === "/tick") {
        await this.queueTick("manual");
        return json({ ok: true, submitted: true });
      }

      if (request.method === "POST" && path === "/ensure") {
        const [meta, config] = await Promise.all([
          this.getBotMeta(botId),
          getLoopConfig(this.env, botId),
        ]);
        if (meta?.enabled && config.enabled) {
          const nextTickAt = await this.ensureSchedule();
          await upsertBotRunState(this.env, {
            botId,
            state: "running",
            nextTickAt,
          }).catch(() => {});
        } else {
          await this.clearSchedule();
          await upsertBotRunState(this.env, {
            botId,
            state: "stopped",
            blockedReason: null,
            currentRunId: null,
            nextTickAt: null,
          }).catch(() => {});
        }
        return json({ ok: true });
      }

      return json({ ok: false, error: "not-found" }, { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message === "inference-provider-not-configured" ||
        message === "inference-provider-unreachable" ||
        message === "strategy-not-validated" ||
        message === "strategy-validation-stale"
          ? 409
          : message.startsWith("invalid-") || message.startsWith("missing-")
            ? 400
            : 500;
      return json({ ok: false, error: message }, { status });
    }
  }

  async scheduledTick(): Promise<void> {
    await this.runTick("cron");
  }

  async queuedTick(input: { reason: TickReason }): Promise<void> {
    await this.runTick(input.reason);
  }

  private async resolveBotId(request: Request): Promise<string> {
    const incoming = request.headers.get("x-ralph-bot-id");
    const botId = String(incoming ?? this.state.botId ?? "").trim();
    if (!botId) return "";
    if (botId !== this.state.botId) {
      this.setState({
        ...this.state,
        botId,
      });
    }
    return botId;
  }

  private async start(botId: string): Promise<LoopConfig> {
    const current = await getLoopConfig(this.env, botId);
    const gate = await checkStrategyStartGate(this.env, botId, current);
    if (!gate.ok) throw new Error(gate.reason ?? "strategy-not-validated");

    const strategy = current.strategy as { type?: unknown } | undefined;
    const policyAllowed = current.policy?.allowedMints;
    const update: Partial<LoopConfig> = { enabled: true };
    if (!strategy || strategy.type === "noop") {
      update.strategy = defaultAgentStrategy();
    }
    if (!Array.isArray(policyAllowed)) {
      update.policy = { allowedMints: [] };
    }
    const config = await updateLoopConfig(this.env, update, botId);

    await upsertBotRunState(this.env, {
      botId,
      state: "starting",
      blockedReason: null,
      currentRunId: null,
      nextTickAt: null,
    }).catch(() => {});

    let providerSnapshot: ProviderSnapshot | null = null;
    try {
      providerSnapshot = await resolveBotProviderSnapshot(this.env, botId, {
        verify: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateLoopConfig(this.env, { enabled: false }, botId).catch(() => {});
      await upsertBotRunState(this.env, {
        botId,
        state: "blocked_inference",
        blockedReason: message,
        currentRunId: null,
        nextTickAt: null,
      }).catch(() => {});
      throw error;
    }

    this.setState({
      ...this.state,
      botId,
      providerSnapshot,
    });

    const nextTickAt = await this.ensureSchedule();
    await upsertBotRunState(this.env, {
      botId,
      state: "running",
      blockedReason: null,
      providerBaseUrlHash: providerSnapshot.baseUrlHash,
      providerModel: providerSnapshot.model,
      providerPingAgeMs: providerSnapshot.pingAgeMs,
      resolutionSource: providerSnapshot.resolutionSource,
      nextTickAt,
    }).catch(() => {});

    await this.queueTick("manual");
    return config;
  }

  private async stop(botId: string): Promise<LoopConfig> {
    const config = await updateLoopConfig(this.env, { enabled: false }, botId);
    await this.clearSchedule();
    this.setState({
      ...this.state,
      botId,
      providerSnapshot: null,
      tickInFlight: false,
      lastTickStartedAt: null,
    });
    await upsertBotRunState(this.env, {
      botId,
      state: "stopped",
      blockedReason: null,
      currentRunId: null,
      nextTickAt: null,
    }).catch(() => {});
    return config;
  }

  private async queueTick(reason: TickReason): Promise<void> {
    await this.queue("queuedTick", { reason });
  }

  private async runTick(reason: TickReason): Promise<void> {
    const botId = String(this.state.botId ?? "").trim();
    if (!botId) return;

    const now = Date.now();
    if (this.state.tickInFlight) {
      const startedAt = this.state.lastTickStartedAt ?? now;
      if (now - startedAt < MAX_TICK_RUNTIME_MS) return;
    }
    this.setState({
      ...this.state,
      tickInFlight: true,
      lastTickStartedAt: now,
    });

    try {
      const [meta, config, runState] = await Promise.all([
        this.getBotMeta(botId),
        getLoopConfig(this.env, botId),
        getBotRunState(this.env, botId).catch(() => null),
      ]);
      if (!meta || !meta.enabled || !config.enabled) {
        await this.clearSchedule();
        await upsertBotRunState(this.env, {
          botId,
          state: "stopped",
          blockedReason: null,
          currentRunId: null,
          nextTickAt: null,
        }).catch(() => {});
        return;
      }

      let providerSnapshot = this.state.providerSnapshot;
      const shouldRefreshSnapshot =
        !providerSnapshot || runState?.state === "blocked_inference";
      if (shouldRefreshSnapshot) {
        const providerResolution = await resolveBotProviderSnapshot(
          this.env,
          botId,
          {
            verify: true,
          },
        ).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            error: toInferenceBlockedReason(message),
          } as const;
        });
        if ("error" in providerResolution) {
          this.setState({
            ...this.state,
            providerSnapshot: null,
          });
          await upsertBotRunState(this.env, {
            botId,
            state: "blocked_inference",
            blockedReason: providerResolution.error,
            currentRunId: runState?.currentRunId ?? null,
            nextTickAt: new Date(Date.now() + TICK_INTERVAL_MS).toISOString(),
          }).catch(() => {});
          return;
        }
        providerSnapshot = providerResolution;
        this.setState({
          ...this.state,
          providerSnapshot,
        });
      }

      await upsertBotRunState(this.env, {
        botId,
        state: "running",
        blockedReason: null,
        providerBaseUrlHash: providerSnapshot.baseUrlHash,
        providerModel: providerSnapshot.model,
        providerPingAgeMs: toProviderPingAgeMs(providerSnapshot.lastPingAt),
        resolutionSource: providerSnapshot.resolutionSource,
      }).catch(() => {});

      const result = await runAutopilotTickForTenant(
        this.env,
        this.ctx as unknown as ExecutionContext,
        {
          tenantId: botId,
          walletAddress: meta.walletAddress,
          privyWalletId: meta.privyWalletId,
        },
        reason,
        {
          skipLock: true,
          providerSnapshot,
          steering: {
            pullCheckpointMessages: async () => {
              const rows = await listPendingSteeringMessages(this.env, botId, 20);
              return rows.map((row) => ({ id: row.id, message: row.message }));
            },
            markApplied: async (ids: number[], runId: string) => {
              const lastAppliedId = await markSteeringMessagesApplied(this.env, {
                botId,
                ids,
                runId,
              });
              if (lastAppliedId) {
                await upsertBotRunState(this.env, {
                  botId,
                  state: "running",
                  steeringLastAppliedId: lastAppliedId,
                }).catch(() => {});
              }
            },
          },
          onContextCompaction: async (compaction) => {
            await upsertBotRunState(this.env, {
              botId,
              state: "running",
              compactedAt: compaction.compactedAt,
              compactedCount: compaction.compactedCount,
              messageWindowCount: compaction.messageWindowCount,
            }).catch(() => {});
          },
        },
      );
      if (
        result.error === "inference-provider-unreachable" ||
        result.error === "inference-provider-not-configured"
      ) {
        this.setState({
          ...this.state,
          providerSnapshot: null,
        });
        await upsertBotRunState(this.env, {
          botId,
          state: "blocked_inference",
          blockedReason: result.error,
          currentRunId: result.runId,
          lastTickAt: new Date().toISOString(),
          nextTickAt: new Date(Date.now() + TICK_INTERVAL_MS).toISOString(),
          providerBaseUrlHash: providerSnapshot.baseUrlHash,
          providerModel: providerSnapshot.model,
          providerPingAgeMs: toProviderPingAgeMs(providerSnapshot.lastPingAt),
          resolutionSource: providerSnapshot.resolutionSource,
        }).catch(() => {});
        return;
      }

      await upsertBotRunState(this.env, {
        botId,
        state: result.ok ? "running" : "error",
        blockedReason: result.ok ? null : result.error,
        currentRunId: result.runId,
        lastTickAt: new Date().toISOString(),
        nextTickAt: new Date(Date.now() + TICK_INTERVAL_MS).toISOString(),
        providerBaseUrlHash: providerSnapshot.baseUrlHash,
        providerModel: providerSnapshot.model,
        providerPingAgeMs: toProviderPingAgeMs(providerSnapshot.lastPingAt),
        resolutionSource: providerSnapshot.resolutionSource,
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const runState = await getBotRunState(this.env, botId).catch(() => null);
      if (
        message === "inference-provider-unreachable" ||
        message === "inference-provider-not-configured"
      ) {
        this.setState({
          ...this.state,
          providerSnapshot: null,
        });
      }
      await upsertBotRunState(this.env, {
        botId,
        state:
          message === "inference-provider-unreachable" ||
          message === "inference-provider-not-configured"
            ? "blocked_inference"
            : "error",
        blockedReason:
          message === "inference-provider-unreachable" ||
          message === "inference-provider-not-configured"
            ? message
            : runState?.blockedReason ?? message,
        lastTickAt: new Date().toISOString(),
        nextTickAt: new Date(Date.now() + TICK_INTERVAL_MS).toISOString(),
      }).catch(() => {});
    } finally {
      this.setState({
        ...this.state,
        tickInFlight: false,
      });
      await this.ensureSchedule().catch(() => {});
    }
  }

  private async ensureSchedule(): Promise<string> {
    const existingId = this.state.intervalScheduleId;
    if (existingId) {
      const existing = this.getSchedule(existingId);
      if (existing) {
        return new Date(existing.time).toISOString();
      }
      this.setState({ ...this.state, intervalScheduleId: null });
    }
    const schedule = await this.scheduleEvery(TICK_INTERVAL_SECONDS, "scheduledTick");
    this.setState({
      ...this.state,
      intervalScheduleId: schedule.id,
    });
    return new Date(schedule.time).toISOString();
  }

  private async clearSchedule(): Promise<void> {
    const scheduleId = this.state.intervalScheduleId;
    if (scheduleId) {
      await this.cancelSchedule(scheduleId).catch(() => false);
    }
    this.setState({
      ...this.state,
      intervalScheduleId: null,
    });
  }

  private async getBotMeta(botId: string): Promise<BotMeta | null> {
    const row = await this.env.WAITLIST_DB.prepare(
      `
      SELECT
        enabled,
        user_id as userId,
        wallet_address as walletAddress,
        privy_wallet_id as privyWalletId
      FROM bots
      WHERE id = ?1
      `,
    )
      .bind(botId)
      .first();
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    const userId = String(r.userId ?? "").trim();
    const walletAddress = String(r.walletAddress ?? "").trim();
    const privyWalletId = String(r.privyWalletId ?? "").trim();
    if (!userId || !walletAddress || !privyWalletId) return null;
    return {
      enabled: Number(r.enabled) === 1,
      userId,
      walletAddress,
      privyWalletId,
    };
  }
}

function toLoopConfigUpdate(payload: Record<string, unknown>): Partial<LoopConfig> {
  const update: Partial<LoopConfig> = {};
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      throw new Error("invalid-enabled");
    }
    update.enabled = payload.enabled;
  }
  if (payload.policy !== undefined) {
    validatePolicy(payload.policy);
    update.policy = payload.policy as import("../types").LoopPolicy;
  }
  if (payload.strategy !== undefined) {
    validateStrategy(payload.strategy);
    update.strategy = payload.strategy as import("../types").StrategyConfig;
  }
  if (payload.validation !== undefined) {
    validateValidationConfig(payload.validation);
    update.validation =
      payload.validation as import("../types").LoopValidationConfig;
  }
  if (payload.autotune !== undefined) {
    validateAutotuneConfig(payload.autotune);
    update.autotune = payload.autotune as import("../types").LoopAutotuneConfig;
  }
  if (payload.execution !== undefined) {
    validateExecutionConfig(payload.execution);
    update.execution = payload.execution as import("../types").ExecutionConfig;
  }
  if (payload.dataSources !== undefined) {
    validateDataSourcesConfig(payload.dataSources);
    update.dataSources =
      payload.dataSources as import("../types").DataSourcesConfig;
  }
  return update;
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

function toInferenceBlockedReason(message: string): string {
  if (
    message === "inference-provider-not-configured" ||
    message === "inference-provider-unreachable"
  ) {
    return message;
  }
  if (message.startsWith("inference-provider-ping-failed")) {
    return "inference-provider-unreachable";
  }
  return "inference-provider-unreachable";
}

function toProviderPingAgeMs(lastPingAt: string | null): number | null {
  if (!lastPingAt) return null;
  const ts = Date.parse(lastPingAt);
  if (!Number.isFinite(ts)) return null;
  const age = Date.now() - ts;
  if (!Number.isFinite(age) || age < 0) return null;
  return Math.trunc(age);
}
