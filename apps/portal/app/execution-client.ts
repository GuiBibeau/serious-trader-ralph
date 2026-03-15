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

export type ExecutionSpotPreview = {
  venueKey: TerminalVenueKey;
  provider: string;
  inputMint: string;
  outputMint: string;
  inAmountAtomic: string;
  outAmountAtomic: string;
  routeSummary: string | null;
  priceImpactPct: number | null;
};

export type ExecutionPerpMarket = {
  venueKey: TerminalVenueKey;
  instrumentId: string;
  instrumentLabel: string;
  marketIndex: number | null;
  oracle: string | null;
  oracleSource: string | null;
  status: string | null;
  contractType: string | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
  fundingRate1hBps: number | null;
  oraclePrice: number | null;
  markPrice: number | null;
  sourceTs: string | null;
  swiftConfigured: boolean;
  routeSummary: string | null;
};

export type ExecutionPerpPreview = {
  venueKey: TerminalVenueKey;
  provider: string;
  instrumentId: string;
  instrumentLabel: string;
  side: "long" | "short" | "close_long" | "close_short";
  orderType: "market" | "limit" | "trigger";
  timeInForce: "gtc" | "ioc" | "fok";
  reduceOnly: boolean;
  quantityAtomic: string;
  quantityUi: string | null;
  collateralAtomic: string | null;
  collateralUi: string | null;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
  markPrice: number | null;
  oraclePrice: number | null;
  oracle: string | null;
  oracleSource: string | null;
  fundingRate1hBps: number | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
  swiftSupported: boolean;
  currentSignedQuantityAtomic: string | null;
  currentSignedQuantityUi: string | null;
  currentCollateralAtomic: string | null;
  currentCollateralUi: string | null;
  currentAverageEntryPrice: number | null;
  projectedSignedQuantityAtomic: string | null;
  projectedSignedQuantityUi: string | null;
  projectedCollateralAtomic: string | null;
  projectedCollateralUi: string | null;
  projectedNotionalQuote: number | null;
  requiredInitialMarginQuote: number | null;
  requiredMaintenanceQuote: number | null;
  projectedLeverage: number | null;
  projectedLiquidationBufferPct: number | null;
  projectedRiskLevel: "low" | "warning" | "critical" | null;
  routeSummary: string | null;
  notes: string[];
};

export type ExecutionPerpResult = {
  requestId: string;
  status: string;
  terminal: boolean;
  updatedAt: string | null;
  receiptId: string | null;
  provider: string | null;
  instrumentId: string | null;
  instrumentLabel: string | null;
  side: "long" | "short" | "close_long" | "close_short" | null;
  quantityAtomic: string | null;
  collateralAtomic: string | null;
  markPrice: number | null;
  oraclePrice: number | null;
  fundingRate1hBps: number | null;
};

export type ExecutionPerpPosition = {
  key: string;
  venueKey: TerminalVenueKey;
  instrumentId: string;
  instrumentLabel: string;
  side: "long" | "short" | "flat";
  positionState: "open" | "closed";
  signedQuantityAtomic: string;
  signedQuantityUi: string;
  absoluteQuantityUi: string;
  averageEntryPrice: number | null;
  markPrice: number | null;
  oraclePrice: number | null;
  fundingRate1hBps: number | null;
  collateralAtomic: string;
  collateralUi: string;
  notionalQuote: number | null;
  unrealizedPnlQuote: number | null;
  leverage: number | null;
  equityQuote: number | null;
  usedMarginQuote: number | null;
  maintenanceRequirementQuote: number | null;
  freeCollateralQuote: number | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
  liquidationBufferPct: number | null;
  riskLevel: "low" | "warning" | "critical";
  oracle: string | null;
  oracleSource: string | null;
  lastRequestId: string | null;
  lastUpdatedAt: string | null;
  notes: string[];
};

export type ExecutionPredictionMarket = {
  venueKey: TerminalVenueKey;
  marketId: string;
  title: string;
  eventTitle: string | null;
  status: string | null;
  result: "yes" | "no" | null;
  endTime: string | null;
  settleTime: string | null;
  accountId: string | null;
  settlementMint: string | null;
  yesMint: string | null;
  noMint: string | null;
  scalarOutcomePct: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  volume: number | null;
  openInterest: number | null;
  redemptionStatus: string | null;
  accountStatus: string | null;
  resolved: boolean;
};

export type ExecutionPredictionPreview = {
  venueKey: TerminalVenueKey;
  provider: string;
  market: ExecutionPredictionMarket;
  instrumentId: string;
  instrumentLabel: string | null;
  outcomeId: string;
  outcomeSide: "yes" | "no" | null;
  side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  orderType: "market" | "limit";
  timeInForce: "gtc" | "ioc" | "fok";
  quantityMode: "base" | "quote" | "notional";
  quantityAtomic: string;
  settlementMint: string | null;
  priceQuote: number | null;
  estimatedNotionalUsd: number | null;
  liveReady: boolean;
  routeSummary: string | null;
  notes: string[];
};

export type ExecutionPredictionResult = {
  requestId: string;
  status: string;
  terminal: boolean;
  updatedAt: string | null;
  receiptId: string | null;
  provider: string | null;
  instrumentId: string | null;
  instrumentLabel: string | null;
  outcomeId: string | null;
  outcomeSide: "yes" | "no" | null;
  quantityAtomic: string | null;
  settlementMint: string | null;
  priceQuote: number | null;
  estimatedNotionalUsd: number | null;
};

export type ExecutionPredictionPosition = {
  key: string;
  venueKey: TerminalVenueKey;
  instrumentId: string;
  instrumentLabel: string;
  outcomeMint: string;
  outcomeSide: "yes" | "no" | null;
  netQuantityAtomic: string;
  grossBoughtQuantityAtomic: string;
  netQuantityUi: string;
  grossBoughtQuantityUi: string;
  averageEntryPrice: number | null;
  lastPriceQuote: number | null;
  marketStatus: string | null;
  marketResolved: boolean;
  result: "yes" | "no" | null;
  settleTime: string | null;
  settlementMint: string | null;
  redemptionStatus: string | null;
  canSettle: boolean;
  expectedPayoutAtomic: string | null;
  expectedPayoutUi: string | null;
  positionState: "open" | "closed";
  settlementState: string;
  lastRequestId: string | null;
  lastUpdatedAt: string | null;
  notes: string[];
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

function parseSpotPreviewSnapshot(payload: unknown): ExecutionSpotPreview {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.preview)) {
    throw new ExecutionClientError({
      message: "invalid-terminal-spot-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const preview = payload.preview;
  const venueKey = parseTerminalVenueKey(preview.venueKey);
  const provider = parseOptionalString(preview.provider);
  const inputMint = parseOptionalString(preview.inputMint);
  const outputMint = parseOptionalString(preview.outputMint);
  const inAmountAtomic = parseOptionalAtomicString(preview.inAmountAtomic);
  const outAmountAtomic = parseOptionalAtomicString(preview.outAmountAtomic);
  if (
    !venueKey ||
    !provider ||
    !inputMint ||
    !outputMint ||
    !inAmountAtomic ||
    !outAmountAtomic
  ) {
    throw new ExecutionClientError({
      message: "invalid-terminal-spot-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const priceImpactRaw = Number(preview.priceImpactPct);
  return {
    venueKey,
    provider,
    inputMint,
    outputMint,
    inAmountAtomic,
    outAmountAtomic,
    routeSummary: parseOptionalString(preview.routeSummary),
    priceImpactPct: Number.isFinite(priceImpactRaw) ? priceImpactRaw : null,
  };
}

function parsePerpSide(
  value: unknown,
): "long" | "short" | "close_long" | "close_short" | null {
  return value === "long" ||
    value === "short" ||
    value === "close_long" ||
    value === "close_short"
    ? value
    : null;
}

function parsePerpRiskLevel(
  value: unknown,
): "low" | "warning" | "critical" | null {
  return value === "low" || value === "warning" || value === "critical"
    ? value
    : null;
}

function parsePerpPositionSide(
  value: unknown,
): "long" | "short" | "flat" | null {
  return value === "long" || value === "short" || value === "flat"
    ? value
    : null;
}

function parsePerpMarketSnapshot(value: unknown): ExecutionPerpMarket | null {
  if (!isRecord(value)) return null;
  const venueKey = parseTerminalVenueKey(value.venueKey);
  const instrumentId = parseOptionalString(value.instrumentId);
  const instrumentLabel = parseOptionalString(value.instrumentLabel);
  if (!venueKey || !instrumentId || !instrumentLabel) return null;
  return {
    venueKey,
    instrumentId,
    instrumentLabel,
    marketIndex: parseOptionalInt(value.marketIndex),
    oracle: parseOptionalString(value.oracle),
    oracleSource: parseOptionalString(value.oracleSource),
    status: parseOptionalString(value.status),
    contractType: parseOptionalString(value.contractType),
    initialMarginRatio: parseOptionalFiniteNumber(value.initialMarginRatio),
    maintenanceMarginRatio: parseOptionalFiniteNumber(
      value.maintenanceMarginRatio,
    ),
    fundingRate1hBps: parseOptionalFiniteNumber(value.fundingRate1hBps),
    oraclePrice: parseOptionalFiniteNumber(value.oraclePrice),
    markPrice: parseOptionalFiniteNumber(value.markPrice),
    sourceTs: parseOptionalString(value.sourceTs),
    swiftConfigured: value.swiftConfigured === true,
    routeSummary: parseOptionalString(value.routeSummary),
  };
}

function parsePerpMarketsSnapshot(payload: unknown): ExecutionPerpMarket[] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-markets-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return Array.isArray(payload.markets)
    ? payload.markets
        .map((entry) => parsePerpMarketSnapshot(entry))
        .filter((entry): entry is ExecutionPerpMarket => entry !== null)
    : [];
}

function parsePerpPreviewSnapshot(payload: unknown): ExecutionPerpPreview {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.preview)) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const preview = payload.preview;
  const venueKey = parseTerminalVenueKey(preview.venueKey);
  const provider = parseOptionalString(preview.provider);
  const instrumentId = parseOptionalString(preview.instrumentId);
  const instrumentLabel = parseOptionalString(preview.instrumentLabel);
  const side = parsePerpSide(preview.side);
  const orderType =
    preview.orderType === "market" ||
    preview.orderType === "limit" ||
    preview.orderType === "trigger"
      ? preview.orderType
      : null;
  const timeInForce =
    preview.timeInForce === "gtc" ||
    preview.timeInForce === "ioc" ||
    preview.timeInForce === "fok"
      ? preview.timeInForce
      : null;
  const quantityAtomic = parseOptionalAtomicString(preview.quantityAtomic);
  if (
    !venueKey ||
    !provider ||
    !instrumentId ||
    !instrumentLabel ||
    !side ||
    !orderType ||
    !timeInForce ||
    !quantityAtomic
  ) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    venueKey,
    provider,
    instrumentId,
    instrumentLabel,
    side,
    orderType,
    timeInForce,
    reduceOnly: preview.reduceOnly === true,
    quantityAtomic,
    quantityUi: parseOptionalString(preview.quantityUi),
    collateralAtomic: parseOptionalAtomicString(preview.collateralAtomic),
    collateralUi: parseOptionalString(preview.collateralUi),
    limitPriceAtomic: parseOptionalAtomicString(preview.limitPriceAtomic),
    triggerPriceAtomic: parseOptionalAtomicString(preview.triggerPriceAtomic),
    markPrice: parseOptionalFiniteNumber(preview.markPrice),
    oraclePrice: parseOptionalFiniteNumber(preview.oraclePrice),
    oracle: parseOptionalString(preview.oracle),
    oracleSource: parseOptionalString(preview.oracleSource),
    fundingRate1hBps: parseOptionalFiniteNumber(preview.fundingRate1hBps),
    initialMarginRatio: parseOptionalFiniteNumber(preview.initialMarginRatio),
    maintenanceMarginRatio: parseOptionalFiniteNumber(
      preview.maintenanceMarginRatio,
    ),
    swiftSupported: preview.swiftSupported === true,
    currentSignedQuantityAtomic: parseOptionalString(
      preview.currentSignedQuantityAtomic,
    ),
    currentSignedQuantityUi: parseOptionalString(
      preview.currentSignedQuantityUi,
    ),
    currentCollateralAtomic: parseOptionalAtomicString(
      preview.currentCollateralAtomic,
    ),
    currentCollateralUi: parseOptionalString(preview.currentCollateralUi),
    currentAverageEntryPrice: parseOptionalFiniteNumber(
      preview.currentAverageEntryPrice,
    ),
    projectedSignedQuantityAtomic: parseOptionalString(
      preview.projectedSignedQuantityAtomic,
    ),
    projectedSignedQuantityUi: parseOptionalString(
      preview.projectedSignedQuantityUi,
    ),
    projectedCollateralAtomic: parseOptionalAtomicString(
      preview.projectedCollateralAtomic,
    ),
    projectedCollateralUi: parseOptionalString(preview.projectedCollateralUi),
    projectedNotionalQuote: parseOptionalFiniteNumber(
      preview.projectedNotionalQuote,
    ),
    requiredInitialMarginQuote: parseOptionalFiniteNumber(
      preview.requiredInitialMarginQuote,
    ),
    requiredMaintenanceQuote: parseOptionalFiniteNumber(
      preview.requiredMaintenanceQuote,
    ),
    projectedLeverage: parseOptionalFiniteNumber(preview.projectedLeverage),
    projectedLiquidationBufferPct: parseOptionalFiniteNumber(
      preview.projectedLiquidationBufferPct,
    ),
    projectedRiskLevel: parsePerpRiskLevel(preview.projectedRiskLevel),
    routeSummary: parseOptionalString(preview.routeSummary),
    notes: parseStringArray(preview.notes) ?? [],
  };
}

function parsePerpResultSnapshot(payload: unknown): ExecutionPerpResult {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-result-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const result = payload.result;
  const requestId = parseOptionalString(result.requestId);
  const status = parseOptionalString(result.status);
  if (!requestId || !status) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-result-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    requestId,
    status,
    terminal: result.terminal === true,
    updatedAt: parseOptionalString(result.updatedAt),
    receiptId: parseOptionalString(result.receiptId),
    provider: parseOptionalString(result.provider),
    instrumentId: parseOptionalString(result.instrumentId),
    instrumentLabel: parseOptionalString(result.instrumentLabel),
    side: parsePerpSide(result.side),
    quantityAtomic: parseOptionalAtomicString(result.quantityAtomic),
    collateralAtomic: parseOptionalAtomicString(result.collateralAtomic),
    markPrice: parseOptionalFiniteNumber(result.markPrice),
    oraclePrice: parseOptionalFiniteNumber(result.oraclePrice),
    fundingRate1hBps: parseOptionalFiniteNumber(result.fundingRate1hBps),
  };
}

function parsePerpPositionSnapshot(
  value: unknown,
): ExecutionPerpPosition | null {
  if (!isRecord(value)) return null;
  const key = parseOptionalString(value.key);
  const venueKey = parseTerminalVenueKey(value.venueKey);
  const instrumentId = parseOptionalString(value.instrumentId);
  const instrumentLabel = parseOptionalString(value.instrumentLabel);
  const positionState =
    value.positionState === "open" || value.positionState === "closed"
      ? value.positionState
      : null;
  const side = parsePerpPositionSide(value.side);
  const signedQuantityAtomic = parseOptionalString(value.signedQuantityAtomic);
  const signedQuantityUi = parseOptionalString(value.signedQuantityUi);
  const absoluteQuantityUi = parseOptionalString(value.absoluteQuantityUi);
  const collateralAtomic = parseOptionalAtomicString(value.collateralAtomic);
  const collateralUi = parseOptionalString(value.collateralUi);
  const riskLevel = parsePerpRiskLevel(value.riskLevel);
  if (
    !key ||
    !venueKey ||
    !instrumentId ||
    !instrumentLabel ||
    !positionState ||
    !side ||
    !signedQuantityAtomic ||
    !signedQuantityUi ||
    !absoluteQuantityUi ||
    !collateralAtomic ||
    !collateralUi ||
    !riskLevel
  ) {
    return null;
  }
  return {
    key,
    venueKey,
    instrumentId,
    instrumentLabel,
    side,
    positionState,
    signedQuantityAtomic,
    signedQuantityUi,
    absoluteQuantityUi,
    averageEntryPrice: parseOptionalFiniteNumber(value.averageEntryPrice),
    markPrice: parseOptionalFiniteNumber(value.markPrice),
    oraclePrice: parseOptionalFiniteNumber(value.oraclePrice),
    fundingRate1hBps: parseOptionalFiniteNumber(value.fundingRate1hBps),
    collateralAtomic,
    collateralUi,
    notionalQuote: parseOptionalFiniteNumber(value.notionalQuote),
    unrealizedPnlQuote: parseOptionalFiniteNumber(value.unrealizedPnlQuote),
    leverage: parseOptionalFiniteNumber(value.leverage),
    equityQuote: parseOptionalFiniteNumber(value.equityQuote),
    usedMarginQuote: parseOptionalFiniteNumber(value.usedMarginQuote),
    maintenanceRequirementQuote: parseOptionalFiniteNumber(
      value.maintenanceRequirementQuote,
    ),
    freeCollateralQuote: parseOptionalFiniteNumber(value.freeCollateralQuote),
    initialMarginRatio: parseOptionalFiniteNumber(value.initialMarginRatio),
    maintenanceMarginRatio: parseOptionalFiniteNumber(
      value.maintenanceMarginRatio,
    ),
    liquidationBufferPct: parseOptionalFiniteNumber(value.liquidationBufferPct),
    riskLevel,
    oracle: parseOptionalString(value.oracle),
    oracleSource: parseOptionalString(value.oracleSource),
    lastRequestId: parseOptionalString(value.lastRequestId),
    lastUpdatedAt: parseOptionalString(value.lastUpdatedAt),
    notes: parseStringArray(value.notes) ?? [],
  };
}

function parsePerpPositionsSnapshot(payload: unknown): ExecutionPerpPosition[] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-terminal-perp-positions-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return Array.isArray(payload.positions)
    ? payload.positions
        .map((entry) => parsePerpPositionSnapshot(entry))
        .filter((entry): entry is ExecutionPerpPosition => entry !== null)
    : [];
}

function parseOptionalFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePredictionOutcomeSide(value: unknown): "yes" | "no" | null {
  return value === "yes" || value === "no" ? value : null;
}

function parsePredictionOrderSide(
  value: unknown,
): "buy_yes" | "buy_no" | "sell_yes" | "sell_no" | null {
  return value === "buy_yes" ||
    value === "buy_no" ||
    value === "sell_yes" ||
    value === "sell_no"
    ? value
    : null;
}

function parsePredictionOrderType(value: unknown): "market" | "limit" | null {
  return value === "market" || value === "limit" ? value : null;
}

function parsePredictionQuantityMode(
  value: unknown,
): "base" | "quote" | "notional" | null {
  return value === "base" || value === "quote" || value === "notional"
    ? value
    : null;
}

function parsePredictionMarketSnapshot(
  value: unknown,
): ExecutionPredictionMarket | null {
  if (!isRecord(value)) return null;
  const venueKey = parseTerminalVenueKey(value.venueKey);
  const marketId = parseOptionalString(value.marketId);
  const title = parseOptionalString(value.title);
  if (!venueKey || !marketId || !title) return null;
  return {
    venueKey,
    marketId,
    title,
    eventTitle: parseOptionalString(value.eventTitle),
    status: parseOptionalString(value.status),
    result: parsePredictionOutcomeSide(value.result),
    endTime: parseOptionalString(value.endTime),
    settleTime: parseOptionalString(value.settleTime),
    accountId: parseOptionalString(value.accountId),
    settlementMint: parseOptionalString(value.settlementMint),
    yesMint: parseOptionalString(value.yesMint),
    noMint: parseOptionalString(value.noMint),
    scalarOutcomePct: parseOptionalFiniteNumber(value.scalarOutcomePct),
    yesBid: parseOptionalFiniteNumber(value.yesBid),
    yesAsk: parseOptionalFiniteNumber(value.yesAsk),
    noBid: parseOptionalFiniteNumber(value.noBid),
    noAsk: parseOptionalFiniteNumber(value.noAsk),
    volume: parseOptionalFiniteNumber(value.volume),
    openInterest: parseOptionalFiniteNumber(value.openInterest),
    redemptionStatus: parseOptionalString(value.redemptionStatus),
    accountStatus: parseOptionalString(value.accountStatus),
    resolved: value.resolved === true,
  };
}

function parsePredictionMarketsSnapshot(
  payload: unknown,
): ExecutionPredictionMarket[] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-markets-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return Array.isArray(payload.markets)
    ? payload.markets
        .map((entry) => parsePredictionMarketSnapshot(entry))
        .filter((entry): entry is ExecutionPredictionMarket => entry !== null)
    : [];
}

function parsePredictionPreviewSnapshot(
  payload: unknown,
): ExecutionPredictionPreview {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.preview)) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const preview = payload.preview;
  const venueKey = parseTerminalVenueKey(preview.venueKey);
  const provider = parseOptionalString(preview.provider);
  const market = parsePredictionMarketSnapshot(preview.market);
  const instrumentId = parseOptionalString(preview.instrumentId);
  const outcomeId = parseOptionalString(preview.outcomeId);
  const side = parsePredictionOrderSide(preview.side);
  const orderType = parsePredictionOrderType(preview.orderType);
  const timeInForce =
    preview.timeInForce === "gtc" ||
    preview.timeInForce === "ioc" ||
    preview.timeInForce === "fok"
      ? preview.timeInForce
      : null;
  const quantityMode = parsePredictionQuantityMode(preview.quantityMode);
  const quantityAtomic = parseOptionalAtomicString(preview.quantityAtomic);
  if (
    !venueKey ||
    !provider ||
    !market ||
    !instrumentId ||
    !outcomeId ||
    !side ||
    !orderType ||
    !timeInForce ||
    !quantityMode ||
    !quantityAtomic
  ) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-preview-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    venueKey,
    provider,
    market,
    instrumentId,
    instrumentLabel: parseOptionalString(preview.instrumentLabel),
    outcomeId,
    outcomeSide: parsePredictionOutcomeSide(preview.outcomeSide),
    side,
    orderType,
    timeInForce,
    quantityMode,
    quantityAtomic,
    settlementMint: parseOptionalString(preview.settlementMint),
    priceQuote: parseOptionalFiniteNumber(preview.priceQuote),
    estimatedNotionalUsd: parseOptionalFiniteNumber(
      preview.estimatedNotionalUsd,
    ),
    liveReady: preview.liveReady === true,
    routeSummary: parseOptionalString(preview.routeSummary),
    notes: parseStringArray(preview.notes) ?? [],
  };
}

function parsePredictionResultSnapshot(
  payload: unknown,
): ExecutionPredictionResult {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-result-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  const result = payload.result;
  const requestId = parseOptionalString(result.requestId);
  const status = parseOptionalString(result.status);
  if (!requestId || !status) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-result-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return {
    requestId,
    status,
    terminal: result.terminal === true,
    updatedAt: parseOptionalString(result.updatedAt),
    receiptId: parseOptionalString(result.receiptId),
    provider: parseOptionalString(result.provider),
    instrumentId: parseOptionalString(result.instrumentId),
    instrumentLabel: parseOptionalString(result.instrumentLabel),
    outcomeId: parseOptionalString(result.outcomeId),
    outcomeSide: parsePredictionOutcomeSide(result.outcomeSide),
    quantityAtomic: parseOptionalAtomicString(result.quantityAtomic),
    settlementMint: parseOptionalString(result.settlementMint),
    priceQuote: parseOptionalFiniteNumber(result.priceQuote),
    estimatedNotionalUsd: parseOptionalFiniteNumber(
      result.estimatedNotionalUsd,
    ),
  };
}

function parsePredictionPositionSnapshot(
  value: unknown,
): ExecutionPredictionPosition | null {
  if (!isRecord(value)) return null;
  const key = parseOptionalString(value.key);
  const venueKey = parseTerminalVenueKey(value.venueKey);
  const instrumentId = parseOptionalString(value.instrumentId);
  const instrumentLabel = parseOptionalString(value.instrumentLabel);
  const outcomeMint = parseOptionalString(value.outcomeMint);
  const netQuantityAtomic = parseOptionalAtomicString(value.netQuantityAtomic);
  const grossBoughtQuantityAtomic = parseOptionalAtomicString(
    value.grossBoughtQuantityAtomic,
  );
  const netQuantityUi = parseOptionalString(value.netQuantityUi);
  const grossBoughtQuantityUi = parseOptionalString(
    value.grossBoughtQuantityUi,
  );
  const settlementState = parseOptionalString(value.settlementState);
  if (
    !key ||
    !venueKey ||
    !instrumentId ||
    !instrumentLabel ||
    !outcomeMint ||
    !netQuantityAtomic ||
    !grossBoughtQuantityAtomic ||
    !netQuantityUi ||
    !grossBoughtQuantityUi ||
    !settlementState
  ) {
    return null;
  }
  const positionState =
    value.positionState === "open" || value.positionState === "closed"
      ? value.positionState
      : null;
  if (!positionState) return null;
  return {
    key,
    venueKey,
    instrumentId,
    instrumentLabel,
    outcomeMint,
    outcomeSide: parsePredictionOutcomeSide(value.outcomeSide),
    netQuantityAtomic,
    grossBoughtQuantityAtomic,
    netQuantityUi,
    grossBoughtQuantityUi,
    averageEntryPrice: parseOptionalFiniteNumber(value.averageEntryPrice),
    lastPriceQuote: parseOptionalFiniteNumber(value.lastPriceQuote),
    marketStatus: parseOptionalString(value.marketStatus),
    marketResolved: value.marketResolved === true,
    result: parsePredictionOutcomeSide(value.result),
    settleTime: parseOptionalString(value.settleTime),
    settlementMint: parseOptionalString(value.settlementMint),
    redemptionStatus: parseOptionalString(value.redemptionStatus),
    canSettle: value.canSettle === true,
    expectedPayoutAtomic: parseOptionalAtomicString(value.expectedPayoutAtomic),
    expectedPayoutUi: parseOptionalString(value.expectedPayoutUi),
    positionState,
    settlementState,
    lastRequestId: parseOptionalString(value.lastRequestId),
    lastUpdatedAt: parseOptionalString(value.lastUpdatedAt),
    notes: parseStringArray(value.notes) ?? [],
  };
}

function parsePredictionPositionsSnapshot(
  payload: unknown,
): ExecutionPredictionPosition[] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new ExecutionClientError({
      message: "invalid-terminal-prediction-positions-response",
      code: "unknown",
      status: 500,
      retryable: false,
      data: payload,
    });
  }
  return Array.isArray(payload.positions)
    ? payload.positions
        .map((entry) => parsePredictionPositionSnapshot(entry))
        .filter((entry): entry is ExecutionPredictionPosition => entry !== null)
    : [];
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

  async function listPerpMarkets(
    input?: {
      venueKey?: TerminalVenueKey;
      limit?: number;
    },
    options?: RequestOptions,
  ): Promise<ExecutionPerpMarket[]> {
    const params = new URLSearchParams();
    if (input?.venueKey) params.set("venueKey", input.venueKey);
    if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
      params.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    const response = await requestJson({
      path: `/api/terminal/perp-markets${params.size > 0 ? `?${params.toString()}` : ""}`,
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parsePerpMarketsSnapshot(response);
  }

  async function previewPerpOrder(
    input: {
      venueKey: TerminalVenueKey;
      instrumentId: string;
      instrumentLabel?: string;
      side: "long" | "short" | "close_long" | "close_short";
      quantityAtomic: string;
      collateralAtomic?: string;
      orderType?: "market" | "limit" | "trigger";
      timeInForce?: "gtc" | "ioc" | "fok";
      reduceOnly?: boolean;
      limitPriceAtomic?: string;
      triggerPriceAtomic?: string;
      currentPosition?: Pick<
        ExecutionPerpPosition,
        | "instrumentId"
        | "signedQuantityAtomic"
        | "collateralAtomic"
        | "averageEntryPrice"
      > | null;
    },
    options?: RequestOptions,
  ): Promise<ExecutionPerpPreview> {
    const response = await requestJson({
      path: "/api/terminal/perp-preview",
      method: "POST",
      signal: options?.signal,
      headers: options?.headers,
      body: input,
    });
    return parsePerpPreviewSnapshot(response);
  }

  async function submitPerpOrder(
    input: {
      venueKey: TerminalVenueKey;
      instrumentId: string;
      instrumentLabel?: string;
      side: "long" | "short" | "close_long" | "close_short";
      quantityAtomic: string;
      collateralAtomic?: string;
      orderType?: "market" | "limit" | "trigger";
      timeInForce?: "gtc" | "ioc" | "fok";
      reduceOnly?: boolean;
      limitPriceAtomic?: string;
      triggerPriceAtomic?: string;
      source?: string;
      reason?: string;
    },
    options?: SubmitOptions,
  ): Promise<ExecutionPerpResult> {
    const response = await requestJson({
      path: "/api/terminal/perp-orders",
      method: "POST",
      signal: options?.signal,
      headers: {
        ...(options?.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
        ...(options?.headers ?? {}),
      },
      body: input,
    });
    return parsePerpResultSnapshot(response);
  }

  async function listPerpPositions(
    options?: RequestOptions,
  ): Promise<ExecutionPerpPosition[]> {
    const response = await requestJson({
      path: "/api/terminal/perp-positions",
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parsePerpPositionsSnapshot(response);
  }

  async function listPredictionMarkets(
    input?: {
      venueKey?: TerminalVenueKey;
      limit?: number;
    },
    options?: RequestOptions,
  ): Promise<ExecutionPredictionMarket[]> {
    const params = new URLSearchParams();
    if (input?.venueKey) params.set("venueKey", input.venueKey);
    if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
      params.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    const response = await requestJson({
      path: `/api/terminal/prediction-markets${params.size > 0 ? `?${params.toString()}` : ""}`,
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parsePredictionMarketsSnapshot(response);
  }

  async function previewSpotOrder(
    input: {
      venueKey: TerminalVenueKey;
      inputMint: string;
      outputMint: string;
      amountAtomic: string;
      slippageBps: number;
    },
    options?: RequestOptions,
  ): Promise<ExecutionSpotPreview> {
    const response = await requestJson({
      path: "/api/terminal/spot-preview",
      method: "POST",
      signal: options?.signal,
      headers: options?.headers,
      body: input,
    });
    return parseSpotPreviewSnapshot(response);
  }

  async function previewPredictionOrder(
    input: {
      venueKey: TerminalVenueKey;
      instrumentId: string;
      instrumentLabel?: string;
      outcomeId: string;
      side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
      quantityAtomic: string;
      orderType?: "market" | "limit";
      timeInForce?: "gtc" | "ioc" | "fok";
      quantityMode?: "base" | "quote" | "notional";
      limitPriceAtomic?: string;
    },
    options?: RequestOptions,
  ): Promise<ExecutionPredictionPreview> {
    const response = await requestJson({
      path: "/api/terminal/prediction-preview",
      method: "POST",
      signal: options?.signal,
      headers: options?.headers,
      body: input,
    });
    return parsePredictionPreviewSnapshot(response);
  }

  async function submitPredictionOrder(
    input: {
      venueKey: TerminalVenueKey;
      instrumentId: string;
      instrumentLabel?: string;
      outcomeId: string;
      side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
      quantityAtomic: string;
      orderType?: "market" | "limit";
      timeInForce?: "gtc" | "ioc" | "fok";
      quantityMode?: "base" | "quote" | "notional";
      limitPriceAtomic?: string;
      source?: string;
      reason?: string;
    },
    options?: SubmitOptions,
  ): Promise<ExecutionPredictionResult> {
    const response = await requestJson({
      path: "/api/terminal/prediction-orders",
      method: "POST",
      signal: options?.signal,
      headers: {
        ...(options?.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
        ...(options?.headers ?? {}),
      },
      body: input,
    });
    return parsePredictionResultSnapshot(response);
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

  async function listPredictionPositions(
    options?: RequestOptions,
  ): Promise<ExecutionPredictionPosition[]> {
    const response = await requestJson({
      path: "/api/terminal/prediction-positions",
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
    });
    return parsePredictionPositionsSnapshot(response);
  }

  async function settlePredictionPosition(
    positionKey: string,
    options?: SubmitOptions,
  ): Promise<ExecutionPredictionResult> {
    const response = await requestJson({
      path: `/api/terminal/prediction-positions/${encodeURIComponent(positionKey)}/settle`,
      method: "POST",
      signal: options?.signal,
      headers: {
        ...(options?.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
        ...(options?.headers ?? {}),
      },
    });
    return parsePredictionResultSnapshot(response);
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
    listPerpMarkets,
    listPredictionMarkets,
    previewSpotOrder,
    previewPerpOrder,
    previewPredictionOrder,
    submitPerpOrder,
    submitPredictionOrder,
    cancelOpenOrder,
    listPerpPositions,
    listPredictionPositions,
    settlePredictionPosition,
    waitForTerminalReceipt,
  };
}
