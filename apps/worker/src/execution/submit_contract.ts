import type { ExecutionLane, ExecutionMode, JsonObject } from "./repository";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const SCHEMA_VERSION = "v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const allowedKeys = new Set(["source", "reason", "clientRequestId"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return null;
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
  const allowedKeys = new Set(["encoding", "signedTransaction"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return null;
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

function parsePrivyExecute(value: unknown): {
  intentType: "swap";
  wallet: string;
  swap: {
    inputMint: string;
    outputMint: string;
    amountAtomic: string;
    slippageBps: number;
  };
  options?: {
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
} | null {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set(["intentType", "wallet", "swap", "options"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return null;
  }

  if (String(value.intentType ?? "") !== "swap") return null;
  const wallet = String(value.wallet ?? "").trim();
  if (wallet.length < 32 || wallet.length > 64 || !BASE58_RE.test(wallet)) {
    return null;
  }

  if (!isRecord(value.swap)) return null;
  const swapAllowedKeys = new Set([
    "inputMint",
    "outputMint",
    "amountAtomic",
    "slippageBps",
  ]);
  for (const key of Object.keys(value.swap)) {
    if (!swapAllowedKeys.has(key)) return null;
  }

  const inputMint = String(value.swap.inputMint ?? "").trim();
  const outputMint = String(value.swap.outputMint ?? "").trim();
  const amountAtomic = String(value.swap.amountAtomic ?? "").trim();
  const slippageBps = Number(value.swap.slippageBps);
  if (
    inputMint.length < 32 ||
    inputMint.length > 64 ||
    !BASE58_RE.test(inputMint) ||
    outputMint.length < 32 ||
    outputMint.length > 64 ||
    !BASE58_RE.test(outputMint) ||
    !/^[1-9][0-9]*$/.test(amountAtomic) ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > 5_000
  ) {
    return null;
  }

  if (value.options !== undefined && !isRecord(value.options)) return null;
  const options = isRecord(value.options) ? value.options : {};
  const optionKeys = new Set([
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
  ]);
  for (const key of Object.keys(options)) {
    if (!optionKeys.has(key)) return null;
  }
  if (
    options.simulateOnly !== undefined &&
    typeof options.simulateOnly !== "boolean"
  ) {
    return null;
  }
  if (
    options.requireSimulation !== undefined &&
    typeof options.requireSimulation !== "boolean"
  ) {
    return null;
  }
  if (options.dryRun !== undefined && typeof options.dryRun !== "boolean") {
    return null;
  }
  if (options.priorityMicroLamports !== undefined) {
    const priorityMicroLamports = Number(options.priorityMicroLamports);
    if (
      !Number.isInteger(priorityMicroLamports) ||
      priorityMicroLamports < 0 ||
      priorityMicroLamports > 2_000_000
    ) {
      return null;
    }
  }
  if (
    options.commitment !== undefined &&
    options.commitment !== "processed" &&
    options.commitment !== "confirmed" &&
    options.commitment !== "finalized"
  ) {
    return null;
  }
  if (
    options.orderType !== undefined &&
    options.orderType !== "market" &&
    options.orderType !== "limit" &&
    options.orderType !== "trigger"
  ) {
    return null;
  }
  if (
    options.timeInForce !== undefined &&
    options.timeInForce !== "gtc" &&
    options.timeInForce !== "ioc" &&
    options.timeInForce !== "fok"
  ) {
    return null;
  }
  if (
    options.reduceOnly !== undefined &&
    typeof options.reduceOnly !== "boolean"
  ) {
    return null;
  }
  if (options.postOnly !== undefined && typeof options.postOnly !== "boolean") {
    return null;
  }
  if (
    options.quantityMode !== undefined &&
    options.quantityMode !== "base" &&
    options.quantityMode !== "quote" &&
    options.quantityMode !== "notional"
  ) {
    return null;
  }
  if (
    options.limitPriceAtomic !== undefined &&
    !/^[1-9][0-9]*$/.test(String(options.limitPriceAtomic))
  ) {
    return null;
  }
  if (
    options.triggerPriceAtomic !== undefined &&
    !/^[1-9][0-9]*$/.test(String(options.triggerPriceAtomic))
  ) {
    return null;
  }
  if (
    options.takeProfitPriceAtomic !== undefined &&
    !/^[1-9][0-9]*$/.test(String(options.takeProfitPriceAtomic))
  ) {
    return null;
  }
  if (
    options.stopLossPriceAtomic !== undefined &&
    !/^[1-9][0-9]*$/.test(String(options.stopLossPriceAtomic))
  ) {
    return null;
  }

  return {
    intentType: "swap",
    wallet,
    swap: {
      inputMint,
      outputMint,
      amountAtomic,
      slippageBps,
    },
    ...(Object.keys(options).length > 0
      ? {
          options: {
            ...(options.simulateOnly !== undefined
              ? { simulateOnly: options.simulateOnly as boolean }
              : {}),
            ...(options.requireSimulation !== undefined
              ? { requireSimulation: options.requireSimulation as boolean }
              : {}),
            ...(options.dryRun !== undefined
              ? { dryRun: options.dryRun as boolean }
              : {}),
            ...(options.priorityMicroLamports !== undefined
              ? {
                  priorityMicroLamports: Number(options.priorityMicroLamports),
                }
              : {}),
            ...(options.commitment !== undefined
              ? {
                  commitment: options.commitment as
                    | "processed"
                    | "confirmed"
                    | "finalized",
                }
              : {}),
            ...(options.orderType !== undefined
              ? {
                  orderType: options.orderType as
                    | "market"
                    | "limit"
                    | "trigger",
                }
              : {}),
            ...(options.timeInForce !== undefined
              ? {
                  timeInForce: options.timeInForce as "gtc" | "ioc" | "fok",
                }
              : {}),
            ...(options.reduceOnly !== undefined
              ? { reduceOnly: options.reduceOnly as boolean }
              : {}),
            ...(options.postOnly !== undefined
              ? { postOnly: options.postOnly as boolean }
              : {}),
            ...(options.quantityMode !== undefined
              ? {
                  quantityMode: options.quantityMode as
                    | "base"
                    | "quote"
                    | "notional",
                }
              : {}),
            ...(options.limitPriceAtomic !== undefined
              ? { limitPriceAtomic: String(options.limitPriceAtomic) }
              : {}),
            ...(options.triggerPriceAtomic !== undefined
              ? { triggerPriceAtomic: String(options.triggerPriceAtomic) }
              : {}),
            ...(options.takeProfitPriceAtomic !== undefined
              ? { takeProfitPriceAtomic: String(options.takeProfitPriceAtomic) }
              : {}),
            ...(options.stopLossPriceAtomic !== undefined
              ? { stopLossPriceAtomic: String(options.stopLossPriceAtomic) }
              : {}),
          },
        }
      : {}),
  };
}

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
  };
};

export type ExecSubmitPayloadParseResult =
  | {
      ok: true;
      value: ExecSubmitRequestV1;
      metadataForStorage: JsonObject | null;
    }
  | { ok: false; error: "invalid-request" };

export function parseExecSubmitPayload(
  value: unknown,
): ExecSubmitPayloadParseResult {
  if (!isRecord(value)) return { ok: false, error: "invalid-request" };
  const allowedTopLevel = new Set([
    "schemaVersion",
    "mode",
    "lane",
    "metadata",
    "relaySigned",
    "privyExecute",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedTopLevel.has(key)) {
      return { ok: false, error: "invalid-request" };
    }
  }

  if (String(value.schemaVersion ?? "") !== SCHEMA_VERSION) {
    return { ok: false, error: "invalid-request" };
  }
  const mode = parseMode(value.mode);
  const lane = parseLane(value.lane);
  if (!mode || !lane) return { ok: false, error: "invalid-request" };

  const metadata = parseMetadata(value.metadata);
  if (metadata === null) return { ok: false, error: "invalid-request" };

  if (mode === "relay_signed") {
    const relaySigned = parseRelaySigned(value.relaySigned);
    if (!relaySigned || value.privyExecute !== undefined) {
      return { ok: false, error: "invalid-request" };
    }
    return {
      ok: true,
      value: {
        schemaVersion: "v1",
        mode,
        lane,
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
        relaySigned,
      },
      metadataForStorage:
        metadata && Object.keys(metadata).length > 0
          ? ({ ...metadata } as JsonObject)
          : null,
    };
  }

  const privyExecute = parsePrivyExecute(value.privyExecute);
  if (!privyExecute || value.relaySigned !== undefined) {
    return { ok: false, error: "invalid-request" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: "v1",
      mode,
      lane,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      privyExecute,
    },
    metadataForStorage:
      metadata && Object.keys(metadata).length > 0
        ? ({ ...metadata } as JsonObject)
        : null,
  };
}
