import { describe, expect, test } from "bun:test";
import {
  appendBacktestRunEvent,
  claimNextQueuedBacktestRun,
  completeBacktestRun,
  countBacktestRunsByStatus,
  enqueueBacktestRun,
  failBacktestRun,
  getBacktestRun,
  listBacktestRunEvents,
  listBacktestRuns,
} from "../../apps/worker/src/backtests/repo";
import { createBacktestTestEnv } from "./_backtests_test_utils";

describe("worker backtests repo", () => {
  test("enqueue + list + get roundtrip", async () => {
    const { env } = createBacktestTestEnv();

    await enqueueBacktestRun(env, {
      runId: "run-1",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });

    const listed = await listBacktestRuns(env, "bot-1", { limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.runId).toBe("run-1");
    expect(listed[0]?.status).toBe("queued");

    const single = await getBacktestRun(env, "bot-1", "run-1");
    expect(single?.runId).toBe("run-1");
    expect(single?.status).toBe("queued");
  });

  test("claim transitions queued run to running in FIFO order", async () => {
    const { env } = createBacktestTestEnv();
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

    const first = await claimNextQueuedBacktestRun(env, "bot-1");
    expect(first?.runId).toBe("run-1");
    expect(first?.status).toBe("running");

    const second = await claimNextQueuedBacktestRun(env, "bot-1");
    expect(second?.runId).toBe("run-2");
    expect(second?.status).toBe("running");
  });

  test("complete and fail update terminal state and counters", async () => {
    const { env } = createBacktestTestEnv();
    await enqueueBacktestRun(env, {
      runId: "run-ok",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });
    await enqueueBacktestRun(env, {
      runId: "run-fail",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });

    await completeBacktestRun(env, {
      tenantId: "bot-1",
      runId: "run-ok",
      summary: {
        strategyLabel: "validation:dca",
        netReturnPct: 2.5,
        maxDrawdownPct: 1.2,
        tradeCount: 12,
        validationStatus: "passed",
      },
    });
    await failBacktestRun(env, {
      tenantId: "bot-1",
      runId: "run-fail",
      errorCode: "backtest-run-failed",
      errorMessage: "boom",
    });

    const done = await countBacktestRunsByStatus(env, "bot-1", [
      "completed",
      "failed",
    ]);
    expect(done).toBe(2);

    const listed = await listBacktestRuns(env, "bot-1", { limit: 10 });
    const ok = listed.find((row) => row.runId === "run-ok");
    const failed = listed.find((row) => row.runId === "run-fail");
    expect(ok?.summary?.tradeCount).toBe(12);
    expect(failed?.status).toBe("failed");
  });

  test("stores and loads run events", async () => {
    const { env } = createBacktestTestEnv();
    await enqueueBacktestRun(env, {
      runId: "run-1",
      tenantId: "bot-1",
      kind: "validation",
      request: { kind: "validation" },
    });

    await appendBacktestRunEvent(env, {
      runId: "run-1",
      tenantId: "bot-1",
      level: "info",
      message: "started",
      meta: { step: 1 },
    });
    await appendBacktestRunEvent(env, {
      runId: "run-1",
      tenantId: "bot-1",
      level: "error",
      message: "failed",
      meta: { error: "x" },
    });

    const events = await listBacktestRunEvents(env, "bot-1", "run-1", 10);
    expect(events).toHaveLength(2);
    expect(events[0]?.message).toBe("started");
    expect(events[1]?.level).toBe("error");
  });
});
