import { apiBase, isRecord } from "./lib";

const BEARER_RE = /^bearer\s+/i;

const EXECUTION_ERROR_CODES = new Set([
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
] as const);

export type ExecutionErrorCode =
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
  | "not-ready"
  | "unknown";

export type ExecutionSubmitPayload = {
  schemaVersion: "v1";
  mode: "relay_signed" | "privy_execute";
  lane: "fast" | "protected" | "safe";
  metadata?: Record<string, unknown>;
  relaySigned?: {
    signedTransaction: string;
    encoding?: string;
  };
  privyExecute?: {
    intentType: "swap";
    wallet: string;
    swap: {
      inputMint: string;
      outputMint: string;
      amountAtomic: string;
      slippageBps: number;
    };
    options?: {
      commitment?: "processed" | "confirmed" | "finalized";
      simulateOnly?: boolean;
      dryRun?: boolean;
    };
  };
};

export type ExecutionSubmitAck = {
  requestId: string;
  state: string;
  terminal: boolean;
  updatedAt: string | null;
};

export type ExecutionStatusSnapshot = {
  requestId: string;
  state: string;
  terminal: boolean;
  updatedAt: string | null;
  terminalAt: string | null;
};

export type ExecutionReceiptSnapshot = {
  requestId: string;
  ready: boolean;
  outcomeStatus: string | null;
  signature: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ExecutionTerminalResult = {
  requestId: string;
  status: string;
  signature: string | null;
};

export type ExecutionTransportRequest = {
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type ExecutionTransportResponse = {
  status: number;
  payload: unknown;
};

export type ExecutionTransport = (
  request: ExecutionTransportRequest,
) => Promise<ExecutionTransportResponse>;

export class ExecutionClientError extends Error {
  readonly code: ExecutionErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly data: unknown;

  constructor(input: {
    message: string;
    code: ExecutionErrorCode;
    status: number;
    details?: Record<string, unknown> | null;
    requestId?: string | null;
    retryable: boolean;
    data?: unknown;
  }) {
    super(input.message);
    this.name = "ExecutionClientError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? null;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable;
    this.data = input.data;
  }
}

function normalizeAuthToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  return BEARER_RE.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isExecutionErrorCode(value: unknown): value is ExecutionErrorCode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "unknown" || EXECUTION_ERROR_CODES.has(normalized as never)
  );
}

function fallbackCodeForStatus(status: number): ExecutionErrorCode {
  if (status === 401) return "auth-required";
  if (status === 402) return "payment-required";
  if (status === 404) return "not-found";
  if (status === 409) return "not-ready";
  if (status >= 400 && status < 500) return "invalid-request";
  if (status >= 500) return "submission-failed";
  return "unknown";
}

export function isRetryableExecutionError(input: {
  code: ExecutionErrorCode;
  status: number;
}): boolean {
  if (input.status === 429 || input.status === 503 || input.status === 504) {
    return true;
  }
  if (
    input.code === "venue-timeout" ||
    input.code === "submission-failed" ||
    input.code === "not-ready"
  ) {
    return true;
  }
  return false;
}

function decodeExecutionError(input: {
  payload: unknown;
  status: number;
  defaultMessage: string;
}): ExecutionClientError {
  const payload = input.payload;
  let code: ExecutionErrorCode = fallbackCodeForStatus(input.status);
  let message = input.defaultMessage;
  let details: Record<string, unknown> | null = null;
  let requestId: string | null = null;

  if (isRecord(payload)) {
    const rawRequestId = String(payload.requestId ?? "").trim();
    requestId = rawRequestId || null;

    const errorField = payload.error;
    if (isRecord(errorField)) {
      const rawCode = String(errorField.code ?? "")
        .trim()
        .toLowerCase();
      if (isExecutionErrorCode(rawCode)) {
        code = rawCode;
      }
      const rawMessage = String(errorField.message ?? "").trim();
      if (rawMessage) {
        message = rawMessage;
      }
      details = isRecord(errorField.details)
        ? (errorField.details as Record<string, unknown>)
        : null;
    } else if (typeof errorField === "string" && errorField.trim()) {
      message = errorField.trim();
      const rawCode = message.toLowerCase();
      if (isExecutionErrorCode(rawCode)) {
        code = rawCode;
      }
      const reason = String(payload.reason ?? "").trim();
      if (reason) {
        details = { reason };
      }
    }
  }

  return new ExecutionClientError({
    message,
    code,
    status: input.status,
    details,
    requestId,
    retryable: isRetryableExecutionError({ code, status: input.status }),
    data: payload,
  });
}

function parseSubmitAck(payload: unknown): ExecutionSubmitAck {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-exec-submit-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const requestId = String(payload.requestId ?? "").trim();
  const status = isRecord(payload.status) ? payload.status : null;
  const state = String(status?.state ?? "").trim();
  if (!requestId || !state) {
    throw new ExecutionClientError({
      message: "invalid-exec-submit-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    requestId,
    state,
    terminal: status?.terminal === true,
    updatedAt:
      typeof status?.updatedAt === "string" && status.updatedAt.trim()
        ? status.updatedAt.trim()
        : null,
  };
}

function parseStatusSnapshot(payload: unknown): ExecutionStatusSnapshot {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-exec-status-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const requestId = String(payload.requestId ?? "").trim();
  const status = isRecord(payload.status) ? payload.status : null;
  const state = String(status?.state ?? "").trim();
  if (!requestId || !state) {
    throw new ExecutionClientError({
      message: "invalid-exec-status-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    requestId,
    state,
    terminal: status?.terminal === true,
    updatedAt:
      typeof status?.updatedAt === "string" && status.updatedAt.trim()
        ? status.updatedAt.trim()
        : null,
    terminalAt:
      typeof status?.terminalAt === "string" && status.terminalAt.trim()
        ? status.terminalAt.trim()
        : null,
  };
}

function parseReceiptSnapshot(payload: unknown): ExecutionReceiptSnapshot {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-exec-receipt-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const requestId = String(payload.requestId ?? "").trim();
  if (!requestId) {
    throw new ExecutionClientError({
      message: "invalid-exec-receipt-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }

  if (payload.ready !== true) {
    return {
      requestId,
      ready: false,
      outcomeStatus: null,
      signature: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  const outcome = receipt && isRecord(receipt.outcome) ? receipt.outcome : null;
  return {
    requestId,
    ready: true,
    outcomeStatus: String(outcome?.status ?? "").trim() || null,
    signature:
      typeof outcome?.signature === "string" && outcome.signature.trim()
        ? outcome.signature.trim()
        : null,
    errorCode:
      typeof outcome?.errorCode === "string" && outcome.errorCode.trim()
        ? outcome.errorCode.trim()
        : null,
    errorMessage:
      typeof outcome?.errorMessage === "string" && outcome.errorMessage.trim()
        ? outcome.errorMessage.trim()
        : null,
  };
}

function isExecutionSuccessStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toLowerCase();
  return normalized === "landed" || normalized === "finalized";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function defaultTransport(
  input: ExecutionTransportRequest,
): Promise<ExecutionTransportResponse> {
  const base = apiBase();
  if (!base) {
    throw new ExecutionClientError({
      message: "missing NEXT_PUBLIC_EDGE_API_BASE",
      code: "submission-failed",
      status: 503,
      retryable: true,
    });
  }
  const response = await fetch(`${base}${input.path}`, {
    method: input.method,
    headers: input.headers,
    ...(input.body ? { body: input.body } : {}),
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    status: response.status,
    payload,
  };
}

type ExecutionClientOptions = {
  authToken?: string | null;
  transport?: ExecutionTransport;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  requestRetryCount?: number;
  requestRetryBaseDelayMs?: number;
};

type RequestOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

type SubmitOptions = RequestOptions & {
  idempotencyKey?: string;
};

async function withRetries<T>(input: {
  fn: () => Promise<T>;
  retries: number;
  baseDelayMs: number;
  signal?: AbortSignal;
}): Promise<T> {
  let attempt = 0;
  while (true) {
    if (input.signal?.aborted) {
      throw new Error("execution-cancelled");
    }
    try {
      return await input.fn();
    } catch (error) {
      if (isAbortError(error)) throw error;
      const typed =
        error instanceof ExecutionClientError
          ? error
          : new ExecutionClientError({
              message:
                error instanceof Error ? error.message : "execution-error",
              code: "submission-failed",
              status: 502,
              retryable: true,
              data: error,
            });
      if (!typed.retryable || attempt >= input.retries) {
        throw typed;
      }
      const backoff = input.baseDelayMs * 2 ** attempt;
      attempt += 1;
      await sleep(backoff);
    }
  }
}

export function newExecutionIdempotencyKey(prefix = "exec"): string {
  const ts = Date.now().toString(36);
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${ts}-${token}`;
}

export function describeExecutionClientError(
  error: unknown,
  fallback = "execution-failed",
): string {
  if (error instanceof ExecutionClientError) {
    const reason = String(error.details?.reason ?? "").trim();
    if (reason) return `${error.code}:${reason}`;
    return `${error.code}:${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function createExecutionClient(options: ExecutionClientOptions) {
  const transport = options.transport ?? defaultTransport;
  const authToken = String(options.authToken ?? "").trim();
  const pollIntervalMs = Math.max(
    100,
    Math.floor(options.pollIntervalMs ?? 1200),
  );
  const pollTimeoutMs = Math.max(
    1000,
    Math.floor(options.pollTimeoutMs ?? 45000),
  );
  const requestRetryCount = Math.max(
    0,
    Math.floor(options.requestRetryCount ?? 2),
  );
  const requestRetryBaseDelayMs = Math.max(
    50,
    Math.floor(options.requestRetryBaseDelayMs ?? 250),
  );

  async function requestJson(input: {
    path: string;
    method: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    const headers: Record<string, string> = {
      ...(input.headers ?? {}),
    };
    if (authToken && !headers.authorization) {
      headers.authorization = normalizeAuthToken(authToken);
    }
    if (input.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    let response: ExecutionTransportResponse;
    try {
      response = await transport({
        path: input.path,
        method: input.method,
        headers,
        ...(input.body !== undefined
          ? { body: JSON.stringify(input.body) }
          : {}),
        signal: input.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ExecutionClientError({
        message: error instanceof Error ? error.message : "network-error",
        code: "submission-failed",
        status: 502,
        retryable: true,
        data: error,
      });
    }

    if (response.status >= 200 && response.status < 300) {
      return response.payload;
    }

    throw decodeExecutionError({
      payload: response.payload,
      status: response.status,
      defaultMessage: `http-${response.status}`,
    });
  }

  async function submit(
    payload: ExecutionSubmitPayload,
    options?: SubmitOptions,
  ): Promise<ExecutionSubmitAck> {
    const idempotencyKey =
      options?.idempotencyKey ?? newExecutionIdempotencyKey("exec");
    const response = await requestJson({
      path: "/api/x402/exec/submit",
      method: "POST",
      body: payload,
      signal: options?.signal,
      headers: {
        "idempotency-key": idempotencyKey,
        ...(options?.headers ?? {}),
      },
    });
    return parseSubmitAck(response);
  }

  async function status(
    requestId: string,
    options?: RequestOptions,
  ): Promise<ExecutionStatusSnapshot> {
    const response = await requestJson({
      path: `/api/x402/exec/status/${encodeURIComponent(requestId)}`,
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parseStatusSnapshot(response);
  }

  async function receipt(
    requestId: string,
    options?: RequestOptions,
  ): Promise<ExecutionReceiptSnapshot> {
    const response = await requestJson({
      path: `/api/x402/exec/receipt/${encodeURIComponent(requestId)}`,
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parseReceiptSnapshot(response);
  }

  async function waitForTerminalReceipt(input: {
    requestId: string;
    signal?: AbortSignal;
  }): Promise<ExecutionTerminalResult> {
    const startedAt = Date.now();
    let latestState = "queued";

    while (Date.now() - startedAt < pollTimeoutMs) {
      if (input.signal?.aborted) {
        throw new Error("execution-cancelled");
      }

      const statusSnapshot = await withRetries({
        fn: () => status(input.requestId, { signal: input.signal }),
        retries: requestRetryCount,
        baseDelayMs: requestRetryBaseDelayMs,
        signal: input.signal,
      });
      latestState = statusSnapshot.state;

      if (statusSnapshot.terminal) {
        const receiptSnapshot = await withRetries({
          fn: () => receipt(input.requestId, { signal: input.signal }),
          retries: requestRetryCount,
          baseDelayMs: requestRetryBaseDelayMs,
          signal: input.signal,
        });

        if (!receiptSnapshot.ready) {
          if (
            latestState === "failed" ||
            latestState === "expired" ||
            latestState === "rejected"
          ) {
            throw new ExecutionClientError({
              message: `execution-${latestState}`,
              code: "submission-failed",
              status: 409,
              retryable: false,
              requestId: input.requestId,
            });
          }
          await sleep(pollIntervalMs);
          continue;
        }

        const outcomeStatus =
          receiptSnapshot.outcomeStatus?.toLowerCase() ??
          latestState.toLowerCase();

        if (isExecutionSuccessStatus(outcomeStatus)) {
          return {
            requestId: input.requestId,
            status: outcomeStatus,
            signature: receiptSnapshot.signature,
          };
        }

        throw new ExecutionClientError({
          message:
            receiptSnapshot.errorCode ??
            receiptSnapshot.errorMessage ??
            `execution-${outcomeStatus}`,
          code: isExecutionErrorCode(receiptSnapshot.errorCode)
            ? receiptSnapshot.errorCode
            : "submission-failed",
          status: 409,
          retryable: false,
          requestId: input.requestId,
          details: {
            outcomeStatus,
          },
        });
      }

      await sleep(pollIntervalMs);
    }

    throw new ExecutionClientError({
      message: `execution-timeout:${latestState}`,
      code: "venue-timeout",
      status: 504,
      retryable: true,
      requestId: input.requestId,
    });
  }

  return {
    submit,
    status,
    receipt,
    waitForTerminalReceipt,
  };
}
