import { describe, expect, test } from "bun:test";
import { normalizeBacktestRunRequest } from "../../apps/worker/src/backtests/engine";
import { processQueuedBacktestsForTenant } from "../../apps/worker/src/backtests/queue";
import {
  enqueueBacktestRun,
  getBacktestRun,
  listBacktestRunEvents,
} from "../../apps/worker/src/backtests/repo";
import { createBacktestTestEnv } from "../unit/_backtests_test_utils";

describe("worker backtests integration", () => {
  test("strategy_json run reaches terminal state with summary and events", async () => {
    const { env } = createBacktestTestEnv({
      loopConfig: {
        enabled: false,
        policy: { slippageBps: 50 },
        strategy: {
          type: "dca",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000",
          everyMinutes: 60,
        },
        validation: {
          enabled: true,
          lookbackDays: 30,
          profile: "balanced",
          minTrades: 8,
        },
        dataSources: {
          priority: ["fixture"],
          fixturePattern: "uptrend",
        },
      },
      withArtifacts: true,
    });

    const request = normalizeBacktestRunRequest({
      kind: "strategy_json",
      spec: {
        strategy: {
          type: "dca",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000",
          everyMinutes: 60,
        },
        market: {
          baseMint: "So11111111111111111111111111111111111111112",
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
        validation: {
          lookbackDays: 20,
          profile: "balanced",
          minTrades: 1,
        },
      },
    });

    await enqueueBacktestRun(env, {
      runId: "integration-run-1",
      tenantId: "bot-int",
      kind: request.kind,
      request,
    });

    const drain = await processQueuedBacktestsForTenant(env, "bot-int");
    expect(drain.processed).toBe(1);

    const run = await getBacktestRun(env, "bot-int", "integration-run-1");
    expect(run).not.toBeNull();
    expect(run?.status).toBe("completed");
    expect(run?.summary).not.toBeNull();
    expect(Number(run?.summary?.tradeCount ?? 0)).toBeGreaterThanOrEqual(0);

    const events = await listBacktestRunEvents(
      env,
      "bot-int",
      "integration-run-1",
      100,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.some((event) => event.message === "backtest-run-completed"),
    ).toBe(true);
  });
});
