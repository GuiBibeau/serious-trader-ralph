export type BacktestRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type BacktestListItemLite = {
  runId: string;
  status: BacktestRunStatus;
  strategyLabel: string;
};

export type BacktestTransition = {
  run: BacktestListItemLite;
  from: BacktestRunStatus;
  to: Extract<BacktestRunStatus, "completed" | "failed" | "canceled">;
};

function isTerminal(
  status: BacktestRunStatus,
): status is "completed" | "failed" | "canceled" {
  return status === "completed" || status === "failed" || status === "canceled";
}

function isInFlight(status: BacktestRunStatus): boolean {
  return status === "queued" || status === "running";
}

export function detectBacktestTerminalTransitions(input: {
  previousStatuses: Record<string, BacktestRunStatus>;
  nextRuns: BacktestListItemLite[];
  bootstrapped: boolean;
  seenTerminalKeys: Set<string>;
}): {
  transitions: BacktestTransition[];
  nextStatuses: Record<string, BacktestRunStatus>;
} {
  const transitions: BacktestTransition[] = [];
  const nextStatuses: Record<string, BacktestRunStatus> = {
    ...input.previousStatuses,
  };

  for (const run of input.nextRuns) {
    const previous = input.previousStatuses[run.runId];
    nextStatuses[run.runId] = run.status;

    if (!input.bootstrapped) continue;
    if (!previous) continue;
    if (!isInFlight(previous)) continue;
    if (!isTerminal(run.status)) continue;

    const key = `${run.runId}:${run.status}`;
    if (input.seenTerminalKeys.has(key)) continue;
    input.seenTerminalKeys.add(key);

    transitions.push({
      run,
      from: previous,
      to: run.status,
    });
  }

  return {
    transitions,
    nextStatuses,
  };
}
