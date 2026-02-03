import { getLoopConfig } from "./config";
import { appendLog, makeLogKey } from "./logs";
import type { Env } from "./types";

export async function runAutopilotTick(env: Env, ctx: ExecutionContext) {
  const config = await getLoopConfig(env);
  if (!config.enabled) {
    return;
  }

  // TODO: Port the autonomous trading loop to Workers runtime.
  // This is the entry point that will run on cron. Keep it small and pure.
  console.log(
    JSON.stringify({
      level: "info",
      message: "autopilot tick (edge)",
      ts: new Date().toISOString(),
      policy: config.policy ?? null,
    }),
  );

  const logKey = makeLogKey("default");
  await appendLog(
    env,
    logKey,
    JSON.stringify({
      level: "info",
      message: "autopilot tick (edge)",
      ts: new Date().toISOString(),
      policy: config.policy ?? null,
    }),
  );

  ctx.waitUntil(Promise.resolve());
}
