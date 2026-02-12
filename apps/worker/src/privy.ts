import type { Env } from "./types";

type PrivyWalletResponse = {
  id?: string;
  address?: string;
  [k: string]: unknown;
};

type SignTransactionResponse = {
  data?: {
    signed_transaction?: string;
  };
  [k: string]: unknown;
};

const walletAddressCache = new Map<string, string>();

function base64EncodeUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function requirePrivyApp(env: Env): {
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
} {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("privy-config-missing");
  }
  const apiBaseUrl = "https://api.privy.io/v1";
  return { appId, appSecret, apiBaseUrl };
}

function privyHeaders(env: Env): {
  baseUrl: string;
  headers: Record<string, string>;
} {
  const { appId, appSecret, apiBaseUrl } = requirePrivyApp(env);
  const auth = base64EncodeUtf8(`${appId}:${appSecret}`);
  return {
    baseUrl: apiBaseUrl,
    headers: {
      Authorization: `Basic ${auth}`,
      "privy-app-id": appId,
    },
  };
}

function requirePrivyWalletId(env: Env): string {
  const walletId = env.PRIVY_WALLET_ID;
  if (!walletId) throw new Error("privy-wallet-not-configured");
  return walletId;
}

const PRIVY_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const RETRY_DELAY_MS = 500;

async function privyFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRIVY_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `privy-timeout: ${PRIVY_TIMEOUT_MS}ms exceeded for ${url}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function privyFetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const first = await privyFetch(url, init);
  if (first.ok || !RETRYABLE_STATUS_CODES.has(first.status)) {
    return first;
  }
  // Consume body to free resources before retrying.
  await first.text().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return privyFetch(url, init);
}

export async function createPrivySolanaWallet(
  env: Env,
): Promise<{ walletId: string; address: string }> {
  const { baseUrl, headers } = privyHeaders(env);
  const response = await privyFetch(`${baseUrl}/wallets`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ chain_type: "solana" }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`privy-wallet-create-failed: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("privy-wallet-create-invalid-response");
  }
  const wallet = payload as PrivyWalletResponse;
  if (typeof wallet.id !== "string" || !wallet.id.trim()) {
    throw new Error("privy-wallet-create-missing-id");
  }
  if (typeof wallet.address !== "string" || !wallet.address.trim()) {
    throw new Error("privy-wallet-create-missing-address");
  }
  walletAddressCache.set(wallet.id, wallet.address);
  return { walletId: wallet.id, address: wallet.address };
}

export async function getPrivyWalletAddressById(
  env: Env,
  walletId: string,
): Promise<string> {
  const cached = walletAddressCache.get(walletId);
  if (cached) return cached;

  const { baseUrl, headers } = privyHeaders(env);
  const url = `${baseUrl}/wallets/${walletId}`;
  const response = await privyFetch(url, { method: "GET", headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`privy-wallet-fetch-failed: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("privy-wallet-invalid-response");
  }
  const wallet = payload as PrivyWalletResponse;
  if (typeof wallet.address !== "string" || !wallet.address.trim()) {
    throw new Error("privy-wallet-missing-address");
  }
  walletAddressCache.set(walletId, wallet.address);
  return wallet.address;
}

export async function getPrivyWalletAddress(env: Env): Promise<string> {
  return await getPrivyWalletAddressById(env, requirePrivyWalletId(env));
}

export async function signTransactionWithPrivyById(
  env: Env,
  walletId: string,
  base64WireTransaction: string,
): Promise<string> {
  const { baseUrl, headers } = privyHeaders(env);

  const url = `${baseUrl}/wallets/${walletId}/rpc`;
  const response = await privyFetchWithRetry(url, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      method: "signTransaction",
      params: {
        encoding: "base64",
        transaction: base64WireTransaction,
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`privy-sign-failed: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new Error("privy-sign-invalid-response");
  }
  const parsed = payload as SignTransactionResponse;
  const signed = parsed.data?.signed_transaction;
  if (typeof signed !== "string" || !signed) {
    throw new Error("privy-sign-missing-signed-transaction");
  }
  return signed;
}
