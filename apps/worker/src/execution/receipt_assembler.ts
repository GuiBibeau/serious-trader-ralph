import type {
  ExecutionAttemptRecord,
  ExecutionReceiptRecord,
  ExecutionRequestRecord,
} from "./repository";

export type CanonicalExecutionReceiptV1 = {
  schemaVersion: "v1";
  receiptId: string;
  requestId: string;
  mode: string;
  lane: string;
  actorType: string;
  provider: string;
  generatedAt: string;
  outcome: {
    status: "finalized" | "failed" | "expired";
    signature: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  trace: {
    receivedAt: string;
    validatedAt: string | null;
    dispatchedAt: string | null;
    landedAt: string | null;
    terminalAt: string | null;
  };
  attempts: Array<{
    attempt: number;
    provider: string;
    state: string;
    at: string;
  }>;
  immutability?: {
    hashAlgorithm: string;
    receivedTxHash: string;
    submittedTxHash?: string;
    verifiedTxHash?: string;
  };
};

function toOutcomeStatus(status: string): "finalized" | "failed" | "expired" {
  if (status === "expired") return "expired";
  if (status === "landed" || status === "finalized") return "finalized";
  return "failed";
}

export function canonicalExecutionReceiptStorageKey(requestId: string): string {
  return `exec/v1/receipts/request_id=${requestId}.json`;
}

export function assembleCanonicalExecutionReceiptV1(input: {
  request: ExecutionRequestRecord;
  receipt: ExecutionReceiptRecord;
  attempts: ExecutionAttemptRecord[];
  immutability?: {
    hashAlgorithm: string;
    receivedTxHash: string;
    submittedTxHash?: string;
    verifiedTxHash?: string;
  } | null;
}): CanonicalExecutionReceiptV1 {
  const latestAttempt =
    input.attempts.length > 0
      ? input.attempts[input.attempts.length - 1]
      : null;
  const provider =
    input.receipt.provider ?? latestAttempt?.provider ?? "unknown";
  const landedAt =
    input.receipt.finalizedStatus === "landed" ||
    input.receipt.finalizedStatus === "finalized"
      ? input.receipt.readyAt
      : null;

  return {
    schemaVersion: "v1",
    receiptId: input.receipt.receiptId,
    requestId: input.request.requestId,
    mode: input.request.mode,
    lane: input.request.lane,
    actorType: input.request.actorType,
    provider,
    generatedAt: input.receipt.readyAt,
    outcome: {
      status: toOutcomeStatus(input.receipt.finalizedStatus),
      signature: input.receipt.signature,
      errorCode: input.receipt.errorCode,
      errorMessage: input.receipt.errorMessage,
    },
    trace: {
      receivedAt: input.request.receivedAt,
      validatedAt: input.request.validatedAt,
      dispatchedAt: latestAttempt?.startedAt ?? null,
      landedAt,
      terminalAt: input.request.terminalAt,
    },
    attempts: input.attempts.map((attempt) => ({
      attempt: attempt.attemptNo,
      provider: attempt.provider,
      state: attempt.status,
      at: attempt.completedAt ?? attempt.startedAt,
    })),
    ...(input.immutability ? { immutability: input.immutability } : {}),
  };
}
