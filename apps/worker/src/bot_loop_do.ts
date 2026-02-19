import { json } from "./response";
import type { Env } from "./types";

const BOT_ID_HEADER = "x-ralph-bot-id";
const LEGACY_LOOP_ERROR = "legacy-loop-runtime-disabled";

// Legacy durable object kept only to drain old instances and alarms.
// Active execution uses TradingOrchestratorAgent exclusively.
export class BotLoop {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const botId = request.headers.get(BOT_ID_HEADER)?.trim();
    if (botId) {
      await this.state.storage.put("botId", botId).catch(() => {});
    }
    await this.state.storage.deleteAlarm().catch(() => {});
    return json({ ok: false, error: LEGACY_LOOP_ERROR }, { status: 410 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAlarm().catch(() => {});
  }
}
