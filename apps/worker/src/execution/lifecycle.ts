export type ExecutionLifecycleStatus =
  | "received"
  | "validated"
  | "queued"
  | "dispatched"
  | "landed"
  | "finalized"
  | "failed"
  | "expired"
  | "rejected";

const EXECUTION_TERMINAL_STATUS_SET = new Set<ExecutionLifecycleStatus>([
  "landed",
  "finalized",
  "failed",
  "expired",
  "rejected",
]);

const EXECUTION_STATUS_TRANSITIONS: Record<
  ExecutionLifecycleStatus,
  ReadonlySet<ExecutionLifecycleStatus>
> = {
  received: new Set(["validated", "failed", "expired", "rejected"]),
  validated: new Set(["queued", "dispatched", "failed", "expired", "rejected"]),
  queued: new Set(["dispatched", "failed", "expired", "rejected"]),
  dispatched: new Set(["landed", "failed", "expired", "rejected"]),
  landed: new Set(["finalized", "failed", "expired", "rejected"]),
  finalized: new Set([]),
  failed: new Set([]),
  expired: new Set([]),
  rejected: new Set([]),
};

export function isTerminalExecutionStatus(
  status: ExecutionLifecycleStatus,
): boolean {
  return EXECUTION_TERMINAL_STATUS_SET.has(status);
}

export function canTransitionExecutionStatus(
  fromStatus: ExecutionLifecycleStatus,
  toStatus: ExecutionLifecycleStatus,
): boolean {
  if (fromStatus === toStatus) return true;
  return EXECUTION_STATUS_TRANSITIONS[fromStatus].has(toStatus);
}

export function assertExecutionStatusTransition(input: {
  fromStatus: ExecutionLifecycleStatus;
  toStatus: ExecutionLifecycleStatus;
}): void {
  if (canTransitionExecutionStatus(input.fromStatus, input.toStatus)) return;
  throw new Error(
    `illegal-execution-status-transition:${input.fromStatus}->${input.toStatus}`,
  );
}
