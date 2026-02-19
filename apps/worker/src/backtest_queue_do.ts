import { processQueuedBacktestsForTenant } from "./backtests/queue";
import { json } from "./response";
import type { Env } from "./types";

type QueueStatus = {
  processing: boolean;
  tenantId: string;
};

const BOT_ID_HEADER = "x-ralph-bot-id";

export class BacktestQueue {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private processing = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const botId = request.headers.get(BOT_ID_HEADER)?.trim();
    let storedBotId = (await this.state.storage.get<string>("botId")) ?? "";
    if (botId && botId !== storedBotId) {
      await this.state.storage.put("botId", botId);
      storedBotId = botId;
    }

    if (!storedBotId) {
      return json({ ok: false, error: "missing-bot-id" }, { status: 400 });
    }

    if (request.method === "GET" && path === "/status") {
      const status: QueueStatus = {
        processing: this.processing,
        tenantId: storedBotId,
      };
      return json({ ok: true, status });
    }

    if (request.method === "POST" && path === "/enqueue") {
      await this.state.storage.setAlarm(Date.now());
      this.state.waitUntil(this.drain(storedBotId));
      return json({ ok: true, queued: true });
    }

    if (request.method === "POST" && path === "/drain") {
      await this.drain(storedBotId);
      return json({ ok: true, drained: true });
    }

    return json({ ok: false, error: "not-found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    const botId = (await this.state.storage.get<string>("botId")) ?? "";
    if (!botId) return;
    await this.drain(botId);
  }

  private async drain(tenantId: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await processQueuedBacktestsForTenant(this.env, tenantId);
    } finally {
      this.processing = false;
    }
  }
}
