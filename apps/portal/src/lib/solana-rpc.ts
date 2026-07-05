// Solana RPC URL resolution + the lightweight balance fetch used by wallet
// displays. Deliberately free of @solana/web3.js so importing this module
// never pulls the heavy SDK into a bundle — raw JSON-RPC over fetch is all
// the balance path needs.

import { isRecord } from "$lib/utils";

export const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export function solanaRpcUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const configured = String(
    env.PUBLIC_SOLANA_RPC_URL ??
      env.VITE_SOLANA_RPC_URL ??
      env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "",
  )
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n$/, "");
  return configured || SOLANA_MAINNET_RPC;
}

/**
 * Pure core of the balance fetch: validate a getBalance JSON-RPC payload
 * into a lamports string. Split from the fetch so every branch is testable.
 * `ok`/`status` mirror the HTTP response the payload arrived with.
 */
export function parseLamportsResponse(
  payload: unknown,
  ok: boolean,
  status: number,
): string {
  if (!ok) throw new Error(`solana-rpc-http-${status}`);
  if (!isRecord(payload)) throw new Error("solana-rpc-invalid-response");
  if (isRecord(payload.error)) {
    throw new Error(String(payload.error.message ?? "solana-rpc-error"));
  }
  const result = isRecord(payload.result) ? payload.result : null;
  const value = result?.value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value)).toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new Error("solana-balance-missing");
}

export async function fetchSolanaLamports(address: string): Promise<string> {
  const response = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trader-ralph-wallet-balance",
      method: "getBalance",
      // "processed" over the default "finalized": received SOL shows in
      // about a slot instead of ~12s. Display-only, so the tiny rollback
      // window is acceptable.
      params: [address, { commitment: "processed" }],
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseLamportsResponse(payload, response.ok, response.status);
}

// ── SPL mint safety (meme-coin rails) ────────────────────────────────
// Decodes the two authority slots of an SPL mint account straight from a
// raw getAccountInfo — no web3.js. A revoked mint authority means supply
// is fixed; a revoked freeze authority means holders can't be frozen.
// Token-2022 shares the same base layout (extensions live past byte 82).

export type MintSafety = {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  decimals: number;
};

/** Pure decoder for a base64 SPL mint account — testable with fixtures. */
export function parseMintAccount(base64Data: string): MintSafety {
  const raw = atob(base64Data);
  if (raw.length < 82) throw new Error("mint-account-too-short");
  const u32 = (offset: number) =>
    raw.charCodeAt(offset) |
    (raw.charCodeAt(offset + 1) << 8) |
    (raw.charCodeAt(offset + 2) << 16) |
    (raw.charCodeAt(offset + 3) << 24);
  return {
    mintAuthorityRevoked: u32(0) === 0,
    decimals: raw.charCodeAt(44),
    freezeAuthorityRevoked: u32(46) === 0,
  };
}

export async function fetchMintSafety(mint: string): Promise<MintSafety> {
  const response = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trader-ralph-mint-safety",
      method: "getAccountInfo",
      params: [mint, { encoding: "base64" }],
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(`solana-rpc-http-${response.status}`);
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error("solana-rpc-invalid-response");
  }
  const value = payload.result.value;
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("mint-account-missing");
  }
  return parseMintAccount(String(value.data[0]));
}
