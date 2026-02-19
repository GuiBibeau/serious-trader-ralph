import { describe, expect, test } from "bun:test";
import {
  newBacktestRunId,
  normalizeBacktestRunRequest,
} from "../../apps/worker/src/backtests/engine";

describe("worker backtest api request normalization", () => {
  test("defaults to validation kind", () => {
    const request = normalizeBacktestRunRequest({});
    expect(request.kind).toBe("validation");
  });

  test("normalizes strategy_json spec", () => {
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
          lookbackDays: 999,
          minTrades: 0,
          effectiveCostBps: 99999,
          profile: "strict",
        },
      },
    });

    expect(request.kind).toBe("strategy_json");
    if (request.kind !== "strategy_json") return;
    expect(request.spec.validation?.lookbackDays).toBe(120);
    expect(request.spec.validation?.minTrades).toBe(1);
    expect(request.spec.validation?.effectiveCostBps).toBe(10000);
    expect(request.spec.validation?.profile).toBe("strict");
  });

  test("rejects invalid strategy_json payloads", () => {
    expect(() =>
      normalizeBacktestRunRequest({
        kind: "strategy_json",
      }),
    ).toThrow(/invalid-backtest-spec/);

    expect(() =>
      normalizeBacktestRunRequest({
        kind: "strategy_json",
        spec: {
          strategy: { type: "dca" },
          market: { baseMint: "", quoteMint: "" },
        },
      }),
    ).toThrow(/invalid-backtest-market-mints/);
  });

  test("creates UUID run ids", () => {
    const runId = newBacktestRunId();
    expect(typeof runId).toBe("string");
    expect(runId.length).toBeGreaterThan(20);
  });
});
