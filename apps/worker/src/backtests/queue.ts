import type { Env } from "../types";
import { executeBacktestRun } from "./engine";
import {
  appendBacktestRunEvent,
  claimNextQueuedBacktestRun,
  completeBacktestRun,
  failBacktestRun,
} from "./repo";

async function writeBacktestArtifact(
  env: Env,
  tenantId: string,
  runId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (!env.LOGS_BUCKET) return null;
  const key = `backtests/${tenantId}/${runId}.json`;
  await env.LOGS_BUCKET.put(key, JSON.stringify(payload, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
  return key;
}

function errorCodeFromMessage(message: string): string {
  if (message === "not-enough-bars") return "not-enough-bars";
  if (message === "no-strategy-runner-registered")
    return "unsupported-strategy-runner";
  if (message.startsWith("invalid-backtest")) return message;
  return "backtest-run-failed";
}

export async function processQueuedBacktestsForTenant(
  env: Env,
  tenantId: string,
  options?: {
    executeRun?: typeof executeBacktestRun;
  },
): Promise<{ processed: number }> {
  let processed = 0;
  const executeRun = options?.executeRun ?? executeBacktestRun;

  for (;;) {
    const run = await claimNextQueuedBacktestRun(env, tenantId);
    if (!run) break;
    processed += 1;

    await appendBacktestRunEvent(env, {
      runId: run.runId,
      tenantId,
      level: "info",
      message: "backtest-run-started",
      meta: {
        kind: run.kind,
      },
    }).catch(() => {});

    try {
      const executed = await executeRun(env, run);
      const artifactRef = await writeBacktestArtifact(
        env,
        tenantId,
        run.runId,
        {
          run: {
            runId: run.runId,
            tenantId: run.tenantId,
            kind: run.kind,
            request: run.request,
            queuedAt: run.queuedAt,
            startedAt: run.startedAt,
          },
          summary: executed.summary,
          result: executed.result,
        },
      ).catch(() => null);

      await completeBacktestRun(env, {
        tenantId,
        runId: run.runId,
        summary: executed.summary,
        resultRef: artifactRef,
      });

      await appendBacktestRunEvent(env, {
        runId: run.runId,
        tenantId,
        level: "info",
        message: "backtest-run-completed",
        meta: {
          summary: executed.summary,
          result: executed.result,
          resultRef: artifactRef,
        },
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = errorCodeFromMessage(message);

      await failBacktestRun(env, {
        tenantId,
        runId: run.runId,
        errorCode,
        errorMessage: message,
      });

      await appendBacktestRunEvent(env, {
        runId: run.runId,
        tenantId,
        level: "error",
        message: "backtest-run-failed",
        meta: {
          errorCode,
          errorMessage: message,
        },
      }).catch(() => {});
    }
  }

  return { processed };
}
