import type { ExecutionLane, ExecutionMode, JsonObject } from "./repository";
import type { ExecutionIntentFamily } from "./types";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const POSITIVE_ATOMIC_RE = /^[1-9][0-9]*$/;
const SCHEMA_VERSION_V1 = "v1";
const SCHEMA_VERSION_V2 = "v2";

export type ExecSubmitOptions = {
  simulateOnly?: boolean;
  requireSimulation?: boolean;
  dryRun?: boolean;
  priorityMicroLamports?: number;
  commitment?: "processed" | "confirmed" | "finalized";
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

export type ExecSubmitPrivyExecuteV1 = {
  intentType: "swap";
  wallet: string;
  swap: {
    inputMint: string;
    outputMint: string;
    amountAtomic: string;
    slippageBps: number;
  };
  options?: ExecSubmitOptions;
};

export type ExecSubmitPrivySpotSwapIntentV2 = {
  family: "spot_swap";
  venueKey?: string;
  marketType: "spot";
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
};

export type ExecSubmitPrivyConditionalSpotOrderIntentV2 = {
  family: "conditional_spot_order";
  venueKey: string;
  marketType: "spot";
  instrumentId: string;
  side: "buy" | "sell";
  quantityAtomic: string;
};

export type ExecSubmitPrivyClobOrderIntentV2 = {
  family: "clob_order";
  venueKey: string;
  marketType: "spot" | "perp";
  instrumentId: string;
  side: "buy" | "sell";
  quantityAtomic: string;
};

export type ExecSubmitPrivyPerpOrderIntentV2 = {
  family: "perp_order";
  venueKey: string;
  marketType: "perp";
  instrumentId: string;
  side: "long" | "short" | "close_long" | "close_short";
  quantityAtomic: string;
  collateralAtomic?: string;
};

export type ExecSubmitPrivyPredictionOrderIntentV2 = {
  family: "prediction_order";
  venueKey: string;
  marketType: "prediction";
  instrumentId: string;
  outcomeId: string;
  side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  quantityAtomic: string;
};

export type ExecSubmitPrivyFlashLegV2 = {
  provider: string;
  mint: string;
  amountAtomic: string;
};

export type ExecSubmitPrivyFlashAtomicIntentV2 = {
  family: "flash_atomic";
  venueKey: string;
  marketType: "spot";
  referenceId: string;
  borrowLegs: ExecSubmitPrivyFlashLegV2[];
  settlementMint: string;
};

export type ExecSubmitPrivyIntentV2 =
  | ExecSubmitPrivySpotSwapIntentV2
  | ExecSubmitPrivyConditionalSpotOrderIntentV2
  | ExecSubmitPrivyClobOrderIntentV2
  | ExecSubmitPrivyPerpOrderIntentV2
  | ExecSubmitPrivyPredictionOrderIntentV2
  | ExecSubmitPrivyFlashAtomicIntentV2;

export type ExecSubmitPrivyExecuteV2 = {
  wallet: string;
  intent: ExecSubmitPrivyIntentV2;
  options?: ExecSubmitOptions;
};

export type ExecSubmitRequestV1 = {
  schemaVersion: "v1";
  mode: ExecutionMode;
  lane: ExecutionLane;
  metadata?: {
    source?: string;
    reason?: string;
    clientRequestId?: string;
  };
  relaySigned?: {
    encoding: "base64";
    signedTransaction: string;
  };
  privyExecute?: ExecSubmitPrivyExecuteV1;
};

export type ExecSubmitRequestV2 = {
  schemaVersion: "v2";
  mode: ExecutionMode;
  lane: ExecutionLane;
  metadata?: {
    source?: string;
    reason?: string;
    clientRequestId?: string;
  };
  relaySigned?: {
    encoding: "base64";
    signedTransaction: string;
  };
  privyExecute?: ExecSubmitPrivyExecuteV2;
};

export type ExecSubmitRequest = ExecSubmitRequestV1 | ExecSubmitRequestV2;

export type ExecSubmitSpotSwapCompat = {
  wallet: string;
  venueKey?: string;
  swap: {
    inputMint: string;
    outputMint: string;
    amountAtomic: string;
    slippageBps: number;
  };
  options?: ExecSubmitOptions;
};

export type ExecSubmitPayloadParseResult =
  | {
      ok: true;
      value: ExecSubmitRequest;
      metadataForStorage: JsonObject | null;
    }
  | { ok: false; error: "invalid-request" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function parseBoundedString(
  value: unknown,
  min: number,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) return null;
  return normalized;
}

function parseLane(value: unknown): ExecutionLane | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "fast") return "fast";
  if (normalized === "protected") return "protected";
  if (normalized === "safe") return "safe";
  return null;
}

function parseMode(value: unknown): ExecutionMode | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "relay_signed") return "relay_signed";
  if (normalized === "privy_execute") return "privy_execute";
  return null;
}

function parseMetadata(value: unknown): {
  source?: string;
  reason?: string;
  clientRequestId?: string;
} | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  if (!assertAllowedKeys(value, ["source", "reason", "clientRequestId"])) {
    return null;
  }

  const source = parseBoundedString(value.source, 1, 80);
  const reason = parseBoundedString(value.reason, 1, 240);
  const clientRequestId = parseBoundedString(value.clientRequestId, 1, 120);
  if (value.source !== undefined && source === null) return null;
  if (value.reason !== undefined && reason === null) return null;
  if (value.clientRequestId !== undefined && clientRequestId === null) {
    return null;
  }

  return {
    ...(source ? { source } : {}),
    ...(reason ? { reason } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  };
}

function parseRelaySigned(
  value: unknown,
): { encoding: "base64"; signedTransaction: string } | null {
  if (!isRecord(value)) return null;
  if (!assertAllowedKeys(value, ["encoding", "signedTransaction"])) {
    return null;
  }

  if (String(value.encoding ?? "") !== "base64") return null;
  const signedTransaction = String(value.signedTransaction ?? "").trim();
  if (
    signedTransaction.length < 16 ||
    signedTransaction.length > 32_768 ||
    !BASE64_RE.test(signedTransaction)
  ) {
    return null;
  }

  return {
    encoding: "base64",
    signedTransaction,
  };
}

function parsePubkey(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (
    normalized.length < 32 ||
    normalized.length > 64 ||
    !BASE58_RE.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function parsePositiveAtomicString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return POSITIVE_ATOMIC_RE.test(normalized) ? normalized : null;
}

function parseVenueKey(value: unknown): string | null {
  return parseBoundedString(value, 1, 64);
}

function parseInstrumentId(value: unknown): string | null {
  return parseBoundedString(value, 1, 160);
}

function parseExecutionIntentFamily(
  value: unknown,
): ExecutionIntentFamily | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "spot_swap") return "spot_swap";
  if (normalized === "conditional_spot_order") {
    return "conditional_spot_order";
  }
  if (normalized === "clob_order") return "clob_order";
  if (normalized === "perp_order") return "perp_order";
  if (normalized === "prediction_order") return "prediction_order";
  if (normalized === "flash_atomic") return "flash_atomic";
  return null;
}

function parseMarketType(
  value: unknown,
): "spot" | "perp" | "prediction" | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "spot") return "spot";
  if (normalized === "perp") return "perp";
  if (normalized === "prediction") return "prediction";
  return null;
}

function parseCommonOptions(value: unknown): ExecSubmitOptions | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  if (
    !assertAllowedKeys(value, [
      "simulateOnly",
      "requireSimulation",
      "dryRun",
      "priorityMicroLamports",
      "commitment",
      "orderType",
      "timeInForce",
      "reduceOnly",
      "postOnly",
      "quantityMode",
      "limitPriceAtomic",
      "triggerPriceAtomic",
      "takeProfitPriceAtomic",
      "stopLossPriceAtomic",
    ])
  ) {
    return null;
  }
  if (
    value.simulateOnly !== undefined &&
    typeof value.simulateOnly !== "boolean"
  ) {
    return null;
  }
  if (
    value.requireSimulation !== undefined &&
    typeof value.requireSimulation !== "boolean"
  ) {
    return null;
  }
  if (value.dryRun !== undefined && typeof value.dryRun !== "boolean") {
    return null;
  }
  if (value.priorityMicroLamports !== undefined) {
    const priorityMicroLamports = Number(value.priorityMicroLamports);
    if (
      !Number.isInteger(priorityMicroLamports) ||
      priorityMicroLamports < 0 ||
      priorityMicroLamports > 2_000_000
    ) {
      return null;
    }
  }
  if (
    value.commitment !== undefined &&
    value.commitment !== "processed" &&
    value.commitment !== "confirmed" &&
    value.commitment !== "finalized"
  ) {
    return null;
  }
  if (
    value.orderType !== undefined &&
    value.orderType !== "market" &&
    value.orderType !== "limit" &&
    value.orderType !== "trigger"
  ) {
    return null;
  }
  if (
    value.timeInForce !== undefined &&
    value.timeInForce !== "gtc" &&
    value.timeInForce !== "ioc" &&
    value.timeInForce !== "fok"
  ) {
    return null;
  }
  if (value.reduceOnly !== undefined && typeof value.reduceOnly !== "boolean") {
    return null;
  }
  if (value.postOnly !== undefined && typeof value.postOnly !== "boolean") {
    return null;
  }
  if (
    value.quantityMode !== undefined &&
    value.quantityMode !== "base" &&
    value.quantityMode !== "quote" &&
    value.quantityMode !== "notional"
  ) {
    return null;
  }
  if (
    value.limitPriceAtomic !== undefined &&
    parsePositiveAtomicString(value.limitPriceAtomic) === null
  ) {
    return null;
  }
  if (
    value.triggerPriceAtomic !== undefined &&
    parsePositiveAtomicString(value.triggerPriceAtomic) === null
  ) {
    return null;
  }
  if (
    value.takeProfitPriceAtomic !== undefined &&
    parsePositiveAtomicString(value.takeProfitPriceAtomic) === null
  ) {
    return null;
  }
  if (
    value.stopLossPriceAtomic !== undefined &&
    parsePositiveAtomicString(value.stopLossPriceAtomic) === null
  ) {
    return null;
  }

  return {
    ...(value.simulateOnly !== undefined
      ? { simulateOnly: value.simulateOnly as boolean }
      : {}),
    ...(value.requireSimulation !== undefined
      ? { requireSimulation: value.requireSimulation as boolean }
      : {}),
    ...(value.dryRun !== undefined ? { dryRun: value.dryRun as boolean } : {}),
    ...(value.priorityMicroLamports !== undefined
      ? { priorityMicroLamports: Number(value.priorityMicroLamports) }
      : {}),
    ...(value.commitment !== undefined
      ? {
          commitment: value.commitment as
            | "processed"
            | "confirmed"
            | "finalized",
        }
      : {}),
    ...(value.orderType !== undefined
      ? {
          orderType: value.orderType as "market" | "limit" | "trigger",
        }
      : {}),
    ...(value.timeInForce !== undefined
      ? { timeInForce: value.timeInForce as "gtc" | "ioc" | "fok" }
      : {}),
    ...(value.reduceOnly !== undefined
      ? { reduceOnly: value.reduceOnly as boolean }
      : {}),
    ...(value.postOnly !== undefined
      ? { postOnly: value.postOnly as boolean }
      : {}),
    ...(value.quantityMode !== undefined
      ? {
          quantityMode: value.quantityMode as "base" | "quote" | "notional",
        }
      : {}),
    ...(value.limitPriceAtomic !== undefined
      ? { limitPriceAtomic: String(value.limitPriceAtomic) }
      : {}),
    ...(value.triggerPriceAtomic !== undefined
      ? { triggerPriceAtomic: String(value.triggerPriceAtomic) }
      : {}),
    ...(value.takeProfitPriceAtomic !== undefined
      ? { takeProfitPriceAtomic: String(value.takeProfitPriceAtomic) }
      : {}),
    ...(value.stopLossPriceAtomic !== undefined
      ? { stopLossPriceAtomic: String(value.stopLossPriceAtomic) }
      : {}),
  };
}

function parsePrivyExecuteV1(value: unknown): ExecSubmitPrivyExecuteV1 | null {
  if (!isRecord(value)) return null;
  if (!assertAllowedKeys(value, ["intentType", "wallet", "swap", "options"])) {
    return null;
  }
  if (String(value.intentType ?? "") !== "swap") return null;
  const wallet = parsePubkey(value.wallet);
  if (!wallet) return null;
  if (!isRecord(value.swap)) return null;
  if (
    !assertAllowedKeys(value.swap, [
      "inputMint",
      "outputMint",
      "amountAtomic",
      "slippageBps",
    ])
  ) {
    return null;
  }
  const inputMint = parsePubkey(value.swap.inputMint);
  const outputMint = parsePubkey(value.swap.outputMint);
  const amountAtomic = parsePositiveAtomicString(value.swap.amountAtomic);
  const slippageBps = Number(value.swap.slippageBps);
  if (
    !inputMint ||
    !outputMint ||
    !amountAtomic ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > 5_000
  ) {
    return null;
  }
  const options = parseCommonOptions(value.options);
  if (options === null) return null;

  return {
    intentType: "swap",
    wallet,
    swap: {
      inputMint,
      outputMint,
      amountAtomic,
      slippageBps,
    },
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function parseConditionalSide(value: unknown): "buy" | "sell" | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  return null;
}

function parsePerpSide(
  value: unknown,
): "long" | "short" | "close_long" | "close_short" | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "long") return "long";
  if (normalized === "short") return "short";
  if (normalized === "close_long") return "close_long";
  if (normalized === "close_short") return "close_short";
  return null;
}

function parsePredictionSide(
  value: unknown,
): "buy_yes" | "buy_no" | "sell_yes" | "sell_no" | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "buy_yes") return "buy_yes";
  if (normalized === "buy_no") return "buy_no";
  if (normalized === "sell_yes") return "sell_yes";
  if (normalized === "sell_no") return "sell_no";
  return null;
}

function parseFlashLeg(value: unknown): ExecSubmitPrivyFlashLegV2 | null {
  if (!isRecord(value)) return null;
  if (!assertAllowedKeys(value, ["provider", "mint", "amountAtomic"])) {
    return null;
  }
  const provider = parseBoundedString(value.provider, 1, 80);
  const mint = parsePubkey(value.mint);
  const amountAtomic = parsePositiveAtomicString(value.amountAtomic);
  if (!provider || !mint || !amountAtomic) return null;
  return {
    provider,
    mint,
    amountAtomic,
  };
}

function parsePrivyIntentV2(
  value: unknown,
  options: ExecSubmitOptions,
): ExecSubmitPrivyIntentV2 | null {
  if (!isRecord(value)) return null;
  const family = parseExecutionIntentFamily(value.family);
  if (!family) return null;

  switch (family) {
    case "spot_swap": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "inputMint",
          "outputMint",
          "amountAtomic",
          "slippageBps",
        ])
      ) {
        return null;
      }
      const venueKey =
        value.venueKey !== undefined
          ? parseVenueKey(value.venueKey)
          : undefined;
      const marketType =
        value.marketType === undefined
          ? "spot"
          : parseMarketType(value.marketType);
      const inputMint = parsePubkey(value.inputMint);
      const outputMint = parsePubkey(value.outputMint);
      const amountAtomic = parsePositiveAtomicString(value.amountAtomic);
      const slippageBps = Number(value.slippageBps);
      if (
        marketType !== "spot" ||
        (value.venueKey !== undefined && !venueKey) ||
        !inputMint ||
        !outputMint ||
        !amountAtomic ||
        !Number.isInteger(slippageBps) ||
        slippageBps < 1 ||
        slippageBps > 5_000
      ) {
        return null;
      }
      return {
        family,
        ...(venueKey ? { venueKey } : {}),
        marketType: "spot",
        inputMint,
        outputMint,
        amountAtomic,
        slippageBps,
      };
    }
    case "conditional_spot_order": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "instrumentId",
          "side",
          "quantityAtomic",
        ])
      ) {
        return null;
      }
      const venueKey = parseVenueKey(value.venueKey);
      const marketType =
        value.marketType === undefined
          ? "spot"
          : parseMarketType(value.marketType);
      const instrumentId = parseInstrumentId(value.instrumentId);
      const side = parseConditionalSide(value.side);
      const quantityAtomic = parsePositiveAtomicString(value.quantityAtomic);
      const hasConditionalPricing =
        Boolean(options.limitPriceAtomic) ||
        Boolean(options.triggerPriceAtomic) ||
        Boolean(options.takeProfitPriceAtomic) ||
        Boolean(options.stopLossPriceAtomic);
      if (
        !venueKey ||
        marketType !== "spot" ||
        !instrumentId ||
        !side ||
        !quantityAtomic ||
        !hasConditionalPricing
      ) {
        return null;
      }
      return {
        family,
        venueKey,
        marketType: "spot",
        instrumentId,
        side,
        quantityAtomic,
      };
    }
    case "clob_order": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "instrumentId",
          "side",
          "quantityAtomic",
        ])
      ) {
        return null;
      }
      const venueKey = parseVenueKey(value.venueKey);
      const marketType = parseMarketType(value.marketType);
      const instrumentId = parseInstrumentId(value.instrumentId);
      const side = parseConditionalSide(value.side);
      const quantityAtomic = parsePositiveAtomicString(value.quantityAtomic);
      if (
        !venueKey ||
        (marketType !== "spot" && marketType !== "perp") ||
        !instrumentId ||
        !side ||
        !quantityAtomic
      ) {
        return null;
      }
      return {
        family,
        venueKey,
        marketType,
        instrumentId,
        side,
        quantityAtomic,
      };
    }
    case "perp_order": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "instrumentId",
          "side",
          "quantityAtomic",
          "collateralAtomic",
        ])
      ) {
        return null;
      }
      const venueKey = parseVenueKey(value.venueKey);
      const marketType = parseMarketType(value.marketType);
      const instrumentId = parseInstrumentId(value.instrumentId);
      const side = parsePerpSide(value.side);
      const quantityAtomic = parsePositiveAtomicString(value.quantityAtomic);
      const collateralAtomic =
        value.collateralAtomic !== undefined
          ? parsePositiveAtomicString(value.collateralAtomic)
          : undefined;
      if (
        !venueKey ||
        marketType !== "perp" ||
        !instrumentId ||
        !side ||
        !quantityAtomic ||
        (value.collateralAtomic !== undefined && !collateralAtomic)
      ) {
        return null;
      }
      return {
        family,
        venueKey,
        marketType: "perp",
        instrumentId,
        side,
        quantityAtomic,
        ...(collateralAtomic ? { collateralAtomic } : {}),
      };
    }
    case "prediction_order": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "instrumentId",
          "outcomeId",
          "side",
          "quantityAtomic",
        ])
      ) {
        return null;
      }
      const venueKey = parseVenueKey(value.venueKey);
      const marketType = parseMarketType(value.marketType);
      const instrumentId = parseInstrumentId(value.instrumentId);
      const outcomeId = parseInstrumentId(value.outcomeId);
      const side = parsePredictionSide(value.side);
      const quantityAtomic = parsePositiveAtomicString(value.quantityAtomic);
      if (
        !venueKey ||
        marketType !== "prediction" ||
        !instrumentId ||
        !outcomeId ||
        !side ||
        !quantityAtomic
      ) {
        return null;
      }
      return {
        family,
        venueKey,
        marketType: "prediction",
        instrumentId,
        outcomeId,
        side,
        quantityAtomic,
      };
    }
    case "flash_atomic": {
      if (
        !assertAllowedKeys(value, [
          "family",
          "venueKey",
          "marketType",
          "referenceId",
          "borrowLegs",
          "settlementMint",
        ])
      ) {
        return null;
      }
      const venueKey = parseVenueKey(value.venueKey);
      const marketType =
        value.marketType === undefined
          ? "spot"
          : parseMarketType(value.marketType);
      const referenceId = parseInstrumentId(value.referenceId);
      const settlementMint = parsePubkey(value.settlementMint);
      const borrowLegs = Array.isArray(value.borrowLegs)
        ? value.borrowLegs.map((entry) => parseFlashLeg(entry))
        : null;
      if (
        !venueKey ||
        marketType !== "spot" ||
        !referenceId ||
        !settlementMint ||
        !borrowLegs ||
        borrowLegs.length < 1 ||
        borrowLegs.some((entry) => entry === null)
      ) {
        return null;
      }
      return {
        family,
        venueKey,
        marketType: "spot",
        referenceId,
        borrowLegs: borrowLegs as ExecSubmitPrivyFlashLegV2[],
        settlementMint,
      };
    }
  }
}

function parsePrivyExecuteV2(value: unknown): ExecSubmitPrivyExecuteV2 | null {
  if (!isRecord(value)) return null;
  if (!assertAllowedKeys(value, ["wallet", "intent", "options"])) return null;
  const wallet = parsePubkey(value.wallet);
  if (!wallet) return null;
  const options = parseCommonOptions(value.options);
  if (options === null) return null;
  const intent = parsePrivyIntentV2(value.intent, options);
  if (!intent) return null;
  return {
    wallet,
    intent,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function parseSubmitPayloadV1(
  value: Record<string, unknown>,
  mode: ExecutionMode,
  lane: ExecutionLane,
  metadata: {
    source?: string;
    reason?: string;
    clientRequestId?: string;
  },
): ExecSubmitPayloadParseResult {
  if (mode === "relay_signed") {
    const relaySigned = parseRelaySigned(value.relaySigned);
    if (!relaySigned || value.privyExecute !== undefined) {
      return { ok: false, error: "invalid-request" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: SCHEMA_VERSION_V1,
        mode,
        lane,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        relaySigned,
      },
      metadataForStorage:
        Object.keys(metadata).length > 0
          ? ({ ...metadata } as JsonObject)
          : null,
    };
  }

  const privyExecute = parsePrivyExecuteV1(value.privyExecute);
  if (!privyExecute || value.relaySigned !== undefined) {
    return { ok: false, error: "invalid-request" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION_V1,
      mode,
      lane,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      privyExecute,
    },
    metadataForStorage:
      Object.keys(metadata).length > 0 ? ({ ...metadata } as JsonObject) : null,
  };
}

function parseSubmitPayloadV2(
  value: Record<string, unknown>,
  mode: ExecutionMode,
  lane: ExecutionLane,
  metadata: {
    source?: string;
    reason?: string;
    clientRequestId?: string;
  },
): ExecSubmitPayloadParseResult {
  if (mode === "relay_signed") {
    const relaySigned = parseRelaySigned(value.relaySigned);
    if (!relaySigned || value.privyExecute !== undefined) {
      return { ok: false, error: "invalid-request" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: SCHEMA_VERSION_V2,
        mode,
        lane,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        relaySigned,
      },
      metadataForStorage:
        Object.keys(metadata).length > 0
          ? ({ ...metadata } as JsonObject)
          : null,
    };
  }

  const privyExecute = parsePrivyExecuteV2(value.privyExecute);
  if (!privyExecute || value.relaySigned !== undefined) {
    return { ok: false, error: "invalid-request" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: SCHEMA_VERSION_V2,
      mode,
      lane,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      privyExecute,
    },
    metadataForStorage:
      Object.keys(metadata).length > 0 ? ({ ...metadata } as JsonObject) : null,
  };
}

export function resolveExecSubmitIntentFamily(
  value: ExecSubmitRequest,
): ExecutionIntentFamily | null {
  if (value.mode !== "privy_execute") return null;
  if (value.schemaVersion === SCHEMA_VERSION_V1) return "spot_swap";
  return value.privyExecute?.intent.family ?? null;
}

export function resolveExecSubmitSpotSwap(
  value: ExecSubmitRequest,
): ExecSubmitSpotSwapCompat | null {
  if (value.mode !== "privy_execute") return null;
  if (value.schemaVersion === SCHEMA_VERSION_V1) {
    const privyExecute = value.privyExecute;
    if (!privyExecute) return null;
    return {
      wallet: privyExecute.wallet,
      swap: { ...privyExecute.swap },
      ...(privyExecute.options ? { options: { ...privyExecute.options } } : {}),
    };
  }

  const privyExecute = value.privyExecute;
  if (!privyExecute || privyExecute.intent.family !== "spot_swap") {
    return null;
  }
  return {
    wallet: privyExecute.wallet,
    ...(privyExecute.intent.venueKey
      ? { venueKey: privyExecute.intent.venueKey }
      : {}),
    swap: {
      inputMint: privyExecute.intent.inputMint,
      outputMint: privyExecute.intent.outputMint,
      amountAtomic: privyExecute.intent.amountAtomic,
      slippageBps: privyExecute.intent.slippageBps,
    },
    ...(privyExecute.options ? { options: { ...privyExecute.options } } : {}),
  };
}

export function toExecSubmitRequestV1Compat(
  value: ExecSubmitRequest,
): ExecSubmitRequestV1 | null {
  if (value.mode === "relay_signed") {
    if (!value.relaySigned) return null;
    return {
      schemaVersion: SCHEMA_VERSION_V1,
      mode: value.mode,
      lane: value.lane,
      ...(value.metadata ? { metadata: { ...value.metadata } } : {}),
      relaySigned: { ...value.relaySigned },
    };
  }

  const spotSwap = resolveExecSubmitSpotSwap(value);
  if (!spotSwap) return null;
  return {
    schemaVersion: SCHEMA_VERSION_V1,
    mode: "privy_execute",
    lane: value.lane,
    ...(value.metadata ? { metadata: { ...value.metadata } } : {}),
    privyExecute: {
      intentType: "swap",
      wallet: spotSwap.wallet,
      swap: { ...spotSwap.swap },
      ...(spotSwap.options ? { options: { ...spotSwap.options } } : {}),
    },
  };
}

export function buildExecSubmitIntentSummary(
  value: ExecSubmitRequest,
): JsonObject | null {
  if (value.mode !== "privy_execute") return null;
  if (value.schemaVersion === SCHEMA_VERSION_V1) {
    const compat = resolveExecSubmitSpotSwap(value);
    if (!compat) return null;
    return {
      family: "spot_swap",
      marketType: "spot",
      inputMint: compat.swap.inputMint,
      outputMint: compat.swap.outputMint,
    };
  }

  const intent = value.privyExecute?.intent;
  if (!intent) return null;
  switch (intent.family) {
    case "spot_swap":
      return {
        family: intent.family,
        marketType: intent.marketType,
        ...(intent.venueKey ? { venueKey: intent.venueKey } : {}),
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
      };
    case "conditional_spot_order":
    case "clob_order":
    case "perp_order":
    case "prediction_order":
      return {
        family: intent.family,
        marketType: intent.marketType,
        venueKey: intent.venueKey,
        instrumentId: intent.instrumentId,
        ...(intent.side ? { side: intent.side } : {}),
        ...(intent.family === "prediction_order"
          ? { outcomeId: intent.outcomeId }
          : {}),
      };
    case "flash_atomic":
      return {
        family: intent.family,
        marketType: intent.marketType,
        venueKey: intent.venueKey,
        referenceId: intent.referenceId,
        settlementMint: intent.settlementMint,
        borrowLegCount: intent.borrowLegs.length,
      };
  }
}

export function parseExecSubmitPayload(
  value: unknown,
): ExecSubmitPayloadParseResult {
  if (!isRecord(value)) return { ok: false, error: "invalid-request" };
  if (
    !assertAllowedKeys(value, [
      "schemaVersion",
      "mode",
      "lane",
      "metadata",
      "relaySigned",
      "privyExecute",
    ])
  ) {
    return { ok: false, error: "invalid-request" };
  }

  const mode = parseMode(value.mode);
  const lane = parseLane(value.lane);
  const metadata = parseMetadata(value.metadata);
  if (!mode || !lane || metadata === null) {
    return { ok: false, error: "invalid-request" };
  }

  const schemaVersion = String(value.schemaVersion ?? "").trim();
  if (schemaVersion === SCHEMA_VERSION_V1) {
    return parseSubmitPayloadV1(value, mode, lane, metadata);
  }
  if (schemaVersion === SCHEMA_VERSION_V2) {
    return parseSubmitPayloadV2(value, mode, lane, metadata);
  }
  return { ok: false, error: "invalid-request" };
}
