import { buildAndSignPrivySwapTransaction } from "./privy_swap_builder";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

type SenderRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type SenderRpcResponse = {
  result?: unknown;
  error?: SenderRpcError;
};

const DEFAULT_FAST_MAX_RETRIES = 2;
const DEFAULT_FAST_RETRY_BASE_MS = 200;
const MAX_FAST_RETRIES = 5;
const MAX_FAST_RETRY_BASE_MS = 5_000;

type HeliusSenderExecutorDeps = {
  buildAndSignPrivySwapTransaction?: typeof buildAndSignPrivySwapTransaction;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.floor(parsed);
  if (bounded < min) return min;
  if (bounded > max) return max;
  return bounded;
}

function normalizeSenderEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function resolveSenderEndpoint(input: ExecuteSwapInput): string {
  const explicit = normalizeSenderEndpoint(
    String(input.env.HELIUS_SENDER_URL ?? ""),
  );
  if (explicit) return explicit;
  throw new Error("helius-sender-url-missing");
}

function resolveSenderHeaders(input: ExecuteSwapInput): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const apiKey = String(input.env.HELIUS_API_KEY ?? "").trim();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function senderRpc(
  input: ExecuteSwapInput,
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: resolveSenderHeaders(input),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `helius-sender-http-error:${response.status}${text ? `:${text.slice(0, 200)}` : ""}`,
    );
  }

  const payload = (await response.json()) as SenderRpcResponse;
  if (payload.error) {
    throw new Error(
      `helius-sender-rpc-error:${payload.error.code ?? "unknown"}:${payload.error.message ?? "no-message"}`,
    );
  }
  return payload.result;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function mapFastLaneErrorCode(messageRaw: string): string {
  const message = messageRaw.toLowerCase();
  if (
    message.includes("blockhash") &&
    (message.includes("not found") ||
      message.includes("stale") ||
      message.includes("expired"))
  ) {
    return "expired-blockhash";
  }
  if (message.includes("timeout")) return "venue-timeout";
  return "submission-failed";
}

function normalizeConfirmationStatus(
  status: string | undefined,
): Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized" | "error"
> {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return status;
  }
  return "error";
}

function classificationFromStatus(
  status: Extract<
    ExecuteSwapResult["status"],
    "processed" | "confirmed" | "finalized" | "error"
  >,
): ExecuteSwapResult["executionMeta"]["classification"] {
  if (status === "processed") return "landed";
  if (status === "confirmed") return "confirmed";
  if (status === "finalized") return "finalized";
  return "error";
}

function retryBackoffMs(attemptNo: number, baseMs: number): number {
  return Math.max(0, attemptNo) * Math.max(0, baseMs);
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeHeliusSenderSwap(
  input: ExecuteSwapInput,
  deps: HeliusSenderExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  const route = "helius_sender";
  const {
    policy,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
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

  if (input.guardEnabled) await input.guardEnabled();

  const endpoint = resolveSenderEndpoint(input);
  const maxRetries = parseBoundedInt(
    input.env.EXEC_FAST_MAX_RETRIES,
    DEFAULT_FAST_MAX_RETRIES,
    0,
    MAX_FAST_RETRIES,
  );
  const retryBaseMs = parseBoundedInt(
    input.env.EXEC_FAST_RETRY_BASE_MS,
    DEFAULT_FAST_RETRY_BASE_MS,
    0,
    MAX_FAST_RETRY_BASE_MS,
  );
  const maxAttempts = maxRetries + 1;
  const buildAndSign =
    deps.buildAndSignPrivySwapTransaction ?? buildAndSignPrivySwapTransaction;

  const {
    signedBase64,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    txBuiltAt,
  } = await buildAndSign({
    ...input,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
    execution: input.execution,
    guardEnabled: input.guardEnabled,
  });

  if (policy.simulateOnly) {
    const sim = await rpc.simulateTransactionBase64(signedBase64, {
      commitment: policy.commitment,
      sigVerify: true,
    });
    const simulatedAt = nowIso();
    const ok = !sim.err;
    return {
      status: ok ? "simulated" : "simulate_error",
      signature: null,
      usedQuote,
      refreshed,
      lastValidBlockHeight,
      err: sim.err ?? null,
      executionMeta: {
        route,
        classification: ok ? "simulated" : "error",
        trace: {
          txBuiltAt,
          simulatedAt,
          ...(ok ? {} : { failedAt: simulatedAt }),
        },
      },
    };
  }

  let lastErrorCode = "submission-failed";
  let lastErrorMessage = "helius-sender-submission-failed";
  for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
    if (input.guardEnabled) await input.guardEnabled();
    try {
      const rawSignature = await senderRpc(input, endpoint, "sendTransaction", [
        signedBase64,
        {
          encoding: "base64",
          skipPreflight: policy.skipPreflight,
          preflightCommitment: policy.commitment,
          maxRetries: 0,
        },
      ]);
      const signature =
        typeof rawSignature === "string" ? rawSignature.trim() : "";
      if (!signature) {
        throw new Error("helius-sender-rpc-error:missing-signature");
      }
      const sentAt = nowIso();

      log("info", "helius.sender.submit", {
        route,
        attemptNo,
        maxAttempts,
        endpoint,
        signature,
      });

      const confirmation = await rpc.confirmSignature(signature, {
        commitment: policy.commitment,
      });
      const terminalAt = nowIso();
      if (!confirmation.ok) {
        const failureMessage =
          confirmation.status === "timeout"
            ? "venue-timeout"
            : asErrorMessage(confirmation.err ?? "confirmation-error");
        lastErrorCode = mapFastLaneErrorCode(failureMessage);
        lastErrorMessage = failureMessage;
        log("warn", "helius.sender.confirmation.failed", {
          route,
          attemptNo,
          maxAttempts,
          signature,
          status: confirmation.status ?? "unknown",
          errorCode: lastErrorCode,
          errorMessage: lastErrorMessage,
        });
        if (attemptNo < maxAttempts) {
          await sleepMs(retryBackoffMs(attemptNo, retryBaseMs));
          continue;
        }
        return {
          status: "error",
          signature,
          usedQuote,
          refreshed,
          lastValidBlockHeight,
          err: {
            code: lastErrorCode,
            message: lastErrorMessage,
            attempts: attemptNo,
          },
          executionMeta: {
            route,
            classification: "error",
            trace: {
              txBuiltAt,
              sentAt,
              failedAt: terminalAt,
            },
          },
        };
      }

      const status = normalizeConfirmationStatus(confirmation.status);
      return {
        status,
        signature,
        usedQuote,
        refreshed,
        lastValidBlockHeight,
        err: null,
        executionMeta: {
          route,
          classification: classificationFromStatus(status),
          trace: {
            txBuiltAt,
            sentAt,
            ...(status === "processed" ? { landedAt: terminalAt } : {}),
            ...(status === "confirmed"
              ? {
                  landedAt: terminalAt,
                  confirmedAt: terminalAt,
                }
              : {}),
            ...(status === "finalized"
              ? {
                  landedAt: terminalAt,
                  confirmedAt: terminalAt,
                  finalizedAt: terminalAt,
                }
              : {}),
            ...(status === "error" ? { failedAt: terminalAt } : {}),
          },
        },
      };
    } catch (error) {
      const message = asErrorMessage(error);
      lastErrorCode = mapFastLaneErrorCode(message);
      lastErrorMessage = message;
      log("warn", "helius.sender.submit.failed", {
        route,
        attemptNo,
        maxAttempts,
        endpoint,
        errorCode: lastErrorCode,
        errorMessage: lastErrorMessage,
      });
      if (attemptNo < maxAttempts) {
        await sleepMs(retryBackoffMs(attemptNo, retryBaseMs));
      }
    }
  }

  const failedAt = nowIso();
  return {
    status: "error",
    signature: null,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    err: {
      code: lastErrorCode,
      message: lastErrorMessage,
      attempts: maxAttempts,
    },
    executionMeta: {
      route,
      classification: "error",
      trace: {
        txBuiltAt,
        failedAt,
      },
    },
  };
}
