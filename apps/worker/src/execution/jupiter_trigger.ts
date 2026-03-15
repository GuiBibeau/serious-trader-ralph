import { SUPPORTED_TRADING_PAIRS, TRADING_TOKEN_BY_MINT } from "../defaults";
import type {
  JupiterTriggerCondition,
  JupiterTriggerOrderRecord,
} from "../jupiter";
import type {
  ExecutionIntentLifecycleSnapshot,
  NonSwapExecutionIntent,
} from "./types";

export const JUPITER_TRIGGER_PRICE_DECIMALS = 6;

export type JupiterConditionalOrderType = "limit" | "trigger";

export type ResolvedJupiterConditionalSpotOrder = {
  venueKey: "jupiter";
  instrumentId: string;
  side: "buy" | "sell";
  orderType: JupiterConditionalOrderType;
  timeInForce: "gtc";
  quantityAtomic: string;
  priceAtomic: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  triggerCondition: JupiterTriggerCondition;
};

export type JupiterTriggerTerminalReason =
  | "filled"
  | "cancelled"
  | "expired"
  | null;

export type JupiterTrackedTriggerOrder = {
  maker: string;
  order: string;
  requestId?: string | null;
  instrumentId?: string | null;
  side?: string | null;
  orderType?: string | null;
  inputMint?: string | null;
  outputMint?: string | null;
  makingAmount?: string | null;
  takingAmount?: string | null;
};

export type JupiterTriggerLifecycleSummary = {
  lifecycle: ExecutionIntentLifecycleSnapshot;
  terminalReason: JupiterTriggerTerminalReason;
  filledInputAtomic: string;
  filledOutputAtomic: string;
  signature: string | null;
};

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return null;
}

function readPositiveBigInt(value: unknown): bigint | null {
  const normalized = readString(value);
  if (!normalized) return null;
  try {
    const parsed = BigInt(normalized);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function readOptionalBigInt(value: unknown): bigint | null {
  const normalized = readString(value);
  if (!normalized) return null;
  try {
    const parsed = BigInt(normalized);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function readTriggerAtomic(
  record: JupiterTriggerOrderRecord | JupiterTriggerOrderTrade,
  rawKey: string,
  humanKey: string,
): bigint | null {
  const rawValue = isRecord(record) ? record[rawKey] : null;
  const humanValue = isRecord(record) ? record[humanKey] : null;
  return readOptionalBigInt(rawValue) ?? readOptionalBigInt(humanValue);
}

function getPairByInstrumentId(instrumentId: string) {
  return (
    SUPPORTED_TRADING_PAIRS.find((pair) => pair.id === instrumentId) ?? null
  );
}

function pow10(exp: number): bigint {
  return 10n ** BigInt(Math.max(0, Math.floor(exp)));
}

function divFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("invalid-jupiter-trigger-denominator");
  }
  return numerator / denominator;
}

export function resolveJupiterConditionalSpotOrder(
  intent: NonSwapExecutionIntent,
): ResolvedJupiterConditionalSpotOrder {
  if (intent.family !== "conditional_spot_order") {
    throw new Error("invalid-jupiter-trigger-intent-family");
  }
  if (intent.venueKey !== "jupiter") {
    throw new Error("invalid-jupiter-trigger-venue");
  }
  const pair = getPairByInstrumentId(intent.instrumentId);
  if (!pair) {
    throw new Error(
      `unsupported-jupiter-trigger-instrument:${intent.instrumentId}`,
    );
  }
  const params = intent.params ?? {};
  const orderTypeRaw = readString(params.orderType);
  const orderType: JupiterConditionalOrderType =
    orderTypeRaw === "trigger" ? "trigger" : "limit";
  const timeInForceRaw = readString(params.timeInForce);
  if (
    timeInForceRaw &&
    timeInForceRaw !== "gtc" &&
    timeInForceRaw !== "ioc" &&
    timeInForceRaw !== "fok"
  ) {
    throw new Error(
      `unsupported-jupiter-trigger-time-in-force:${timeInForceRaw}`,
    );
  }
  const timeInForce = timeInForceRaw ?? "gtc";
  if (timeInForce !== "gtc") {
    throw new Error(`unsupported-jupiter-trigger-time-in-force:${timeInForce}`);
  }
  if (readBoolean(params.postOnly) === true) {
    throw new Error("unsupported-jupiter-trigger-post-only");
  }
  if (readBoolean(params.reduceOnly) === true) {
    throw new Error("unsupported-jupiter-trigger-reduce-only");
  }
  if (readString(params.takeProfitPriceAtomic)) {
    throw new Error("unsupported-jupiter-trigger-take-profit");
  }
  if (readString(params.stopLossPriceAtomic)) {
    throw new Error("unsupported-jupiter-trigger-stop-loss");
  }
  const quantityAtomic = readPositiveBigInt(intent.quantityAtomic);
  if (!quantityAtomic) {
    throw new Error("invalid-jupiter-trigger-quantity");
  }
  const limitPriceAtomic = readPositiveBigInt(params.limitPriceAtomic);
  const triggerPriceAtomic = readPositiveBigInt(params.triggerPriceAtomic);
  const priceAtomic =
    orderType === "trigger" ? triggerPriceAtomic : limitPriceAtomic;
  if (!priceAtomic) {
    throw new Error(
      orderType === "trigger"
        ? "missing-jupiter-trigger-price"
        : "missing-jupiter-limit-price",
    );
  }
  if (
    orderType === "trigger" &&
    limitPriceAtomic &&
    limitPriceAtomic !== triggerPriceAtomic
  ) {
    throw new Error("unsupported-jupiter-trigger-limit-price-override");
  }

  const buy = intent.side === "buy";
  const inputMint = buy ? pair.quoteMint : pair.baseMint;
  const outputMint = buy ? pair.baseMint : pair.quoteMint;
  const inputToken = TRADING_TOKEN_BY_MINT[inputMint];
  const outputToken = TRADING_TOKEN_BY_MINT[outputMint];
  if (!inputToken || !outputToken) {
    throw new Error(`unsupported-jupiter-trigger-pair:${intent.instrumentId}`);
  }

  const makingAmount = quantityAtomic;
  const takingAmount = buy
    ? divFloor(
        makingAmount *
          pow10(outputToken.decimals) *
          pow10(JUPITER_TRIGGER_PRICE_DECIMALS),
        priceAtomic * pow10(inputToken.decimals),
      )
    : divFloor(
        makingAmount * priceAtomic * pow10(outputToken.decimals),
        pow10(inputToken.decimals) * pow10(JUPITER_TRIGGER_PRICE_DECIMALS),
      );
  if (takingAmount <= 0n) {
    throw new Error("invalid-jupiter-trigger-derived-output");
  }

  return {
    venueKey: "jupiter",
    instrumentId: intent.instrumentId,
    side: buy ? "buy" : "sell",
    orderType,
    timeInForce: "gtc",
    quantityAtomic: makingAmount.toString(),
    priceAtomic: priceAtomic.toString(),
    inputMint,
    outputMint,
    makingAmount: makingAmount.toString(),
    takingAmount: takingAmount.toString(),
    triggerCondition:
      orderType === "trigger"
        ? buy
          ? "above"
          : "below"
        : buy
          ? "below"
          : "above",
  };
}

function normalizeLifecycleStatus(
  status: string | null,
  order: JupiterTriggerOrderRecord,
): JupiterTriggerLifecycleSummary {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  const remainingMakingAmount = readTriggerAtomic(
    order,
    "rawRemainingMakingAmount",
    "remainingMakingAmount",
  );
  const totalMakingAmount =
    readTriggerAtomic(order, "rawMakingAmount", "makingAmount") ??
    readPositiveBigInt(order.makingAmount);
  const totalTakingAmount =
    readTriggerAtomic(order, "rawTakingAmount", "takingAmount") ??
    readPositiveBigInt(order.takingAmount);

  let filledInput = 0n;
  let filledOutput = 0n;
  const trades = Array.isArray(order.trades) ? order.trades : [];
  for (const trade of trades) {
    const inputAmount =
      readTriggerAtomic(trade, "rawInputAmount", "inputAmount") ?? 0n;
    const outputAmount =
      readTriggerAtomic(trade, "rawOutputAmount", "outputAmount") ?? 0n;
    filledInput += inputAmount;
    filledOutput += outputAmount;
  }
  if (
    filledInput === 0n &&
    filledOutput === 0n &&
    totalMakingAmount &&
    totalTakingAmount &&
    remainingMakingAmount !== null &&
    remainingMakingAmount < totalMakingAmount &&
    remainingMakingAmount >= 0n
  ) {
    const consumedMakingAmount = totalMakingAmount - remainingMakingAmount;
    filledInput = consumedMakingAmount;
    filledOutput = divFloor(
      consumedMakingAmount * totalTakingAmount,
      totalMakingAmount,
    );
  }

  const filledInputAtomic = filledInput.toString();
  const filledOutputAtomic = filledOutput.toString();
  const signature = readString(order.closeTx) ?? readString(order.openTx);

  if (normalized.includes("cancel")) {
    return {
      lifecycle: {
        orderState: "cancelled",
        fillState: filledInput > 0n ? "partial" : "pending",
        settlementState: "finalized",
        notes: [String(order.status ?? "Cancelled")],
      },
      terminalReason: "cancelled",
      filledInputAtomic,
      filledOutputAtomic,
      signature,
    };
  }
  if (normalized.includes("expire")) {
    return {
      lifecycle: {
        orderState: "expired",
        fillState: filledInput > 0n ? "partial" : "pending",
        settlementState: "failed",
        notes: [String(order.status ?? "Expired")],
      },
      terminalReason: "expired",
      filledInputAtomic,
      filledOutputAtomic,
      signature,
    };
  }
  if (
    normalized.includes("partial") ||
    ((filledInput > 0n || filledOutput > 0n) &&
      remainingMakingAmount !== null &&
      remainingMakingAmount > 0n)
  ) {
    return {
      lifecycle: {
        orderState: "partially_filled",
        fillState: "partial",
        settlementState: "confirmed",
        notes: [String(order.status ?? "Partially Filled")],
      },
      terminalReason: null,
      filledInputAtomic,
      filledOutputAtomic,
      signature,
    };
  }
  if (
    normalized.includes("fill") ||
    normalized.includes("closed") ||
    (totalMakingAmount !== null &&
      remainingMakingAmount !== null &&
      remainingMakingAmount === 0n)
  ) {
    return {
      lifecycle: {
        orderState: "filled",
        fillState: "filled",
        settlementState: "finalized",
        notes: [String(order.status ?? "Filled")],
      },
      terminalReason: "filled",
      filledInputAtomic:
        filledInput > 0n
          ? filledInputAtomic
          : (totalMakingAmount ?? 0n).toString(),
      filledOutputAtomic:
        filledOutput > 0n
          ? filledOutputAtomic
          : (totalTakingAmount ?? 0n).toString(),
      signature,
    };
  }
  if (normalized.includes("trigger")) {
    return {
      lifecycle: {
        orderState: "triggered",
        fillState: "pending",
        settlementState: "confirmed",
        notes: [String(order.status ?? "Triggered")],
      },
      terminalReason: null,
      filledInputAtomic,
      filledOutputAtomic,
      signature,
    };
  }
  if (normalized.includes("open") || normalized.includes("active")) {
    return {
      lifecycle: {
        orderState: "open",
        fillState: "pending",
        settlementState: "confirmed",
        notes: [String(order.status ?? "Open")],
      },
      terminalReason: null,
      filledInputAtomic,
      filledOutputAtomic,
      signature,
    };
  }
  return {
    lifecycle: {
      orderState: "accepted",
      fillState: "pending",
      settlementState: "confirmed",
      notes: [String(order.status ?? "Accepted")],
    },
    terminalReason: null,
    filledInputAtomic,
    filledOutputAtomic,
    signature,
  };
}

export function summarizeJupiterTriggerOrder(
  order: JupiterTriggerOrderRecord | null,
): JupiterTriggerLifecycleSummary {
  if (!order) {
    return {
      lifecycle: {
        orderState: "accepted",
        fillState: "pending",
        settlementState: "confirmed",
        notes: ["order-created"],
      },
      terminalReason: null,
      filledInputAtomic: "0",
      filledOutputAtomic: "0",
      signature: null,
    };
  }
  return normalizeLifecycleStatus(readString(order.status), order);
}

export function findJupiterTriggerOrderByKey(
  orders: JupiterTriggerOrderRecord[],
  orderKey: string,
): JupiterTriggerOrderRecord | null {
  const normalizedKey = readString(orderKey);
  if (!normalizedKey) return null;
  return (
    orders.find((order) => {
      const recordOrderKey =
        readString(order.order) ?? readString(order.orderKey);
      return recordOrderKey === normalizedKey;
    }) ?? null
  );
}

export function readTrackedJupiterTriggerOrder(
  value: unknown,
): JupiterTrackedTriggerOrder | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const maker = readString(record.maker) ?? readString(record.userPubkey);
  const order = readString(record.order) ?? readString(record.orderKey);
  if (!maker || !order) return null;
  return {
    maker,
    order,
    requestId: readString(record.requestId),
    instrumentId: readString(record.instrumentId),
    side: readString(record.side),
    orderType: readString(record.orderType),
    inputMint: readString(record.inputMint),
    outputMint: readString(record.outputMint),
    makingAmount: readString(record.makingAmount),
    takingAmount: readString(record.takingAmount),
  };
}
