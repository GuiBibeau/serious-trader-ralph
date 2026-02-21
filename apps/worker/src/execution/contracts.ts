import type { JupiterQuoteResponse } from "../jupiter";
import type { Env, ExecutionConfig } from "../types";
import type { ExecuteSwapResult } from "./types";

export const EXECUTION_SCHEMA_VERSION = "v1" as const;

export type ExecutionIntent = {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  intentId: string;
  receivedAt: string;
  userId: string;
  wallet: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
  source: string;
  reason: string | null;
  execution: {
    adapter: string;
    params: Record<string, unknown> | null;
  };
  policy: {
    simulateOnly: boolean;
    dryRun: boolean;
    commitment: "processed" | "confirmed" | "finalized";
  };
};

export type ExecutionDecision = {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  decisionId: string;
  intentId: string;
  decidedAt: string;
  route: string;
  simulateOnly: boolean;
  dryRun: boolean;
  commitment: "processed" | "confirmed" | "finalized";
};

export type ExecutionLatencyTrace = {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  receivedAt: string;
  validatedAt: string | null;
  decisionAt: string | null;
  txBuiltAt: string | null;
  simulatedAt: string | null;
  sentAt: string | null;
  landedAt: string | null;
  confirmedAt: string | null;
  finalizedAt: string | null;
  failedAt: string | null;
};

export type ExecutionOutcome = {
  status: ExecuteSwapResult["status"] | "error" | "rejected" | "not_executed";
  signature: string | null;
  refreshed: boolean;
  lastValidBlockHeight: number | null;
  error: string | null;
};

export type ExecutionReceipt = {
  schemaVersion: typeof EXECUTION_SCHEMA_VERSION;
  generatedAt: string;
  receiptId: string;
  intent: ExecutionIntent;
  decision: ExecutionDecision;
  trace: ExecutionLatencyTrace;
  outcome: ExecutionOutcome;
  quote: {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    routeHopCount: number;
  };
  storage: {
    contentSha256: string;
    key: string;
  };
};

function toIsoOrFallback(value: string, fallback: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function summarizeQuote(
  input: JupiterQuoteResponse,
): ExecutionReceipt["quote"] {
  const hopCount = Array.isArray(input.routePlan) ? input.routePlan.length : 0;
  return {
    inputMint: String(input.inputMint ?? ""),
    outputMint: String(input.outputMint ?? ""),
    inAmount: String(input.inAmount ?? ""),
    outAmount: String(input.outAmount ?? ""),
    priceImpactPct:
      typeof input.priceImpactPct === "number" &&
      Number.isFinite(input.priceImpactPct)
        ? input.priceImpactPct
        : Number(input.priceImpactPct ?? 0) || 0,
    routeHopCount: hopCount,
  };
}

function stableOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableOrder(item));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    ordered[key] = stableOrder(record[key]);
  }
  return ordered;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableOrder(value));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function normalizeError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) {
    return value.message.slice(0, 2_000);
  }
  if (typeof value === "string") {
    return value.slice(0, 2_000);
  }
  try {
    return JSON.stringify(value).slice(0, 2_000);
  } catch {
    return String(value).slice(0, 2_000);
  }
}

function receiptStorageKey(hash: string): string {
  return `exec/${EXECUTION_SCHEMA_VERSION}/receipts/sha256=${hash}.json`;
}

export function createExecutionIntent(input: {
  receivedAt: string;
  userId: string;
  wallet: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
  source: string;
  reason?: string;
  execution?: ExecutionConfig;
  simulateOnly: boolean;
  dryRun: boolean;
  commitment: "processed" | "confirmed" | "finalized";
}): ExecutionIntent {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    intentId: crypto.randomUUID(),
    receivedAt: toIsoOrFallback(input.receivedAt, new Date().toISOString()),
    userId: input.userId,
    wallet: input.wallet,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amountAtomic: input.amountAtomic,
    slippageBps: input.slippageBps,
    source: input.source.trim() || "TERMINAL",
    reason:
      typeof input.reason === "string" && input.reason.trim().length > 0
        ? input.reason.trim()
        : null,
    execution: {
      adapter:
        String(input.execution?.adapter ?? "jupiter").trim() || "jupiter",
      params:
        input.execution?.params &&
        typeof input.execution.params === "object" &&
        !Array.isArray(input.execution.params)
          ? { ...input.execution.params }
          : null,
    },
    policy: {
      simulateOnly: input.simulateOnly,
      dryRun: input.dryRun,
      commitment: input.commitment,
    },
  };
}

export function createExecutionDecision(input: {
  intentId: string;
  decidedAt: string;
  route: string;
  simulateOnly: boolean;
  dryRun: boolean;
  commitment: "processed" | "confirmed" | "finalized";
}): ExecutionDecision {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    decisionId: crypto.randomUUID(),
    intentId: input.intentId,
    decidedAt: toIsoOrFallback(input.decidedAt, new Date().toISOString()),
    route: input.route.trim() || "jupiter",
    simulateOnly: input.simulateOnly,
    dryRun: input.dryRun,
    commitment: input.commitment,
  };
}

export function newExecutionLatencyTrace(
  receivedAt: string,
): ExecutionLatencyTrace {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    receivedAt: toIsoOrFallback(receivedAt, new Date().toISOString()),
    validatedAt: null,
    decisionAt: null,
    txBuiltAt: null,
    simulatedAt: null,
    sentAt: null,
    landedAt: null,
    confirmedAt: null,
    finalizedAt: null,
    failedAt: null,
  };
}

export function buildExecutionOutcomeFromResult(
  result: ExecuteSwapResult,
): ExecutionOutcome {
  return {
    status: result.status,
    signature: result.signature ?? null,
    refreshed: Boolean(result.refreshed),
    lastValidBlockHeight:
      typeof result.lastValidBlockHeight === "number"
        ? result.lastValidBlockHeight
        : null,
    error: normalizeError(result.err),
  };
}

export function buildExecutionOutcomeFromError(
  error: unknown,
): ExecutionOutcome {
  return {
    status: "error",
    signature: null,
    refreshed: false,
    lastValidBlockHeight: null,
    error: normalizeError(error) ?? "unknown-error",
  };
}

export function applyExecutionResultToTrace(input: {
  trace: ExecutionLatencyTrace;
  result: ExecuteSwapResult;
  settledAt: string;
}): ExecutionLatencyTrace {
  const settledAt = toIsoOrFallback(input.settledAt, new Date().toISOString());
  const next: ExecutionLatencyTrace = {
    ...input.trace,
    ...(input.result.signature
      ? { sentAt: input.trace.sentAt ?? settledAt }
      : {}),
  };

  if (
    input.result.status === "simulated" ||
    input.result.status === "simulate_error"
  ) {
    next.simulatedAt = settledAt;
  }
  if (input.result.status === "processed") {
    next.landedAt = next.landedAt ?? settledAt;
  }
  if (input.result.status === "confirmed") {
    next.landedAt = next.landedAt ?? settledAt;
    next.confirmedAt = settledAt;
  }
  if (input.result.status === "finalized") {
    next.landedAt = next.landedAt ?? settledAt;
    next.confirmedAt = next.confirmedAt ?? settledAt;
    next.finalizedAt = settledAt;
  }
  if (
    input.result.status === "simulate_error" ||
    input.result.status === "error"
  ) {
    next.failedAt = settledAt;
  }

  return next;
}

export async function buildExecutionReceipt(input: {
  generatedAt?: string;
  intent: ExecutionIntent;
  decision: ExecutionDecision;
  trace: ExecutionLatencyTrace;
  outcome: ExecutionOutcome;
  quote: JupiterQuoteResponse;
}): Promise<ExecutionReceipt> {
  const generatedAt = toIsoOrFallback(
    input.generatedAt ?? new Date().toISOString(),
    new Date().toISOString(),
  );
  const base = {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    generatedAt,
    intent: input.intent,
    decision: input.decision,
    trace: input.trace,
    outcome: input.outcome,
    quote: summarizeQuote(input.quote),
  } as const;
  const contentSha256 = await sha256Hex(stableStringify(base));

  return {
    ...base,
    receiptId: `exec_${contentSha256.slice(0, 16)}`,
    storage: {
      contentSha256,
      key: receiptStorageKey(contentSha256),
    },
  };
}

export async function recordExecutionReceipt(
  env: Env,
  input: {
    generatedAt?: string;
    intent: ExecutionIntent;
    decision: ExecutionDecision;
    trace: ExecutionLatencyTrace;
    outcome: ExecutionOutcome;
    quote: JupiterQuoteResponse;
  },
): Promise<ExecutionReceipt> {
  const receipt = await buildExecutionReceipt(input);
  if (env.LOGS_BUCKET) {
    await env.LOGS_BUCKET.put(receipt.storage.key, JSON.stringify(receipt));
  }
  return receipt;
}
