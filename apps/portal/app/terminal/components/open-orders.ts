import {
  formatTerminalOracleFreshness,
  getTerminalIntentFamilyLabel,
  getTerminalVenueDefinition,
  type TerminalIntentFamily,
  type TerminalMarketType,
  type TerminalOracleStatus,
  type TerminalProviderStatus,
  type TerminalVenueKey,
} from "../terminal-venues";
import { type PairId, SUPPORTED_PAIRS, TOKEN_BY_MINT } from "./trade-pairs";
import type { QueuedTerminalOrder } from "./trade-ticket-modal";

export type OpenOrderStatus =
  | "pending"
  | "working"
  | "partial"
  | "filled"
  | "failed"
  | "cancelled"
  | "expired";

export type TerminalOpenOrderSnapshot = {
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

export type OpenOrderRow = Omit<QueuedTerminalOrder, "pairId"> & {
  pairId: PairId | null;
  instrumentId: string;
  instrumentLabel: string;
  venueKey: TerminalVenueKey;
  intentFamily: TerminalIntentFamily;
  marketType: TerminalMarketType;
  venueLabel: string;
  familyLabel: string;
  providerStatus: TerminalProviderStatus | null;
  oracleStatus: TerminalOracleStatus | null;
  oracleFreshnessLabel: string | null;
  requestId?: string | null;
  status: OpenOrderStatus;
  initialAmountUi: string;
  lastError: string | null;
  terminal?: boolean;
  provider?: string | null;
  signature?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  receivedAtIso?: string | null;
  updatedAtIso?: string | null;
  terminalAtIso?: string | null;
  inputMint?: string | null;
  outputMint?: string | null;
  amountAtomic?: string | null;
  remainingAmountAtomic?: string | null;
  takingAmountAtomic?: string | null;
  filledInputAtomic?: string | null;
  filledOutputAtomic?: string | null;
  lifecycle?: TerminalOpenOrderSnapshot["lifecycle"];
};

const ORDER_PRICE_DECIMALS = 6;
const SUPPORTED_PAIR_SET = new Set<string>(
  SUPPORTED_PAIRS.map((pair) => pair.id),
);

function isSupportedPairId(value: string): value is PairId {
  return SUPPORTED_PAIR_SET.has(value);
}

export function formatOrderAmountUi(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function parseOrderAmountUi(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatAtomicUi(
  atomicRaw: string | null,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (!atomicRaw || !/^\d+$/.test(atomicRaw)) return "";
  try {
    const amount = BigInt(atomicRaw);
    const scale = BigInt(10) ** BigInt(Math.max(0, decimals));
    const whole = amount / scale;
    const fraction = (amount % scale).toString().padStart(decimals, "0");
    if (decimals === 0) return whole.toString();
    const shown = fraction.slice(0, Math.min(decimals, maxFractionDigits));
    const trimmed = shown.replace(/0+$/, "");
    return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
  } catch {
    return "";
  }
}

function parseTimestampMs(value: string | null): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeOpenOrderStatus(value: string | null): OpenOrderStatus {
  switch ((value ?? "").trim().toLowerCase()) {
    case "pending":
      return "pending";
    case "working":
      return "working";
    case "partial":
      return "partial";
    case "filled":
      return "filled";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "working";
  }
}

export function mapTerminalOpenOrderSnapshot(
  snapshot: TerminalOpenOrderSnapshot,
): OpenOrderRow | null {
  const pairId =
    snapshot.pairId && isSupportedPairId(snapshot.pairId)
      ? snapshot.pairId
      : null;
  if (!snapshot.direction || !snapshot.orderType || !snapshot.lane) {
    return null;
  }
  const instrumentId = snapshot.instrumentId ?? pairId ?? snapshot.requestId;
  if (!instrumentId) return null;
  const instrumentLabel =
    snapshot.instrumentLabel ?? pairId ?? snapshot.instrumentId ?? instrumentId;
  const venueKey = snapshot.venueKey ?? "jupiter";
  const intentFamily = snapshot.intentFamily ?? "conditional_spot_order";
  const marketType = snapshot.marketType ?? "spot";
  const venueLabel =
    getTerminalVenueDefinition(venueKey)?.label ?? venueKey.toUpperCase();
  const familyLabel =
    getTerminalIntentFamilyLabel(intentFamily) ?? intentFamily;
  const inputToken = snapshot.inputMint
    ? TOKEN_BY_MINT[snapshot.inputMint]
    : null;
  const amountUi = formatAtomicUi(
    snapshot.amountAtomic,
    inputToken?.decimals ?? 0,
  );
  const remainingAmountUi =
    formatAtomicUi(snapshot.remainingAmountAtomic, inputToken?.decimals ?? 0) ||
    amountUi;
  const createdAt = parseTimestampMs(snapshot.receivedAt);
  const updatedAt = parseTimestampMs(snapshot.updatedAt ?? snapshot.receivedAt);
  return {
    id: snapshot.requestId,
    requestId: snapshot.requestId,
    createdAt,
    updatedAt,
    pairId,
    instrumentId,
    instrumentLabel,
    venueKey,
    intentFamily,
    marketType,
    venueLabel,
    familyLabel,
    providerStatus: snapshot.providerStatus,
    oracleStatus: snapshot.oracleStatus,
    oracleFreshnessLabel: formatTerminalOracleFreshness(
      snapshot.oracleStatus?.freshnessMs,
    ),
    direction: snapshot.direction,
    source: snapshot.source ?? "TERMINAL",
    reason: snapshot.reason ?? "Conditional order",
    orderType: snapshot.orderType,
    timeInForce: snapshot.timeInForce ?? "gtc",
    amountUi,
    remainingAmountUi,
    slippageBps: snapshot.slippageBps ?? 50,
    lane: snapshot.lane,
    simulationPreference: snapshot.simulationPreference ?? "auto",
    priorityLevel: snapshot.priorityLevel ?? "normal",
    limitPriceUi:
      snapshot.orderType === "limit"
        ? formatAtomicUi(snapshot.limitPriceAtomic, ORDER_PRICE_DECIMALS)
        : null,
    triggerPriceUi:
      snapshot.orderType === "trigger"
        ? formatAtomicUi(snapshot.triggerPriceAtomic, ORDER_PRICE_DECIMALS)
        : null,
    status: normalizeOpenOrderStatus(snapshot.status),
    initialAmountUi: amountUi,
    lastError: snapshot.errorMessage ?? null,
    terminal: snapshot.terminal,
    provider: snapshot.provider,
    signature: snapshot.signature,
    errorCode: snapshot.errorCode,
    errorMessage: snapshot.errorMessage,
    receivedAtIso: snapshot.receivedAt,
    updatedAtIso: snapshot.updatedAt,
    terminalAtIso: snapshot.terminalAt,
    inputMint: snapshot.inputMint,
    outputMint: snapshot.outputMint,
    amountAtomic: snapshot.amountAtomic,
    remainingAmountAtomic: snapshot.remainingAmountAtomic,
    takingAmountAtomic: snapshot.takingAmountAtomic,
    filledInputAtomic: snapshot.filledInputAtomic,
    filledOutputAtomic: snapshot.filledOutputAtomic,
    lifecycle: snapshot.lifecycle,
  };
}

export function queueOpenOrder(
  current: readonly OpenOrderRow[],
  order: QueuedTerminalOrder,
): OpenOrderRow[] {
  const venueKey = order.venueKey ?? "jupiter";
  const intentFamily = order.intentFamily ?? "conditional_spot_order";
  const venueLabel =
    getTerminalVenueDefinition(venueKey)?.label ?? venueKey.toUpperCase();
  const familyLabel =
    getTerminalIntentFamilyLabel(intentFamily) ?? intentFamily;
  const nextOrder: OpenOrderRow = {
    ...order,
    pairId: order.pairId,
    instrumentId: order.instrumentId ?? order.pairId,
    instrumentLabel: order.instrumentLabel ?? order.pairId,
    venueKey,
    intentFamily,
    marketType: order.marketType ?? "spot",
    venueLabel,
    familyLabel,
    providerStatus: order.providerStatus ?? null,
    oracleStatus: order.oracleStatus ?? null,
    oracleFreshnessLabel: formatTerminalOracleFreshness(
      order.oracleStatus?.freshnessMs,
    ),
    status: "pending",
    initialAmountUi: order.amountUi,
    lastError: null,
  };
  return [nextOrder, ...current].slice(0, 64);
}

export function promotePendingOrders(
  current: readonly OpenOrderRow[],
  now: number,
  minPendingMs = 1500,
): OpenOrderRow[] {
  let changed = false;
  const next = current.map((order) => {
    if (order.status !== "pending") return order;
    if (now - order.createdAt < minPendingMs) return order;
    changed = true;
    return {
      ...order,
      status: "working" as const,
      updatedAt: now,
    };
  });
  return changed ? next : [...current];
}

export function cancelOpenOrder(
  current: readonly OpenOrderRow[],
  orderId: string,
  now: number,
): OpenOrderRow[] {
  return current.map((order) =>
    order.id === orderId
      ? {
          ...order,
          status: "cancelled",
          updatedAt: now,
          lastError: null,
        }
      : order,
  );
}

export function cancelAllOpenOrders(
  current: readonly OpenOrderRow[],
  now: number,
): OpenOrderRow[] {
  return current.map((order) => ({
    ...order,
    status: "cancelled",
    updatedAt: now,
    lastError: null,
  }));
}

export function setOrderError(
  current: readonly OpenOrderRow[],
  orderId: string,
  error: string,
  now: number,
): OpenOrderRow[] {
  return current.map((order) =>
    order.id === orderId
      ? {
          ...order,
          status: "failed",
          updatedAt: now,
          lastError: error,
        }
      : order,
  );
}

export function amendOpenOrder(input: {
  current: readonly OpenOrderRow[];
  orderId: string;
  amountUi: string;
  priceUi: string;
  now: number;
}):
  | { ok: true; next: OpenOrderRow[] }
  | { ok: false; error: string; next: OpenOrderRow[] } {
  const amount = parseOrderAmountUi(input.amountUi.trim());
  if (amount === null) {
    return {
      ok: false,
      error: "invalid-amend-amount",
      next: setOrderError(
        input.current,
        input.orderId,
        "invalid-amend-amount",
        input.now,
      ),
    };
  }
  const nextAmountUi = formatOrderAmountUi(amount);
  const normalizedPrice = input.priceUi.trim();
  if (!normalizedPrice || Number(normalizedPrice) <= 0) {
    const target = input.current.find((order) => order.id === input.orderId);
    const error =
      target?.orderType === "limit"
        ? "invalid-limit-price"
        : "invalid-trigger-price";
    return {
      ok: false,
      error,
      next: setOrderError(input.current, input.orderId, error, input.now),
    };
  }

  return {
    ok: true,
    next: input.current.map((order) =>
      order.id === input.orderId
        ? {
            ...order,
            amountUi: nextAmountUi,
            remainingAmountUi: nextAmountUi,
            status: "working",
            updatedAt: input.now,
            lastError: null,
            limitPriceUi: order.orderType === "limit" ? normalizedPrice : null,
            triggerPriceUi:
              order.orderType === "trigger" ? normalizedPrice : null,
          }
        : order,
    ),
  };
}

export function executeOpenOrderSlice(input: {
  current: readonly OpenOrderRow[];
  orderId: string;
  fraction: 0.5 | 1;
  now: number;
}):
  | {
      ok: true;
      executeAmountUi: string;
      next: OpenOrderRow[];
    }
  | {
      ok: false;
      error: string;
      next: OpenOrderRow[];
    } {
  const target = input.current.find((order) => order.id === input.orderId);
  if (!target) {
    return {
      ok: false,
      error: "order-not-found",
      next: [...input.current],
    };
  }
  if (target.status === "cancelled" || target.status === "failed") {
    return {
      ok: false,
      error: "order-not-executable",
      next: [...input.current],
    };
  }
  const remaining = parseOrderAmountUi(target.remainingAmountUi);
  if (remaining === null) {
    const error = "invalid-order-amount";
    return {
      ok: false,
      error,
      next: setOrderError(input.current, input.orderId, error, input.now),
    };
  }
  const executeAmount =
    input.fraction === 1 ? remaining : Math.max(remaining * 0.5, 0.0001);
  const executeAmountUi = formatOrderAmountUi(executeAmount);
  const nextRemaining = Math.max(0, remaining - executeAmount);
  const nextRemainingUi = formatOrderAmountUi(nextRemaining);

  return {
    ok: true,
    executeAmountUi,
    next: input.current.flatMap((order) => {
      if (order.id !== input.orderId) return [order];
      if (nextRemaining <= 0.000001) return [];
      return [
        {
          ...order,
          remainingAmountUi: nextRemainingUi,
          status: "partial",
          updatedAt: input.now,
          lastError: null,
        },
      ];
    }),
  };
}
