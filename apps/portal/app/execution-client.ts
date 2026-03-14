import { apiBase, isRecord } from "./lib";
import {
  parseTerminalIntentFamily,
  parseTerminalMarketType,
  parseTerminalOracleStatus,
  parseTerminalProviderStatus,
  parseTerminalVenueKey,
  type TerminalIntentFamily,
  type TerminalMarketType,
  type TerminalOracleStatus,
  type TerminalProviderStatus,
  type TerminalVenueKey,
} from "./terminal/terminal-venues";

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

export type ExecutionSubmitPayload =
  | {
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
          requireSimulation?: boolean;
          dryRun?: boolean;
          priorityMicroLamports?: number;
          orderType?: "market" | "limit" | "trigger";
          timeInForce?: "gtc" | "ioc" | "fok";
          reduceOnly?: boolean;
          postOnly?: boolean;
          quantityMode?: "base" | "quote" | "notional";
          limitPriceAtomic?: string;
          triggerPriceAtomic?: string;
          takeProfitPriceAtomic?: string;
          stopLossPriceAtomic?: string;
        };
      };
    }
  | {
      schemaVersion: "v2";
      mode: "privy_execute";
      lane: "fast" | "protected" | "safe";
      metadata?: Record<string, unknown>;
      privyExecute: {
        wallet: string;
        intent: {
          family: TerminalIntentFamily;
          venueKey: TerminalVenueKey;
          marketType: TerminalMarketType;
          instrumentId: string;
          instrumentLabel?: string;
          side: "buy" | "sell" | "long" | "short";
          quantityAtomic?: string;
          collateralAtomic?: string;
          notionalAtomic?: string;
        };
        options?: {
          commitment?: "processed" | "confirmed" | "finalized";
          simulateOnly?: boolean;
          requireSimulation?: boolean;
          dryRun?: boolean;
          priorityMicroLamports?: number;
          orderType?: "market" | "limit" | "trigger";
          timeInForce?: "gtc" | "ioc" | "fok";
          reduceOnly?: boolean;
          postOnly?: boolean;
          quantityMode?: "base" | "quote" | "notional";
          limitPriceAtomic?: string;
          triggerPriceAtomic?: string;
          takeProfitPriceAtomic?: string;
          stopLossPriceAtomic?: string;
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
  receiptId: string | null;
  provider: string | null;
  outcomeStatus: string | null;
  signature: string | null;
  networkFeeLamports: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ExecutionTerminalResult = {
  requestId: string;
  status: string;
  signature: string | null;
  receiptId: string | null;
  provider: string | null;
  networkFeeLamports: string | null;
};

export type ExecutionOpenOrderSnapshot = {
  requestId: string;
  requestStatus: string;
  terminal: boolean;
  receivedAt: string | null;
  updatedAt: string | null;
  terminalAt: string | null;
  intentFamily: TerminalIntentFamily | null;
  venueKey: TerminalVenueKey | null;
  marketType: TerminalMarketType | null;
  pairId: string | null;
  instrumentId: string | null;
  instrumentLabel: string | null;
  direction: "buy" | "sell" | null;
  source: string | null;
  reason: string | null;
  orderType: "limit" | "trigger" | null;
  timeInForce: "gtc" | "ioc" | "fok" | null;
  lane: "fast" | "protected" | "safe" | null;
  simulationPreference: "auto" | "always" | "never" | null;
  priorityLevel: "normal" | "high" | "urgent" | null;
  priorityMicroLamports: number | null;
  slippageBps: number | null;
  inputMint: string | null;
  outputMint: string | null;
  amountAtomic: string | null;
  remainingAmountAtomic: string | null;
  takingAmountAtomic: string | null;
  filledInputAtomic: string | null;
  filledOutputAtomic: string | null;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
  provider: string | null;
  providerStatus: TerminalProviderStatus | null;
  signature: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  status: string | null;
  oracleStatus: TerminalOracleStatus | null;
  lifecycle: {
    orderState?: string;
    fillState?: string;
    settlementState?: string;
    positionState?: string;
    riskState?: string;
    notes?: string[];
  } | null;
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

function parseOptionalAtomicString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value).toString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return trimmed;
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
      receiptId: null,
      provider: null,
      outcomeStatus: null,
      signature: null,
      networkFeeLamports: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  const outcome = receipt && isRecord(receipt.outcome) ? receipt.outcome : null;
  const networkFeeLamports =
    parseOptionalAtomicString(outcome?.networkFeeLamports) ??
    parseOptionalAtomicString(outcome?.feeLamports) ??
    parseOptionalAtomicString(receipt?.networkFeeLamports);
  return {
    requestId,
    ready: true,
    receiptId:
      typeof receipt?.receiptId === "string" && receipt.receiptId.trim()
        ? receipt.receiptId.trim()
        : null,
    provider:
      typeof receipt?.provider === "string" && receipt.provider.trim()
        ? receipt.provider.trim()
        : null,
    outcomeStatus: String(outcome?.status ?? "").trim() || null,
    signature:
      typeof outcome?.signature === "string" && outcome.signature.trim()
        ? outcome.signature.trim()
        : null,
    networkFeeLamports,
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

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => parseOptionalString(entry))
    .filter((entry): entry is string => entry !== null);
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

function parseOpenOrderSnapshot(
  value: unknown,
): ExecutionOpenOrderSnapshot | null {
  if (!isRecord(value)) return null;
  const requestId = parseOptionalString(value.requestId);
  const requestStatus = parseOptionalString(value.requestStatus);
  if (!requestId || !requestStatus) return null;
  const lifecycleRaw = isRecord(value.lifecycle) ? value.lifecycle : null;
  return {
    requestId,
    requestStatus,
    terminal: value.terminal === true,
    receivedAt: parseOptionalString(value.receivedAt),
    updatedAt: parseOptionalString(value.updatedAt),
    terminalAt: parseOptionalString(value.terminalAt),
    intentFamily: parseTerminalIntentFamily(value.intentFamily),
    venueKey: parseTerminalVenueKey(value.venueKey),
    marketType: parseTerminalMarketType(value.marketType),
    pairId: parseOptionalString(value.pairId),
    instrumentId: parseOptionalString(value.instrumentId),
    instrumentLabel: parseOptionalString(value.instrumentLabel),
    direction:
      value.direction === "buy" || value.direction === "sell"
        ? value.direction
        : null,
    source: parseOptionalString(value.source),
    reason: parseOptionalString(value.reason),
    orderType:
      value.orderType === "limit" || value.orderType === "trigger"
        ? value.orderType
        : null,
    timeInForce:
      value.timeInForce === "gtc" ||
      value.timeInForce === "ioc" ||
      value.timeInForce === "fok"
        ? value.timeInForce
        : null,
    lane:
      value.lane === "fast" ||
      value.lane === "protected" ||
      value.lane === "safe"
        ? value.lane
        : null,
    simulationPreference:
      value.simulationPreference === "auto" ||
      value.simulationPreference === "always" ||
      value.simulationPreference === "never"
        ? value.simulationPreference
        : null,
    priorityLevel:
      value.priorityLevel === "normal" ||
      value.priorityLevel === "high" ||
      value.priorityLevel === "urgent"
        ? value.priorityLevel
        : null,
    priorityMicroLamports: parseOptionalInt(value.priorityMicroLamports),
    slippageBps: parseOptionalInt(value.slippageBps),
    inputMint: parseOptionalString(value.inputMint),
    outputMint: parseOptionalString(value.outputMint),
    amountAtomic: parseOptionalAtomicString(value.amountAtomic),
    remainingAmountAtomic: parseOptionalAtomicString(
      value.remainingAmountAtomic,
    ),
    takingAmountAtomic: parseOptionalAtomicString(value.takingAmountAtomic),
    filledInputAtomic: parseOptionalAtomicString(value.filledInputAtomic),
    filledOutputAtomic: parseOptionalAtomicString(value.filledOutputAtomic),
    limitPriceAtomic: parseOptionalAtomicString(value.limitPriceAtomic),
    triggerPriceAtomic: parseOptionalAtomicString(value.triggerPriceAtomic),
    provider: parseOptionalString(value.provider),
    providerStatus: parseTerminalProviderStatus(value.providerStatus),
    signature: parseOptionalString(value.signature),
    errorCode: parseOptionalString(value.errorCode),
    errorMessage: parseOptionalString(value.errorMessage),
    status: parseOptionalString(value.status),
    oracleStatus: parseTerminalOracleStatus({
      freshnessMs: value.oracleFreshnessMs,
      source: value.oracleSource,
      stale: value.oracleStale,
    }),
    lifecycle: lifecycleRaw
      ? {
          orderState: parseOptionalString(lifecycleRaw.orderState) ?? undefined,
          fillState: parseOptionalString(lifecycleRaw.fillState) ?? undefined,
          settlementState:
            parseOptionalString(lifecycleRaw.settlementState) ?? undefined,
          positionState:
            parseOptionalString(lifecycleRaw.positionState) ?? undefined,
          riskState: parseOptionalString(lifecycleRaw.riskState) ?? undefined,
          notes: parseStringArray(lifecycleRaw.notes) ?? undefined,
        }
      : null,
  };
}

function parseOpenOrdersSnapshot(
  payload: unknown,
): ExecutionOpenOrderSnapshot[] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-terminal-open-orders-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const orders = Array.isArray(payload.orders)
    ? payload.orders
        .map((entry) => parseOpenOrderSnapshot(entry))
        .filter((entry): entry is ExecutionOpenOrderSnapshot => entry !== null)
    : [];
  return orders;
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

  async function listOpenOrders(
    options?: RequestOptions,
  ): Promise<ExecutionOpenOrderSnapshot[]> {
    const response = await requestJson({
      path: "/api/terminal/open-orders",
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parseOpenOrdersSnapshot(response);
  }

  async function cancelOpenOrder(
    requestId: string,
    options?: RequestOptions,
  ): Promise<ExecutionStatusSnapshot> {
    const response = await requestJson({
      path: `/api/terminal/open-orders/${encodeURIComponent(requestId)}/cancel`,
      method: "POST",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parseStatusSnapshot(response);
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
            receiptId: receiptSnapshot.receiptId,
            provider: receiptSnapshot.provider,
            networkFeeLamports: receiptSnapshot.networkFeeLamports,
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
    listOpenOrders,
    cancelOpenOrder,
    waitForTerminalReceipt,
  };
}
