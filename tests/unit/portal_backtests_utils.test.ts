import { describe, expect, test } from "bun:test";
import {
  type BacktestListItemLite,
  type BacktestRunStatus,
  detectBacktestTerminalTransitions,
} from "../../apps/portal/app/app/bots/[botId]/backtests-utils";

function run(
  previousStatuses: Record<string, BacktestRunStatus>,
  nextRuns: BacktestListItemLite[],
  bootstrapped: boolean,
  seenTerminalKeys = new Set<string>(),
) {
  return detectBacktestTerminalTransitions({
    previousStatuses,
    nextRuns,
    bootstrapped,
    seenTerminalKeys,
  });
}

describe("portal backtest toast transitions", () => {
  test("does not emit transitions on initial bootstrap", () => {
    const result = run(
      {},
      [
        {
          runId: "run-1",
          status: "completed",
          strategyLabel: "validation:dca",
        },
      ],
      false,
    );
    expect(result.transitions).toHaveLength(0);
    expect(result.nextStatuses["run-1"]).toBe("completed");
  });

  test("emits transition when run moves from running to completed", () => {
    const result = run(
      { "run-1": "running" },
      [
        {
          runId: "run-1",
          status: "completed",
          strategyLabel: "validation:dca",
        },
      ],
      true,
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]?.from).toBe("running");
    expect(result.transitions[0]?.to).toBe("completed");
  });

  test("deduplicates the same terminal transition", () => {
    const seen = new Set<string>();
    const first = run(
      { "run-1": "queued" },
      [{ runId: "run-1", status: "failed", strategyLabel: "validation:dca" }],
      true,
      seen,
    );
    expect(first.transitions).toHaveLength(1);

    const second = run(
      { "run-1": "queued" },
      [{ runId: "run-1", status: "failed", strategyLabel: "validation:dca" }],
      true,
      seen,
    );
    expect(second.transitions).toHaveLength(0);
  });

  test("does not emit transition for non-terminal status change", () => {
    const result = run(
      { "run-1": "queued" },
      [{ runId: "run-1", status: "running", strategyLabel: "validation:dca" }],
      true,
    );
    expect(result.transitions).toHaveLength(0);
  });
});
