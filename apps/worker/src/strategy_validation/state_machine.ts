import type { StrategyLifecycleState, StrategyRuntimeStateRow } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

function nextRevalidateIso(nowMs: number): string {
  return new Date(nowMs + DAY_MS).toISOString();
}

export function runtimeDefault(tenantId: string): StrategyRuntimeStateRow {
  return {
    tenantId,
    lifecycleState: "candidate",
    activeStrategyHash: null,
    lastValidationId: null,
    consecutiveFailures: 0,
    lastTunedAt: null,
    nextRevalidateAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function applyValidationOutcome(
  current: StrategyRuntimeStateRow,
  input: {
    status: "passed" | "failed";
    validationId: number;
    strategyHash: string;
    nowMs?: number;
  },
): StrategyRuntimeStateRow {
  const nowMs = input.nowMs ?? Date.now();
  if (input.status === "passed") {
    const state: StrategyLifecycleState =
      current.lifecycleState === "suspended" ? "watch" : "validated";
    return {
      ...current,
      lifecycleState: state,
      activeStrategyHash: input.strategyHash,
      lastValidationId: input.validationId,
      consecutiveFailures: 0,
      nextRevalidateAt: nextRevalidateIso(nowMs),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  const failures = (current.consecutiveFailures ?? 0) + 1;
  return {
    ...current,
    lifecycleState: failures >= 2 ? "suspended" : "watch",
    lastValidationId: input.validationId,
    consecutiveFailures: failures,
    nextRevalidateAt: nextRevalidateIso(nowMs),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function markCandidateState(
  current: StrategyRuntimeStateRow,
  nowMs = Date.now(),
): StrategyRuntimeStateRow {
  return {
    ...current,
    lifecycleState: "candidate",
    consecutiveFailures: 0,
    nextRevalidateAt: null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function markActiveState(
  current: StrategyRuntimeStateRow,
  nowMs = Date.now(),
): StrategyRuntimeStateRow {
  return {
    ...current,
    lifecycleState: "active",
    updatedAt: new Date(nowMs).toISOString(),
  };
}
