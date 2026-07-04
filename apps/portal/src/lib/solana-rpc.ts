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
