// Server-side wallet funding check for Discord verification: USD value of
// the wallet's USDC + SOL (priced off the same tokens.xyz catalog the OG
// cards use) plus Phoenix margin collateral. Honest-data rule: any failed
// read (RPC, price, decode) returns null — "unknown" — never a zero that
// would read as "unfunded". Callers must treat null and { funded: false }
// differently.

// Plain-JS SDK helpers (no @solana/web3.js) — server-safe.
import { decodeTrader, getTraderAddresses } from "@ellipsis-labs/rise";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { fundingDecision, parseFundedMinUsd } from "$lib/discord-verify";
import { USDC_MINT } from "$lib/funding";
import { getCatalog } from "./tokensxyz";

const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 6;
const PHOENIX_API = "https://perp-api.phoenix.trade";

export type FundingCheck = {
  funded: boolean;
  totalUsd: number;
  usdcUsd: number;
  solUsd: number;
  /** Phoenix margin collateral; null = the read was indeterminate (the
   * wallet still cleared the threshold on wallet assets alone). */
  phoenixUsd: number | null;
};

/** Funding snapshot for a wallet, or null when any read failed (unknown). */
export async function checkFunding(
  wallet: string,
): Promise<FundingCheck | null> {
  const threshold = parseFundedMinUsd(privateEnv.DISCORD_FUNDED_MIN_USD);
  try {
    const url = rpcUrl();
    const [usdc, lamports, solPrice, phoenixUsd] = await Promise.all([
      fetchUsdcUsd(url, wallet),
      fetchLamports(url, wallet),
      fetchSolPriceUsd(),
      fetchPhoenixCollateralUsd(url, wallet),
    ]);
    // A failed USDC read is "unknown", never "$0 of USDC" — a zero here
    // would flow straight into a not-funded refusal.
    if (usdc === null) return null;
    // No SOL price means the SOL leg is unknowable — the whole check is
    // "unknown", not "SOL is worth $0".
    if (solPrice === null) return null;
    const solUsd = (lamports / LAMPORTS_PER_SOL) * solPrice;
    // Asymmetric on purpose: a wallet that clears the threshold on
    // USDC + SOL alone is funded even when the Phoenix read is
    // indeterminate — the old wallet-only check would have passed it, and
    // a flaky Phoenix leg must never refuse (or error) someone it can only
    // help. Only when the wallet alone is below the bar does an unknown
    // Phoenix read make the whole check unknown.
    if (phoenixUsd === null) {
      const walletOnly = fundingDecision(usdc, solUsd, 0, threshold);
      if (!walletOnly.funded) return null;
      return { ...walletOnly, usdcUsd: usdc, solUsd, phoenixUsd: null };
    }
    const decision = fundingDecision(usdc, solUsd, phoenixUsd, threshold);
    return { ...decision, usdcUsd: usdc, solUsd, phoenixUsd };
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
      id: "harness-discord-funding",
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

// Gate-specific USDC read. The display helper ($lib/funding fetchUsdcBalance)
// deliberately shrugs at soft failures — an HTTP 200 carrying a JSON-RPC
// `error` envelope falls through to an empty account list and returns 0,
// which is fine for a balance widget (worst case it briefly shows $0) but
// poison for a refusal gate: that 0 would flow into fundingDecision and
// refuse a funded user as "not-funded" instead of the honest
// "unknown → error". So this gate inspects the JSON-RPC envelope itself and
// returns:
//   number — total USDC (0 ONLY when the response legitimately lists no
//            token accounts, or lists accounts holding nothing);
//   null   — unknown (HTTP failure, JSON-RPC `error`, malformed shape).
async function fetchUsdcUsd(
  url: string,
  owner: string,
): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "harness-discord-usdc",
        method: "getTokenAccountsByOwner",
        // "confirmed" for the same reason as fetchLamports above.
        params: [
          owner,
          { mint: USDC_MINT },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: { value?: unknown };
      error?: unknown;
    };
    if (payload.error) return null;
    const value = payload.result?.value;
    if (!Array.isArray(value)) return null;
    let total = 0;
    for (const account of value) {
      const ui = (
        account as {
          account?: {
            data?: {
              parsed?: { info?: { tokenAmount?: { uiAmount?: unknown } } };
            };
          };
        }
      )?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      // An account we cannot read is an unknown balance, not a $0 one —
      // the display helper skips these; the gate must not undercount.
      if (typeof ui !== "number" || !Number.isFinite(ui)) return null;
      total += ui;
    }
    return total;
  } catch {
    return null;
  }
}

// Phoenix margin collateral, chain-first: the chain is truth, the Phoenix
// API indexer is a lagging hint — so collateral comes from the trader PDA
// via RPC, never the REST trader endpoint. This mirrors the client's
// fetchOnChainCollateralUsd (lib/phoenix-trade.ts) with the same SDK
// helpers; only the exchange config (the canonical mint that keys the PDA)
// comes from the Phoenix REST API. Returns:
//   number — collateral in USD (0 when the wallet never registered);
//   null   — indeterminate (config/RPC/decode failure), never coerced to 0.
async function fetchPhoenixCollateralUsd(
  url: string,
  wallet: string,
): Promise<number | null> {
  try {
    const mint = await fetchPhoenixCanonicalMint();
    const addresses = await getTraderAddresses(
      wallet as never,
      mint as never,
      0,
      0,
    );
    const data = await fetchAccountData(url, String(addresses.traderAccount));
    // Account not found = the wallet never registered with Phoenix, which
    // is honestly $0 of collateral there — NOT an unknown.
    if (data === null) return 0;
    const trader = decodeTrader(data);
    // Quote lots are USDC atoms (QUOTE_LOTS_DECIMALS = 6 in the SDK).
    const usd = Number(trader.state.quoteLotCollateral) / 10 ** USDC_DECIMALS;
    return Number.isFinite(usd) && usd >= 0 && usd < 1e9 ? usd : null;
  } catch {
    // RPC error, config fetch failure, or decode throw — unknown, never 0.
    return null;
  }
}

// Same fetch-and-cache pattern as the client's fetchExchangeConfig, trimmed
// to the one key this check needs.
let phoenixCanonicalMintCache: string | null = null;

async function fetchPhoenixCanonicalMint(): Promise<string> {
  if (phoenixCanonicalMintCache) return phoenixCanonicalMintCache;
  const response = await fetch(`${PHOENIX_API}/exchange`);
  if (!response.ok) throw new Error(`phoenix-exchange-${response.status}`);
  const data = (await response.json()) as {
    keys?: { canonicalMint?: unknown };
  };
  const mint = data.keys?.canonicalMint;
  if (typeof mint !== "string" || mint.length === 0) {
    throw new Error("phoenix-exchange-mint-missing");
  }
  phoenixCanonicalMintCache = mint;
  return mint;
}

/** getAccountInfo (base64). Missing account → null; malformed reply throws. */
async function fetchAccountData(
  url: string,
  address: string,
): Promise<Uint8Array | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "harness-discord-phoenix",
      method: "getAccountInfo",
      // "confirmed" for the same reason as fetchLamports above.
      params: [address, { commitment: "confirmed", encoding: "base64" }],
    }),
  });
  if (!response.ok) throw new Error(`solana-rpc-http-${response.status}`);
  const payload = (await response.json()) as {
    result?: { value?: { data?: unknown } | null };
    error?: unknown;
  };
  if (payload.error) throw new Error("solana-rpc-error");
  if (!payload.result || !("value" in payload.result)) {
    throw new Error("solana-account-info-missing");
  }
  if (payload.result.value === null) return null;
  const data = payload.result.value?.data;
  const base64 = Array.isArray(data) ? data[0] : data;
  if (typeof base64 !== "string") throw new Error("solana-account-data-shape");
  return Uint8Array.from(Buffer.from(base64, "base64"));
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
