import { swapWithRetry } from "../swap";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readSettlementRef(record: Record<string, unknown>): string | null {
  return (
    readString(record, "settlementRef") ??
    readString(record, "settlement_reference") ??
    readString(record, "txSignature") ??
    readString(record, "signature")
  );
}

function normalizeSettlementStatus(raw: string | null): {
  status: Extract<
    ExecuteSwapResult["status"],
    "processed" | "confirmed" | "finalized" | "error"
  >;
  classification: NonNullable<
    ExecuteSwapResult["executionMeta"]
  >["classification"];
} {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return { status: "error", classification: "error" };
  if (normalized.includes("final")) {
    return {
      status: "finalized",
      classification: "finalized",
    };
  }
  if (normalized.includes("confirm")) {
    return {
      status: "confirmed",
      classification: "confirmed",
    };
  }
  if (
    normalized.includes("land") ||
    normalized.includes("process") ||
    normalized.includes("commit")
  ) {
    return {
      status: "processed",
      classification: "landed",
    };
  }
  if (normalized.includes("submit") || normalized.includes("pending")) {
    return {
      status: "processed",
      classification: "submitted",
    };
  }
  return {
    status: "error",
    classification: "error",
  };
}

async function postMagicBlockJson(input: {
  baseUrl: string;
  path: string;
  apiKey?: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const apiKey = String(input.apiKey ?? "").trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input.payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `magicblock-http-error:${response.status}${text ? `:${text.slice(0, 200)}` : ""}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  if (!record) {
    throw new Error("magicblock-invalid-response");
  }
  const errorRecord = asRecord(record.error);
  if (errorRecord) {
    const message = readString(errorRecord, "message") ?? "magicblock-error";
    throw new Error(message);
  }
  return record;
}

export async function executeMagicBlockEphemeralRollupSwap(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  const route = "magicblock_ephemeral_rollup";
  const {
    env,
    policy,
    jupiter,
    quoteResponse,
    userPublicKey,
    log,
    guardEnabled,
  } = input;

  if (policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: quoteResponse,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
      },
    };
  }

  const baseUrl = normalizeBaseUrl(
    String(env.MAGICBLOCK_EPHEMERAL_ROLLUP_URL ?? ""),
  );
  if (!baseUrl) {
    throw new Error("magicblock-ephemeral-rollup-url-missing");
  }

  if (guardEnabled) await guardEnabled();

  const {
    swap,
    quoteResponse: usedQuote,
    refreshed,
  } = await swapWithRetry(jupiter, quoteResponse, userPublicKey, policy);
  const txBuiltAt = nowIso();

  const matchPayload: Record<string, unknown> = {
    schemaVersion: "v1",
    mode: policy.simulateOnly ? "simulate" : "commit",
    userPublicKey,
    quote: {
      inputMint: usedQuote.inputMint,
      outputMint: usedQuote.outputMint,
      inAmount: usedQuote.inAmount,
      outAmount: usedQuote.outAmount,
    },
    policy: {
      commitment: policy.commitment,
      slippageBps: policy.slippageBps,
      simulateOnly: policy.simulateOnly,
    },
    execution: {
      adapter: route,
      params: input.execution?.params ?? null,
    },
  };

  log("info", "magicblock.intent.match.start", {
    endpoint: `${baseUrl}/v1/intents/match`,
  });
  const matchRecord = await postMagicBlockJson({
    baseUrl,
    path: "/v1/intents/match",
    apiKey: env.MAGICBLOCK_API_KEY,
    payload: matchPayload,
  });
  const simulatedAt = nowIso();
  const intentId =
    readString(matchRecord, "matchId") ??
    readString(matchRecord, "intentId") ??
    readString(matchRecord, "id");
  const venueSessionId =
    readString(matchRecord, "sessionId") ??
    readString(matchRecord, "session_id");

  if (policy.simulateOnly) {
    return {
      status: "simulated",
      signature: null,
      usedQuote,
      refreshed,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        intentId,
        venueSessionId,
        trace: {
          txBuiltAt,
          simulatedAt,
        },
      },
    };
  }

  if (guardEnabled) await guardEnabled();

  const commitPayload: Record<string, unknown> = {
    schemaVersion: "v1",
    matchId: intentId,
    sessionId: venueSessionId,
    quote: {
      inputMint: usedQuote.inputMint,
      outputMint: usedQuote.outputMint,
      inAmount: usedQuote.inAmount,
      outAmount: usedQuote.outAmount,
    },
    policy: {
      commitment: policy.commitment,
      skipPreflight: policy.skipPreflight,
    },
    execution: {
      adapter: route,
      params: input.execution?.params ?? null,
    },
  };

  log("info", "magicblock.intent.commit.start", {
    endpoint: `${baseUrl}/v1/intents/commit`,
    intentId,
    venueSessionId,
  });
  const commitRecord = await postMagicBlockJson({
    baseUrl,
    path: "/v1/intents/commit",
    apiKey: env.MAGICBLOCK_API_KEY,
    payload: commitPayload,
  });
  const committedAt = nowIso();
  const settlementRef = readSettlementRef(commitRecord);
  const rawStatus =
    readString(commitRecord, "status") ??
    readString(commitRecord, "commitment");
  const { status, classification } =
    rawStatus || settlementRef
      ? rawStatus
        ? normalizeSettlementStatus(rawStatus)
        : { status: "confirmed", classification: "confirmed" as const }
      : { status: "error", classification: "error" as const };

  return {
    status,
    signature: settlementRef,
    usedQuote,
    refreshed,
    lastValidBlockHeight: swap.lastValidBlockHeight,
    err:
      status === "error"
        ? {
            reason: "magicblock-commit-failed",
            status: rawStatus,
            settlementRef,
            intentId,
            venueSessionId,
          }
        : null,
    executionMeta: {
      route,
      classification,
      intentId,
      venueSessionId,
      settlementRef,
      trace: {
        txBuiltAt,
        sentAt: committedAt,
        ...(status === "processed" ? { landedAt: committedAt } : {}),
        ...(status === "confirmed" || status === "finalized"
          ? { landedAt: committedAt, confirmedAt: committedAt }
          : {}),
        ...(status === "finalized" ? { finalizedAt: committedAt } : {}),
        ...(status === "error" ? { failedAt: committedAt } : {}),
      },
    },
  };
}
