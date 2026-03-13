import type {
  ExecutionAttemptRecord,
  ExecutionReceiptRecord,
  ExecutionRequestRecord,
  JsonObject,
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
  intent?: {
    family: string;
    marketType?: string;
    venueKey?: string;
    instrumentId?: string;
    inputMint?: string;
    outputMint?: string;
    outcomeId?: string;
    referenceId?: string;
    side?: string;
    settlementMint?: string;
    borrowLegCount?: number;
  };
  lifecycle?: {
    orderState?: string;
    fillState?: string;
    positionState?: string;
    settlementState?: string;
    notes?: string[];
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : null;
}

function readIntentSummary(
  metadata: JsonObject | null,
): CanonicalExecutionReceiptV1["intent"] | undefined {
  const record = isRecord(metadata?.intent) ? metadata?.intent : null;
  if (!record) return undefined;
  const family = readString(record.family);
  if (!family) return undefined;
  return {
    family,
    ...(readString(record.marketType)
      ? { marketType: readString(record.marketType) as string }
      : {}),
    ...(readString(record.venueKey)
      ? { venueKey: readString(record.venueKey) as string }
      : {}),
    ...(readString(record.instrumentId)
      ? { instrumentId: readString(record.instrumentId) as string }
      : {}),
    ...(readString(record.inputMint)
      ? { inputMint: readString(record.inputMint) as string }
      : {}),
    ...(readString(record.outputMint)
      ? { outputMint: readString(record.outputMint) as string }
      : {}),
    ...(readString(record.outcomeId)
      ? { outcomeId: readString(record.outcomeId) as string }
      : {}),
    ...(readString(record.referenceId)
      ? { referenceId: readString(record.referenceId) as string }
      : {}),
    ...(readString(record.side)
      ? { side: readString(record.side) as string }
      : {}),
    ...(readString(record.settlementMint)
      ? { settlementMint: readString(record.settlementMint) as string }
      : {}),
    ...(readNumber(record.borrowLegCount) !== null
      ? { borrowLegCount: readNumber(record.borrowLegCount) as number }
      : {}),
  };
}

function readLifecycleSummary(
  receipt: JsonObject | null,
): CanonicalExecutionReceiptV1["lifecycle"] | undefined {
  const record = isRecord(receipt?.lifecycle) ? receipt?.lifecycle : null;
  if (!record) return undefined;
  const notes = readStringArray(record.notes);
  const lifecycle = {
    ...(readString(record.orderState)
      ? { orderState: readString(record.orderState) as string }
      : {}),
    ...(readString(record.fillState)
      ? { fillState: readString(record.fillState) as string }
      : {}),
    ...(readString(record.positionState)
      ? { positionState: readString(record.positionState) as string }
      : {}),
    ...(readString(record.settlementState)
      ? { settlementState: readString(record.settlementState) as string }
      : {}),
    ...(notes ? { notes } : {}),
  };
  return Object.keys(lifecycle).length > 0 ? lifecycle : undefined;
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
    ...(readIntentSummary(input.request.metadata)
      ? { intent: readIntentSummary(input.request.metadata) }
      : {}),
    ...(readLifecycleSummary(input.receipt.receipt)
      ? { lifecycle: readLifecycleSummary(input.receipt.receipt) }
      : {}),
    ...(input.immutability ? { immutability: input.immutability } : {}),
  };
}
