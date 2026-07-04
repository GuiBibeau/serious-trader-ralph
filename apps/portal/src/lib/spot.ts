// Spot venue: tokens.xyz asset catalog + Jupiter-routed spot trading.
//
// The tokens.xyz curated list provides the tradable universe (mint, decimals,
// live price/volume stats); Jupiter provides best-route quotes + swap
// transactions, signed by the Privy embedded wallet. The tokens.xyz key is
// injected server-side by the /tokensxyz proxy — never in the client bundle.

import { SOL_MINT, USDC_MINT } from "./funding";
import { isRecord } from "./utils";

const USDC_DECIMALS = 6;

export type SpotAsset = {
  assetId: string;
  symbol: string;
  /** crypto | equities | pre-ipo — same taxonomy as the marketing hubs. */
  hub: "crypto" | "equities" | "pre-ipo";
  name: string;
  imageUrl: string;
  mint: string;
  decimals: number;
  trustTier: string;
  price: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
};

export type SpotCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeQuote: number;
};

export type SpotQuote = {
  raw: unknown;
  inAtoms: number;
  outAtoms: number;
  outUi: number;
  priceImpactPct: number;
};

// ── Asset catalog ─────────────────────────────────────────────────────

let assetCache: { assets: SpotAsset[]; at: number } | null = null;
const ASSET_TTL_MS = 60_000;

export async function fetchSpotAssets(nowMs: number): Promise<SpotAsset[]> {
  if (assetCache && nowMs - assetCache.at < ASSET_TTL_MS)
    return assetCache.assets;
  try {
    const response = await fetch("/tokensxyz/v1/assets/curated");
    if (!response.ok) throw new Error(`tokensxyz-${response.status}`);
    const data = (await response.json()) as { assets?: unknown[] };
    const raw = Array.isArray(data.assets) ? data.assets.filter(isRecord) : [];
    const assets: SpotAsset[] = [];
    for (const item of raw) {
      const variant = isRecord(item.primaryVariant)
        ? item.primaryVariant
        : null;
      const stats = isRecord(item.stats) ? item.stats : {};
      const market = variant && isRecord(variant.market) ? variant.market : {};
      const mint = variant ? String(variant.mint ?? "") : "";
      const decimals = Number(market.decimals ?? NaN);
      if (!mint || !Number.isFinite(decimals)) continue;
      const category = String(item.category ?? "crypto");
      const rawName = String(item.name ?? "");
      const hub: SpotAsset["hub"] = /prestocks?/i.test(rawName)
        ? "pre-ipo"
        : category === "crypto" || category === "stablecoin"
          ? "crypto"
          : "equities";
      assets.push({
        assetId: String(item.assetId ?? ""),
        symbol: String(item.symbol ?? "?"),
        hub,
        name: rawName.replace(/\s+PreStocks?$/i, ""),
        imageUrl: String(item.imageUrl ?? ""),
        mint,
        decimals,
        trustTier: variant ? String(variant.trustTier ?? "") : "",
        price: finiteOrNull(stats.price),
        change24hPct: finiteOrNull(stats.priceChange24hPercent),
        volume24hUsd: finiteOrNull(stats.volume24hUSD),
        marketCap: finiteOrNull(stats.marketCap),
        liquidityUsd: finiteOrNull(stats.liquidity),
      });
    }
    assets.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
    assetCache = { assets, at: nowMs };
    return assets;
  } catch (error) {
    if (assetCache) return assetCache.assets;
    throw error;
  }
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── OHLCV chart data ─────────────────────────────────────────────────

// tokens.xyz serves 15m candles reliably; 1h/4h returned empty in testing,
// so every timeframe maps to the interval that actually has data.
export function spotIntervalFor(_timeframe: string): string {
  return "15m";
}

export async function fetchSpotCandles(
  assetId: string,
  timeframe: string,
  nowMs: number,
): Promise<SpotCandle[]> {
  const interval = spotIntervalFor(timeframe);
  const to = Math.floor(nowMs / 1000);
  const spanSeconds = 7 * 86_400;
  const params = new URLSearchParams({
    interval,
    from: String(to - spanSeconds),
    to: String(to),
  });
  const response = await fetch(
    `/tokensxyz/v1/assets/${encodeURIComponent(assetId)}/ohlcv?${params}`,
  );
  if (!response.ok) throw new Error(`tokensxyz-ohlcv-${response.status}`);
  const data = (await response.json()) as { candles?: unknown[] };
  const candles = Array.isArray(data.candles)
    ? data.candles.filter(isRecord)
    : [];
  return candles
    .map((candle) => ({
      ts: Number(candle.time) * 1000,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volumeQuote: Number(candle.volume ?? 0),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.ts) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.close) &&
        candle.close > 0,
    )
    .sort((a, b) => a.ts - b.ts);
}

// ── Jupiter spot execution (any token ↔ USDC) ────────────────────────

export async function getSpotQuote(
  inputMint: string,
  outputMint: string,
  inAtoms: number,
  outDecimals: number,
  slippageBps = 50,
): Promise<SpotQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(Math.round(inAtoms)),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
  });
  const response = await fetch(`/jupiter/swap/v1/quote?${params}`);
  if (!response.ok) throw new Error(`jupiter-quote-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const outAtoms = Number(data.outAmount);
  const priceImpactPct = Number(data.priceImpactPct ?? 0);
  // A malformed quote must fail loudly — never degrade to an executable zero.
  if (
    !Number.isFinite(outAtoms) ||
    outAtoms <= 0 ||
    !Number.isFinite(priceImpactPct)
  ) {
    throw new Error("jupiter-quote-invalid");
  }
  return {
    raw: data,
    inAtoms,
    outAtoms,
    outUi: outAtoms / 10 ** outDecimals,
    priceImpactPct,
  };
}

export async function getSpotSwapTransaction(
  quoteResponse: unknown,
  userPublicKey: string,
): Promise<string> {
  const response = await fetch("/jupiter/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!response.ok) throw new Error(`jupiter-swap-${response.status}`);
  const data = (await response.json()) as { swapTransaction?: string };
  if (!data.swapTransaction) throw new Error("jupiter-no-transaction");
  return data.swapTransaction;
}

export function usdcToAtoms(amountUsd: number): number {
  return Math.round(amountUsd * 10 ** USDC_DECIMALS);
}

export function tokenToAtoms(amount: number, decimals: number): number {
  return Math.round(amount * 10 ** decimals);
}

// ── Spot limit orders (Jupiter Trigger API) ──────────────────────────
// Onchain resting orders: createOrder/cancelOrder return unsigned
// transactions to sign and send. Same /jupiter proxy path as swaps.

export type TriggerOrder = {
  /** Order account pubkey — the cancel handle. */
  orderKey: string;
  inputMint: string;
  outputMint: string;
  makingAmountAtoms: number;
  takingAmountAtoms: number;
  createdAt: number | null;
};

export async function createTriggerOrder(params: {
  maker: string;
  inputMint: string;
  outputMint: string;
  makingAmountAtoms: number;
  takingAmountAtoms: number;
}): Promise<{ transaction: string; orderKey: string }> {
  const response = await fetch("/jupiter/trigger/v1/createOrder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      maker: params.maker,
      payer: params.maker,
      params: {
        makingAmount: String(params.makingAmountAtoms),
        takingAmount: String(params.takingAmountAtoms),
      },
      computeUnitPrice: "auto",
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    transaction?: string;
    order?: string;
    error?: unknown;
  } | null;
  if (!response.ok || !data?.transaction || !data.order) {
    throw new Error(`trigger-create-${response.status}`);
  }
  return { transaction: data.transaction, orderKey: data.order };
}

export async function fetchTriggerOrders(
  user: string,
): Promise<TriggerOrder[]> {
  const response = await fetch(
    `/jupiter/trigger/v1/getTriggerOrders?user=${encodeURIComponent(user)}&orderStatus=active`,
  );
  if (!response.ok) throw new Error(`trigger-list-${response.status}`);
  const data = (await response.json().catch(() => null)) as {
    orders?: unknown[];
  } | null;
  const orders: TriggerOrder[] = [];
  for (const item of (data?.orders ?? []).filter(isRecord)) {
    const orderKey = String(item.orderKey ?? item.order ?? "");
    const inputMint = String(item.inputMint ?? "");
    const outputMint = String(item.outputMint ?? "");
    // API returns UI amounts in makingAmount and atoms in rawMakingAmount.
    const making = Number(item.rawMakingAmount ?? item.makingAmount ?? NaN);
    const taking = Number(item.rawTakingAmount ?? item.takingAmount ?? NaN);
    if (!orderKey || !inputMint || !outputMint) continue;
    const createdAtRaw = item.createdAt;
    orders.push({
      orderKey,
      inputMint,
      outputMint,
      makingAmountAtoms: Number.isFinite(making) ? making : 0,
      takingAmountAtoms: Number.isFinite(taking) ? taking : 0,
      createdAt:
        typeof createdAtRaw === "string"
          ? Date.parse(createdAtRaw) || null
          : null,
    });
  }
  return orders;
}

export async function cancelTriggerOrder(
  maker: string,
  orderKey: string,
): Promise<string> {
  const response = await fetch("/jupiter/trigger/v1/cancelOrder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maker, order: orderKey, computeUnitPrice: "auto" }),
  });
  const data = (await response.json().catch(() => null)) as {
    transaction?: string;
  } | null;
  if (!response.ok || !data?.transaction) {
    throw new Error(`trigger-cancel-${response.status}`);
  }
  return data.transaction;
}

// ── Wallet token balances (legacy SPL Token + Token-2022) ────────────

const TOKEN_PROGRAM_IDS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
];

export async function fetchAllTokenBalances(
  rpcUrl: string,
  owner: string,
): Promise<Record<string, number>> {
  const responses = await Promise.all(
    TOKEN_PROGRAM_IDS.map((programId, index) =>
      fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `trader-ralph-token-balances-${index}`,
          method: "getTokenAccountsByOwner",
          params: [owner, { programId }, { encoding: "jsonParsed" }],
        }),
      }).then((response) =>
        response.ok ? response.json().catch(() => null) : null,
      ),
    ),
  );
  const balances: Record<string, number> = {};
  for (const payload of responses) {
    const result =
      isRecord(payload) && isRecord(payload.result) ? payload.result : null;
    const accounts = result && Array.isArray(result.value) ? result.value : [];
    for (const account of accounts) {
      if (!isRecord(account) || !isRecord(account.account)) continue;
      const data = account.account.data;
      if (!isRecord(data) || !isRecord(data.parsed)) continue;
      const info = data.parsed.info;
      if (!isRecord(info) || !isRecord(info.tokenAmount)) continue;
      const mint = String(info.mint ?? "");
      const ui = Number(info.tokenAmount.uiAmount ?? NaN);
      if (mint && Number.isFinite(ui) && ui > 0) {
        balances[mint] = (balances[mint] ?? 0) + ui;
      }
    }
  }
  return balances;
}

/**
 * Human view of a resting trigger (limit) order: side/symbol from the mint
 * orientation (USDC in = buy), notional from the USDC atoms, implied limit
 * price from the atoms ratio. Null when the token isn't in the catalog.
 */
export function triggerOrderView(
  order: TriggerOrder,
  assets: SpotAsset[],
): {
  side: "buy" | "sell";
  symbol: string;
  notionalUsd: number | null;
  limitPrice: number | null;
} | null {
  const isBuy = order.inputMint === USDC_MINT;
  const tokenMint = isBuy ? order.outputMint : order.inputMint;
  const asset = assets.find((candidate) => candidate.mint === tokenMint);
  if (!asset) return null;
  const usdAtoms = isBuy ? order.makingAmountAtoms : order.takingAmountAtoms;
  const tokenAtoms = isBuy ? order.takingAmountAtoms : order.makingAmountAtoms;
  const usd = usdAtoms / 1e6;
  const qty = tokenAtoms / 10 ** asset.decimals;
  return {
    side: isBuy ? "buy" : "sell",
    symbol: asset.symbol,
    notionalUsd: Number.isFinite(usd) && usd > 0 ? usd : null,
    limitPrice: qty > 0 && usd > 0 ? usd / qty : null,
  };
}

export { SOL_MINT, USDC_MINT };
