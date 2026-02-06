import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { getPublicKey } from "@noble/ed25519";
import { base58, base64 } from "@scure/base";

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

type ImportInitResponse = {
  encryption_public_key?: string;
  encryption_type?: string;
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

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

async function encryptWithHpke(input: {
  encryptionPublicKey: Uint8Array;
  plaintextPrivateKey: Uint8Array;
}): Promise<{ encapsulatedKey: Uint8Array; ciphertext: Uint8Array }> {
  const suite = new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Chacha20Poly1305(),
  });

  const recipientPublicKey = await suite.kem.deserializePublicKey(
    toArrayBuffer(input.encryptionPublicKey),
  );
  const sender = await suite.createSenderContext({ recipientPublicKey });
  const ciphertext = await sender.seal(
    toArrayBuffer(input.plaintextPrivateKey),
  );
  return {
    encapsulatedKey: new Uint8Array(sender.enc),
    ciphertext: new Uint8Array(ciphertext),
  };
}

async function deriveSolanaAddressFromBase58SecretKey(
  base58SecretKey: string,
): Promise<{ address: string; secretKeyBytes: Uint8Array }> {
  const secretKeyBytes = base58.decode(base58SecretKey);
  let publicKeyBytes: Uint8Array;

  // Common formats:
  // - 64 bytes: Solana "secret key" (seed + public key).
  // - 32 bytes: raw ed25519 seed.
  if (secretKeyBytes.length === 64) {
    publicKeyBytes = secretKeyBytes.slice(32);
  } else if (secretKeyBytes.length === 32) {
    publicKeyBytes = await getPublicKey(secretKeyBytes);
  } else {
    throw new Error("invalid-solana-private-key");
  }

  return {
    address: base58.encode(publicKeyBytes),
    secretKeyBytes,
  };
}

export async function createPrivySolanaWallet(
  env: Env,
): Promise<{ walletId: string; address: string }> {
  const { baseUrl, headers } = privyHeaders(env);
  const response = await fetch(`${baseUrl}/wallets`, {
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

export async function importPrivySolanaWalletFromPrivateKey(
  env: Env,
  base58PrivateKey: string,
): Promise<{ walletId: string; address: string }> {
  const trimmed = base58PrivateKey.trim();
  if (!trimmed) throw new Error("missing-private-key");

  const { address, secretKeyBytes } =
    await deriveSolanaAddressFromBase58SecretKey(trimmed);
  const { baseUrl, headers } = privyHeaders(env);

  const initResponse = await fetch(`${baseUrl}/wallets/import/init`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      address,
      chain_type: "solana",
      entropy_type: "private-key",
      encryption_type: "HPKE",
    }),
  });
  if (!initResponse.ok) {
    const text = await initResponse.text().catch(() => "");
    throw new Error(
      `privy-wallet-import-init-failed: ${initResponse.status} ${text}`,
    );
  }
  const initPayload = (await initResponse.json()) as unknown;
  if (!initPayload || typeof initPayload !== "object") {
    throw new Error("privy-wallet-import-init-invalid-response");
  }
  const parsedInit = initPayload as ImportInitResponse;
  const encryptionPublicKeyB64 = parsedInit.encryption_public_key;
  if (typeof encryptionPublicKeyB64 !== "string" || !encryptionPublicKeyB64) {
    throw new Error("privy-wallet-import-init-missing-key");
  }

  const { encapsulatedKey, ciphertext } = await encryptWithHpke({
    encryptionPublicKey: base64.decode(encryptionPublicKeyB64),
    plaintextPrivateKey: secretKeyBytes,
  });

  const submitResponse = await fetch(`${baseUrl}/wallets/import/submit`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      wallet: {
        address,
        chain_type: "solana",
        entropy_type: "private-key",
        encryption_type: "HPKE",
        ciphertext: base64.encode(ciphertext),
        encapsulated_key: base64.encode(encapsulatedKey),
      },
    }),
  });
  if (!submitResponse.ok) {
    const text = await submitResponse.text().catch(() => "");
    throw new Error(
      `privy-wallet-import-submit-failed: ${submitResponse.status} ${text}`,
    );
  }
  const submitPayload = (await submitResponse.json()) as unknown;
  if (!submitPayload || typeof submitPayload !== "object") {
    throw new Error("privy-wallet-import-submit-invalid-response");
  }
  const wallet = submitPayload as PrivyWalletResponse;
  if (typeof wallet.id !== "string" || !wallet.id.trim()) {
    throw new Error("privy-wallet-import-missing-id");
  }
  if (typeof wallet.address !== "string" || !wallet.address.trim()) {
    throw new Error("privy-wallet-import-missing-address");
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
  const response = await fetch(url, { method: "GET", headers });
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
  const response = await fetch(url, {
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

export async function signTransactionWithPrivy(
  env: Env,
  base64WireTransaction: string,
): Promise<string> {
  return await signTransactionWithPrivyById(
    env,
    requirePrivyWalletId(env),
    base64WireTransaction,
  );
}
