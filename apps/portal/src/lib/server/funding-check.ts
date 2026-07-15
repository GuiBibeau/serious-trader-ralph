// Server-side wallet funding check for Discord verification: USD value of
// the wallet's USDC + SOL, priced off the same tokens.xyz catalog the OG
// cards use. Honest-data rule: any failed read (RPC, price) returns null —
// "unknown" — never a zero that would read as "unfunded". Callers must
// treat null and { funded: false } differently.

import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { fundingDecision, parseFundedMinUsd } from "$lib/discord-verify";
// funding.ts is server-safe: it imports only $lib/utils (pure helpers, no
// browser modules, no @solana/web3.js).
import { fetchUsdcBalance } from "$lib/funding";
import { getCatalog } from "./tokensxyz";

const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;

export type FundingCheck = {
  funded: boolean;
  totalUsd: number;
  usdcUsd: number;
  solUsd: number;
};

/** Funding snapshot for a wallet, or null when any read failed (unknown). */
export async function checkFunding(
  wallet: string,
): Promise<FundingCheck | null> {
  const threshold = parseFundedMinUsd(privateEnv.DISCORD_FUNDED_MIN_USD);
  try {
    const url = rpcUrl();
    const [usdc, lamports, solPrice] = await Promise.all([
      fetchUsdcBalance(url, wallet),
      fetchLamports(url, wallet),
      fetchSolPriceUsd(),
    ]);
    // No SOL price means the SOL leg is unknowable — the whole check is
    // "unknown", not "SOL is worth $0".
    if (solPrice === null) return null;
    const solUsd = (lamports / LAMPORTS_PER_SOL) * solPrice;
    const decision = fundingDecision(usdc, solUsd, threshold);
    return { ...decision, usdcUsd: usdc, solUsd };
  } catch {
    return null;
  }
}

// Same env names the client's solanaRpcUrl() resolves, read through the
// server-side dynamic env (import.meta.env is a client/vite concept).
function rpcUrl(): string {
  const configured = cleanEnv(
    publicEnv.PUBLIC_SOLANA_RPC_URL ??
      privateEnv.VITE_SOLANA_RPC_URL ??
      privateEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
  );
  return configured || SOLANA_MAINNET_RPC;
}

async function fetchLamports(url: string, owner: string): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trader-ralph-discord-funding",
      method: "getBalance",
      // "confirmed" over "processed": this gates a role grant, so a
      // rolled-back slot briefly overstating the balance is not worth the
      // faster read the display paths use.
      params: [owner, { commitment: "confirmed" }],
    }),
  });
  if (!response.ok) throw new Error(`solana-rpc-http-${response.status}`);
  const payload = (await response.json()) as {
    result?: { value?: unknown };
    error?: unknown;
  };
  if (payload.error) throw new Error("solana-rpc-error");
  const value = payload.result?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("solana-balance-missing");
  }
  return Math.max(0, value);
}

// SOL priced from the tokens.xyz catalog — the same source the OG cards
// read (routes/og/terminal.png finds SOL the same way).
async function fetchSolPriceUsd(): Promise<number | null> {
  try {
    const assets = await getCatalog();
    const sol = assets.find(
      (asset) => asset.symbol.toUpperCase() === "SOL" && asset.price !== null,
    );
    return sol?.price ?? null;
  } catch {
    return null;
  }
}

function cleanEnv(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n$/, "");
}
