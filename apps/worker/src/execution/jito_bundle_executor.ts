import { buildAndSignPrivySwapTransaction } from "./privy_swap_builder";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

type JitoRpcResponse = {
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

let cachedTipAccounts: {
  endpoint: string;
  fetchedAtMs: number;
  accounts: string[];
} | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBlockEngineEndpoint(raw: string): string {
  const input = raw.trim();
  if (!input) return "";
  if (input.endsWith("/api/v1/bundles")) return input;
  return `${input.replace(/\/+$/, "")}/api/v1/bundles`;
}

async function jitoRpc(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `jito-rpc-http-error:${response.status}${text ? `:${text.slice(0, 200)}` : ""}`,
    );
  }
  const payload = (await response.json()) as JitoRpcResponse;
  if (payload.error) {
    throw new Error(
      `jito-rpc-error:${payload.error.code ?? "unknown"}:${payload.error.message ?? "no-message"}`,
    );
  }
  return payload.result;
}

async function resolveTipAccount(endpoint: string): Promise<string | null> {
  const nowMs = Date.now();
  if (
    cachedTipAccounts &&
    cachedTipAccounts.endpoint === endpoint &&
    nowMs - cachedTipAccounts.fetchedAtMs < 5 * 60_000 &&
    cachedTipAccounts.accounts.length > 0
  ) {
    return cachedTipAccounts.accounts[0] ?? null;
  }

  const result = await jitoRpc(endpoint, "getTipAccounts", []);
  const accounts = Array.isArray(result)
    ? result
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  cachedTipAccounts = {
    endpoint,
    fetchedAtMs: nowMs,
    accounts,
  };
  return accounts[0] ?? null;
}

function extractBundleStatus(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.toLowerCase();
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const statusCandidates = [
    record.confirmationStatus,
    record.confirmation_status,
    record.status,
    record.state,
  ];
  for (const candidate of statusCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

function mapBundleStatusToResult(
  bundleStatus: string | null,
): Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized" | "error"
> {
  if (!bundleStatus) return "processed";
  if (bundleStatus.includes("final")) return "finalized";
  if (bundleStatus.includes("confirm")) return "confirmed";
  if (bundleStatus.includes("land") || bundleStatus.includes("process")) {
    return "processed";
  }
  if (bundleStatus.includes("fail") || bundleStatus.includes("drop")) {
    return "error";
  }
  return "processed";
}

export async function executeJitoBundleSwap(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  const route = "jito_bundle";
  const {
    env,
    policy,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
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

  const endpoint = normalizeBlockEngineEndpoint(
    String(env.JITO_BLOCK_ENGINE_URL ?? ""),
  );
  if (!endpoint) {
    throw new Error("jito-block-engine-url-missing");
  }

  if (guardEnabled) await guardEnabled();

  const {
    signedBase64,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    txBuiltAt,
  } = await buildAndSignPrivySwapTransaction({
    env,
    policy,
    rpc,
    jupiter,
    quoteResponse,
    userPublicKey,
    privyWalletId,
    log,
    execution: input.execution,
    guardEnabled,
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

  if (guardEnabled) await guardEnabled();

  const tipAccount = await resolveTipAccount(endpoint);
  const sendBundleParams = [
    [signedBase64],
    {
      encoding: "base64",
      ...(tipAccount ? { tipAccount } : {}),
    },
  ];

  log("info", "jito.bundle.submit", {
    endpoint,
    tipAccount: tipAccount ?? undefined,
  });
  const bundleResult = await jitoRpc(endpoint, "sendBundle", sendBundleParams);
  const bundleId =
    typeof bundleResult === "string" && bundleResult.trim()
      ? bundleResult.trim()
      : null;
  const sentAt = nowIso();

  let bundleStatus: string | null = null;
  if (bundleId) {
    const statuses = await jitoRpc(endpoint, "getBundleStatuses", [[bundleId]]);
    if (Array.isArray(statuses) && statuses.length > 0) {
      bundleStatus = extractBundleStatus(statuses[0]);
    } else {
      bundleStatus = extractBundleStatus(statuses);
    }
  }

  const landedAt = nowIso();
  const status = mapBundleStatusToResult(bundleStatus);
  const classification =
    status === "processed"
      ? "landed"
      : status === "confirmed"
        ? "confirmed"
        : status === "finalized"
          ? "finalized"
          : "error";

  return {
    status,
    signature: null,
    usedQuote,
    refreshed,
    lastValidBlockHeight,
    err:
      status === "error"
        ? {
            reason: "jito-bundle-failed",
            bundleStatus,
            bundleId,
          }
        : null,
    executionMeta: {
      route,
      classification,
      bundleId,
      tipAccount,
      trace: {
        txBuiltAt,
        sentAt,
        landedAt,
        ...(status === "confirmed" || status === "finalized"
          ? { confirmedAt: landedAt }
          : {}),
        ...(status === "finalized" ? { finalizedAt: landedAt } : {}),
        ...(status === "error" ? { failedAt: landedAt } : {}),
      },
    },
  };
}
