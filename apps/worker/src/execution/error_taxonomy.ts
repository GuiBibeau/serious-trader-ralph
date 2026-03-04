import type { JsonObject } from "./repository";

export type CanonicalExecutionErrorCode =
  | "payment-required"
  | "auth-required"
  | "invalid-request"
  | "invalid-transaction"
  | "policy-denied"
  | "unsupported-lane"
  | "insufficient-balance"
  | "venue-timeout"
  | "submission-failed"
  | "expired-blockhash"
  | "not-found"
  | "not-ready";

const CANONICAL_ERROR_CODES = new Set<CanonicalExecutionErrorCode>([
  "payment-required",
  "auth-required",
  "invalid-request",
  "invalid-transaction",
  "policy-denied",
  "unsupported-lane",
  "insufficient-balance",
  "venue-timeout",
  "submission-failed",
  "expired-blockhash",
  "not-found",
  "not-ready",
]);

const DEFAULT_MESSAGES: Record<CanonicalExecutionErrorCode, string> = {
  "payment-required": "x402 payment is required for this request",
  "auth-required": "authentication is required",
  "invalid-request": "request payload is invalid",
  "invalid-transaction": "transaction payload is invalid",
  "policy-denied": "execution policy denied this request",
  "unsupported-lane": "requested execution lane is not supported",
  "insufficient-balance": "insufficient balance for requested execution",
  "venue-timeout": "execution venue timed out",
  "submission-failed": "execution submission failed",
  "expired-blockhash": "transaction blockhash expired",
  "not-found": "execution request was not found",
  "not-ready": "execution receipt is not ready",
};

function readCodeFromObject(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String((value as { code?: unknown }).code ?? "")
    .trim()
    .toLowerCase();
}

function readReasonFromObject(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String((value as { reason?: unknown }).reason ?? "")
    .trim()
    .toLowerCase();
}

function asLowerMessage(value: unknown): string {
  if (value instanceof Error) return value.message.trim().toLowerCase();
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const message = String(record.message ?? "")
      .trim()
      .toLowerCase();
    const reason = String(record.reason ?? "")
      .trim()
      .toLowerCase();
    return `${message} ${reason}`.trim();
  }
  return "";
}

export function isCanonicalExecutionErrorCode(
  value: unknown,
): value is CanonicalExecutionErrorCode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase() as CanonicalExecutionErrorCode;
  return CANONICAL_ERROR_CODES.has(normalized);
}

export function normalizeExecutionErrorCode(input: {
  statusHint?: string | null;
  error?: unknown;
  fallback?: CanonicalExecutionErrorCode;
}): CanonicalExecutionErrorCode {
  const directCode = readCodeFromObject(input.error);
  if (isCanonicalExecutionErrorCode(directCode)) {
    return directCode;
  }

  const directReason = readReasonFromObject(input.error);
  if (directReason.startsWith("policy-denied")) {
    return "policy-denied";
  }

  const message = asLowerMessage(input.error);
  const joined = `${message} ${String(input.statusHint ?? "")
    .trim()
    .toLowerCase()}`;

  if (joined.includes("payment-required")) return "payment-required";
  if (joined.includes("auth-required") || joined.includes("unauthorized")) {
    return "auth-required";
  }
  if (joined.includes("invalid-transaction")) return "invalid-transaction";
  if (
    joined.includes("invalid-request") ||
    joined.includes("missing-idempotency-key")
  ) {
    return "invalid-request";
  }
  if (joined.includes("unsupported-lane")) return "unsupported-lane";
  if (joined.includes("policy-denied")) return "policy-denied";
  if (
    joined.includes("insufficient") &&
    (joined.includes("balance") ||
      joined.includes("reserve") ||
      joined.includes("token"))
  ) {
    return "insufficient-balance";
  }
  if (joined.includes("timeout")) return "venue-timeout";
  if (
    joined.includes("blockhash") &&
    (joined.includes("expired") ||
      joined.includes("stale") ||
      joined.includes("not found"))
  ) {
    return "expired-blockhash";
  }
  if (joined.includes("not-found")) return "not-found";
  if (joined.includes("not-ready")) return "not-ready";

  if (input.statusHint === "simulate_error" || input.statusHint === "error") {
    return "submission-failed";
  }

  return input.fallback ?? "submission-failed";
}

export function executionErrorStatus(
  code: CanonicalExecutionErrorCode,
): number {
  switch (code) {
    case "payment-required":
      return 402;
    case "auth-required":
      return 401;
    case "policy-denied":
      return 403;
    case "unsupported-lane":
      return 400;
    case "not-found":
      return 404;
    case "not-ready":
      return 409;
    case "venue-timeout":
      return 504;
    case "submission-failed":
      return 502;
    case "expired-blockhash":
      return 409;
    default:
      return 400;
  }
}

export function executionErrorMessage(
  code: CanonicalExecutionErrorCode,
): string {
  return DEFAULT_MESSAGES[code] ?? DEFAULT_MESSAGES["submission-failed"];
}

export function buildExecutionErrorEnvelope(input: {
  code: CanonicalExecutionErrorCode;
  message?: string | null;
  details?: JsonObject | null;
  requestId?: string | null;
}): {
  ok: false;
  requestId?: string | null;
  error: {
    code: CanonicalExecutionErrorCode;
    message: string;
    details?: JsonObject;
  };
} {
  const message =
    String(input.message ?? "").trim() || executionErrorMessage(input.code);
  const envelope: {
    ok: false;
    requestId?: string | null;
    error: {
      code: CanonicalExecutionErrorCode;
      message: string;
      details?: JsonObject;
    };
  } = {
    ok: false,
    error: {
      code: input.code,
      message,
    },
  };
  if (input.requestId !== undefined) {
    envelope.requestId = input.requestId;
  }
  if (input.details && Object.keys(input.details).length > 0) {
    envelope.error.details = input.details;
  }
  return envelope;
}
