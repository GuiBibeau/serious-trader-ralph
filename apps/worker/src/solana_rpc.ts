import type { Env } from "./types";

type RpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type RpcResponse<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: RpcError;
};

const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_READ_RETRIES = 2;
const DEFAULT_RETRY_BASE_BACKOFF_MS = 150;

type RequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
  retryable?: boolean;
};

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRpcRequestError(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  return (
    message.includes("rpc-http-error: 429") ||
    message.includes("rpc-http-error: 500") ||
    message.includes("rpc-http-error: 502") ||
    message.includes("rpc-http-error: 503") ||
    message.includes("rpc-http-error: 504") ||
    message.includes("rpc-timeout") ||
    message.includes("timed out") ||
    message.includes("abort") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("temporar") ||
    message.includes("-32603") ||
    message.includes("internal error")
  );
}

export class SolanaRpc {
  constructor(private readonly endpoint: string) {}

  static fromEnv(env: Env): SolanaRpc {
    const endpoint = env.RPC_ENDPOINT;
    if (!endpoint) throw new Error("rpc-endpoint-missing");
    return new SolanaRpc(endpoint);
  }

  async request<T>(
    method: string,
    params: unknown[] = [],
    options: RequestOptions = {},
  ): Promise<T> {
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS);
    const retries = Math.max(0, options.retries ?? 0);
    const retryBackoffMs = Math.max(
      0,
      options.retryBackoffMs ?? DEFAULT_RETRY_BASE_BACKOFF_MS,
    );
    const maxAttempts = retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        let response: Response;
        try {
          response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: crypto.randomUUID(),
              method,
              params,
            }),
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`rpc-timeout: ${timeoutMs}ms`);
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`rpc-http-error: ${response.status} ${text}`);
        }
        const payload = (await response.json()) as RpcResponse<T>;
        if (payload.error) {
          throw new Error(
            `rpc-error: ${payload.error.code ?? "?"} ${payload.error.message ?? safeJsonString(payload.error)}`,
          );
        }
        if (!("result" in payload)) {
          throw new Error("rpc-missing-result");
        }
        return payload.result as T;
      } catch (error) {
        const shouldRetry =
          options.retryable === true &&
          attempt < maxAttempts &&
          isRetryableRpcRequestError(error);
        if (!shouldRetry) {
          throw error;
        }

        const delayMs = retryBackoffMs * 2 ** (attempt - 1);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }

    throw new Error("rpc-unreachable");
  }

  async getBalanceLamports(pubkey: string): Promise<bigint> {
    const result = await this.request<{ value: number }>(
      "getBalance",
      [pubkey],
      {
        retryable: true,
        retries: DEFAULT_READ_RETRIES,
      },
    );
    return BigInt(result.value ?? 0);
  }

  async getSlot(
    commitment?: "processed" | "confirmed" | "finalized",
  ): Promise<number> {
    if (!commitment) {
      return await this.request<number>("getSlot", [], {
        retryable: true,
        retries: DEFAULT_READ_RETRIES,
      });
    }
    return await this.request<number>("getSlot", [{ commitment }], {
      retryable: true,
      retries: DEFAULT_READ_RETRIES,
    });
  }

  async getBlock(
    slot: number,
    opts?: {
      commitment?: "processed" | "confirmed" | "finalized";
      maxSupportedTransactionVersion?: number;
      transactionDetails?: "full" | "accounts" | "signatures" | "none";
      rewards?: boolean;
    },
  ): Promise<Record<string, unknown> | null> {
    const config = {
      commitment: opts?.commitment ?? "confirmed",
      maxSupportedTransactionVersion: opts?.maxSupportedTransactionVersion ?? 0,
      transactionDetails: opts?.transactionDetails ?? "full",
      rewards: opts?.rewards ?? false,
      encoding: "json",
    };
    return await this.request<Record<string, unknown> | null>(
      "getBlock",
      [slot, config],
      {
        retryable: true,
        // Block fetcher already retries at the target level; avoid nested
        // retries multiplying worst-case latency per tick.
        retries: 0,
      },
    );
  }

  async getTokenBalanceAtomic(owner: string, mint: string): Promise<bigint> {
    const result = await this.request<{
      value: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                tokenAmount?: { amount?: string };
              };
            };
          };
        };
      }>;
    }>(
      "getTokenAccountsByOwner",
      [owner, { mint }, { encoding: "jsonParsed" }],
      {
        retryable: true,
        retries: DEFAULT_READ_RETRIES,
      },
    );

    let total = 0n;
    for (const item of result.value ?? []) {
      const amount = item.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (typeof amount === "string") {
        try {
          total += BigInt(amount);
        } catch {
          // ignore malformed rows
        }
      }
    }
    return total;
  }

  async sendTransactionBase64(
    signedBase64Tx: string,
    opts?: {
      skipPreflight?: boolean;
      preflightCommitment?: "processed" | "confirmed" | "finalized";
      maxRetries?: number;
    },
  ): Promise<string> {
    const config: Record<string, unknown> = { encoding: "base64" };
    if (opts?.skipPreflight !== undefined)
      config.skipPreflight = opts.skipPreflight;
    if (opts?.preflightCommitment)
      config.preflightCommitment = opts.preflightCommitment;
    if (opts?.maxRetries !== undefined) config.maxRetries = opts.maxRetries;
    return await this.request<string>("sendTransaction", [
      signedBase64Tx,
      config,
    ]);
  }

  async simulateTransactionBase64(
    signedBase64Tx: string,
    opts?: {
      commitment?: "processed" | "confirmed" | "finalized";
      sigVerify?: boolean;
    },
  ): Promise<{
    err?: unknown;
    logs?: string[];
    unitsConsumed?: number;
    returnData?: unknown;
  }> {
    const config: Record<string, unknown> = { encoding: "base64" };
    if (opts?.commitment) config.commitment = opts.commitment;
    if (opts?.sigVerify !== undefined) config.sigVerify = opts.sigVerify;

    const result = await this.request<{
      value?: {
        err?: unknown;
        logs?: string[];
        unitsConsumed?: number;
        returnData?: unknown;
      };
    }>("simulateTransaction", [signedBase64Tx, config]);

    return result.value ?? {};
  }

  async getSignatureStatus(signature: string): Promise<{
    confirmationStatus?: string;
    err?: unknown;
  } | null> {
    const result = await this.request<{
      value: Array<{
        confirmationStatus?: string;
        err?: unknown;
      } | null>;
    }>(
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
      {
        retryable: true,
        retries: DEFAULT_READ_RETRIES,
      },
    );
    return result.value?.[0] || null;
  }

  async confirmSignature(
    signature: string,
    opts?: {
      commitment?: "processed" | "confirmed" | "finalized";
      timeoutMs?: number;
      pollMs?: number;
    },
  ): Promise<{ ok: boolean; status?: string; err?: unknown }> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const pollMs = opts?.pollMs ?? 1_000;
    const want = opts?.commitment ?? "confirmed";
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const status = await this.getSignatureStatus(signature);
      if (status) {
        const confirmationStatus = status.confirmationStatus ?? "unknown";
        if (status.err) {
          return { ok: false, status: confirmationStatus, err: status.err };
        }
        if (
          confirmationStatus === want ||
          (want === "confirmed" && confirmationStatus === "finalized") ||
          (want === "processed" &&
            (confirmationStatus === "confirmed" ||
              confirmationStatus === "finalized"))
        ) {
          return { ok: true, status: confirmationStatus };
        }
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    return { ok: false, status: "timeout" };
  }
}
