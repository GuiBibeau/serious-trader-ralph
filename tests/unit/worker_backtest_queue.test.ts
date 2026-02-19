import { describe, expect, test } from "bun:test";
import { processQueuedBacktestsForTenant } from "../../apps/worker/src/backtests/queue";
import {
  enqueueBacktestRun,
  getBacktestRun,
  listBacktestRunEvents,
} from "../../apps/worker/src/backtests/repo";
import { createBacktestTestEnv } from "./_backtests_test_utils";

describe("worker backtest queue", () => {
  test("drains queued runs serially and marks completed", async () => {
    const { env, artifacts } = createBacktestTestEnv({ withArtifacts: true });
    await enqueueBacktestRun(env, {
      runId: "run-1",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });
    await enqueueBacktestRun(env, {
      runId: "run-2",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });

    const result = await processQueuedBacktestsForTenant(env, "bot-1", {
      executeRun: async (_env, run) => ({
        summary: {
          strategyLabel: `validation:${run.runId}`,
          netReturnPct: 1,
          maxDrawdownPct: 2,
          tradeCount: 3,
          validationStatus: "passed",
        },
        result: {
          ok: true,
          runId: run.runId,
        },
      }),
    });

    expect(result.processed).toBe(2);

    const run1 = await getBacktestRun(env, "bot-1", "run-1");
    const run2 = await getBacktestRun(env, "bot-1", "run-2");
    expect(run1?.status).toBe("completed");
    expect(run2?.status).toBe("completed");
    expect((run1?.resultRef ?? "").includes("backtests/bot-1/run-1")).toBe(
      true,
    );
    expect(artifacts.size).toBeGreaterThanOrEqual(2);

    const events = await listBacktestRunEvents(env, "bot-1", "run-1", 20);
    expect(
      events.some((event) => event.message === "backtest-run-started"),
    ).toBe(true);
    expect(
      events.some((event) => event.message === "backtest-run-completed"),
    ).toBe(true);
  });

  test("marks failed when executor throws", async () => {
    const { env } = createBacktestTestEnv();
    await enqueueBacktestRun(env, {
      runId: "run-err",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });

    await processQueuedBacktestsForTenant(env, "bot-1", {
      executeRun: async () => {
        throw new Error("boom");
      },
    });

    const run = await getBacktestRun(env, "bot-1", "run-err");
    expect(run?.status).toBe("failed");
    expect(run?.errorCode).toBe("backtest-run-failed");

    const events = await listBacktestRunEvents(env, "bot-1", "run-err", 20);
    expect(
      events.some((event) => event.message === "backtest-run-failed"),
    ).toBe(true);
  });
});
