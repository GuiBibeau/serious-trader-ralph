// Phoenix Perps venue integration.
//
// Execution model: the Phoenix API builds order instructions server-side
// (/v1/ix/*) in plain web3.js JSON ({programId, keys, data}); deposits,
// withdrawals, cancels and trader registration are built locally with
// @ellipsis-labs/rise. We assemble a v0 transaction and the caller signs it
// with the Privy embedded wallet. No keys or auth tokens are involved —
// every action is authorized purely by the wallet signature.

import {
  buildCancelOrdersByIdIx,
  buildCancelStopLossIx,
  buildCancelUpToIx,
  buildDepositIxsResolved,
  buildRegisterTraderIx,
  buildTransferCollateralIx,
  buildWithdrawIxsResolved,
  createPhoenixClient,
  decodeTrader,
  getEmberStateAddress,
  getEmberVaultAddress,
  getPhoenixStopLossAddress,
  getTraderAddresses,
  MarginType,
  Direction as RiseDirection,
  Side as RiseSide,
  resolvePhoenixInstructionAddresses,
  TP_SL_MAX_SLIPPAGE_BPS,
  toMaxPositions,
} from "@ellipsis-labs/rise";
import {
  type BlockhashWithExpiryBlockHeight,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer as BrowserBuffer } from "buffer/";
import { USDC_MINT } from "./funding";
import { tpSlExecutionPrice } from "./terminal/trade-math";
import { isRecord } from "./utils";

const PHOENIX_API = "https://perp-api.phoenix.trade";
const USDC_DECIMALS = 6;

// Trader Ralph's Phoenix referral code — new signups are attributed to it
// (20% fee share accrues to the referrer per Phoenix's rewards program).
export const PHOENIX_REFERRAL_CODE = "NW4598VT";

// ── Types ─────────────────────────────────────────────────────────────

export type PhoenixSide = "bid" | "ask";

export type PhoenixPosition = {
  symbol: string;
  /** Signed base size in UI units (negative = short). */
  size: number;
  entryPrice: number | null;
  liquidationPrice: number | null;
  unrealizedPnl: number | null;
  positionValue: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  /** Which subaccount holds it (needed to close). */
  traderPdaIndex: number;
  subaccountIndex: number;
  /** Collateral of the isolated subaccount holding it — drives liq est. */
  marginUsd: number | null;
};

export type PhoenixOpenOrder = {
  symbol: string;
  side: PhoenixSide;
  price: number | null;
  remaining: number | null;
  orderSequenceNumber: string;
  isStopLoss: boolean;
  /** Trigger direction bit for stop-loss rows (set = fires when price rises
   * above the trigger, per the SDK's StopLosses decoder) — picks which
   * StopLosses slot a single-order cancel targets. */
  isStopLossDirection: boolean;
};

export type PhoenixTraderState = {
  registered: boolean;
  /** True when collateralUsd came from a this-session trader-PDA read —
   * the only source allowed to trigger the "Deposit first" gate. */
  chainVerified?: boolean;
  /** Indexer snapshot slot — compared against the chain tip for sync lag. */
  apiSlot: number | null;
  /** Free cross collateral in the parent subaccount — gates new orders. */
  collateralUsd: number | null;
  /** Parent + every isolated subaccount's margin — "money in Phoenix". */
  totalCollateralUsd: number | null;
  effectiveCollateralUsd: number | null;
  unrealizedPnlUsd: number | null;
  riskTier: string | null;
  positions: PhoenixPosition[];
  orders: PhoenixOpenOrder[];
};

export type PlacedOrderPlan = {
  instructions: TransactionInstruction[];
  estimatedLiquidationPriceUsd: number | null;
};

type ExchangeKeys = {
  canonicalMint: string;
  globalVault: string;
  perpAssetMap: string;
  globalTraderIndex: string[];
  activeTraderBuffer: string[];
  withdrawQueue: string;
};

type ExchangeMarket = {
  symbol: string;
  marketPubkey: string;
  splinePubkey: string;
  /** Numeric asset id — keys per-asset PDAs like the StopLosses account. */
  assetId: number;
  /** Quote lots per base lot per tick — converts UI prices back to ticks. */
  tickSize: number;
  /** Base lots are 10^-decimals base units (COPPER: 1 → lot = 0.1). */
  baseLotsDecimals: number;
};

type ExchangeConfig = { keys: ExchangeKeys; markets: ExchangeMarket[] };

// ── Exchange config (cached) ─────────────────────────────────────────

let exchangeCache: ExchangeConfig | null = null;

export async function fetchExchangeConfig(): Promise<ExchangeConfig> {
  if (exchangeCache) return exchangeCache;
  const response = await fetch(`${PHOENIX_API}/exchange`);
  if (!response.ok) throw new Error(`phoenix-exchange-${response.status}`);
  const data = (await response.json()) as {
    keys: ExchangeKeys;
    markets: (ExchangeMarket & Record<string, unknown>)[];
  };
  exchangeCache = {
    keys: data.keys,
    markets: data.markets.map((market) => ({
      symbol: market.symbol,
      marketPubkey: market.marketPubkey,
      splinePubkey: market.splinePubkey,
      assetId: Number(market.assetId ?? 0),
      tickSize: Number(market.tickSize ?? 0),
      baseLotsDecimals: Number(market.baseLotsDecimals ?? 0),
    })),
  };
  return exchangeCache;
}

// ── Trader state ──────────────────────────────────────────────────────

function tokenAmount(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const ui = Number(value.ui ?? NaN);
  if (Number.isFinite(ui)) return ui;
  const raw = Number(value.value ?? NaN);
  const decimals = Number(value.decimals ?? NaN);
  if (Number.isFinite(raw) && Number.isFinite(decimals)) {
    return raw / 10 ** decimals;
  }
  return null;
}

function lotsToUsd(value: unknown): number | null {
  const lots = Number(value);
  return Number.isFinite(lots) ? lots / 10 ** USDC_DECIMALS : null;
}

// Trigger entries: probe the plausible price keys defensively — the trader
// endpoint's field names have shifted before (see schema note below).
function triggerPriceUsd(list: unknown): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const first: unknown = list[0];
  if (!isRecord(first)) return null;
  for (const key of ["triggerPriceUsd", "priceUsd", "price"]) {
    const value = Number(first[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export async function fetchPhoenixTraderState(
  authority: string,
): Promise<PhoenixTraderState> {
  const empty: PhoenixTraderState = {
    registered: false,
    apiSlot: null,
    collateralUsd: null,
    totalCollateralUsd: null,
    effectiveCollateralUsd: null,
    unrealizedPnlUsd: null,
    riskTier: null,
    positions: [],
    orders: [],
  };
  const response = await fetch(
    `${PHOENIX_API}/v1/trader/state/${encodeURIComponent(authority)}`,
  );
  if (response.status === 404) return empty;
  if (!response.ok) throw new Error(`phoenix-trader-${response.status}`);
  // Live schema (2026-07-03): { traderPdaIndex, snapshot: { subaccounts:
  // [{ subaccountIndex, collateral: "<quote lots>", positions?: [{ symbol,
  // basePositionLots, entryPriceUsd, virtualQuotePositionLots,
  // takeProfitTriggers, stopLossTriggers }] }] } }. The previous
  // { traders: [...] } shape is gone — parsing it silently reported every
  // wallet as unregistered with no positions.
  const data = (await response.json()) as Record<string, unknown>;
  const snapshot = isRecord(data.snapshot) ? data.snapshot : null;
  if (!snapshot) return empty;
  const subaccounts = Array.isArray(snapshot.subaccounts)
    ? snapshot.subaccounts.filter(isRecord)
    : [];
  const pdaIndex = Number(data.traderPdaIndex ?? 0);
  const markets =
    (await fetchExchangeConfig().catch(() => null))?.markets ?? [];
  const lotDecimalsFor = (symbol: string): number =>
    markets.find((market) => market.symbol === symbol)?.baseLotsDecimals ?? 0;

  const state: PhoenixTraderState = { ...empty, registered: true };
  state.apiSlot = Number.isFinite(Number(data.slot)) ? Number(data.slot) : null;
  let totalUsd = 0;
  for (const sub of subaccounts) {
    const subIndex = Number(sub.subaccountIndex ?? 0);
    const collateral = lotsToUsd(sub.collateral);
    if (collateral !== null) totalUsd += collateral;
    // Parent (0/0) holds the free cross collateral that gates new orders.
    if (pdaIndex === 0 && subIndex === 0) state.collateralUsd = collateral;
    const positions = Array.isArray(sub.positions)
      ? sub.positions.filter(isRecord)
      : [];
    for (const position of positions) {
      const symbol = String(position.symbol ?? "?");
      const baseLots = Number(position.basePositionLots ?? 0);
      if (!Number.isFinite(baseLots) || baseLots === 0) continue;
      const entryPrice = Number(position.entryPriceUsd);
      const quoteLots = Number(position.virtualQuotePositionLots);
      state.positions.push({
        symbol,
        size: baseLots / 10 ** lotDecimalsFor(symbol),
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
        // Not in this schema — panel renders "--" and the chart skips the
        // LIQ line rather than drawing a wrong one.
        liquidationPrice: null,
        unrealizedPnl: null,
        positionValue: Number.isFinite(quoteLots)
          ? Math.abs(quoteLots) / 10 ** USDC_DECIMALS
          : null,
        takeProfitPrice: triggerPriceUsd(position.takeProfitTriggers),
        stopLossPrice: triggerPriceUsd(position.stopLossTriggers),
        traderPdaIndex: pdaIndex,
        subaccountIndex: subIndex,
        marginUsd: collateral,
      });
    }
  }
  state.totalCollateralUsd = totalUsd;

  // The raw REST snapshot no longer carries open orders, but the SDK
  // client's TraderView still does — merge orders (plus risk tier and any
  // trigger prices the raw schema omitted) from it, fail-soft.
  try {
    const client = createPhoenixClient();
    let view: unknown;
    try {
      view = await client.api.traders().getTrader(authority);
    } finally {
      client.dispose();
    }
    if (isRecord(view)) {
      if (typeof view.riskTier === "string") state.riskTier = view.riskTier;
      const orderMap = isRecord(view.limitOrders) ? view.limitOrders : {};
      for (const [symbol, list] of Object.entries(orderMap)) {
        if (!Array.isArray(list)) continue;
        for (const order of list.filter(isRecord)) {
          state.orders.push({
            symbol,
            side:
              Number(order.side) === 1 || order.side === "ask" ? "ask" : "bid",
            price: tokenAmount(order.price),
            remaining: tokenAmount(order.tradeSizeRemaining),
            orderSequenceNumber: String(order.orderSequenceNumber ?? ""),
            isStopLoss: order.isStopLoss === true,
            isStopLossDirection: order.isStopLossDirection === true,
          });
        }
      }
      // Trigger prices for open positions when the raw snapshot had none.
      const viewPositions = Array.isArray(view.positions)
        ? view.positions.filter(isRecord)
        : [];
      for (const viewPosition of viewPositions) {
        const symbol = String(viewPosition.symbol ?? "");
        const target = state.positions.find(
          (position) => position.symbol === symbol,
        );
        if (!target) continue;
        target.takeProfitPrice ??= tokenAmount(viewPosition.takeProfitPrice);
        target.stopLossPrice ??= tokenAmount(viewPosition.stopLossPrice);
        target.unrealizedPnl ??= tokenAmount(viewPosition.unrealizedPnl);
        target.liquidationPrice ??= tokenAmount(viewPosition.liquidationPrice);
      }
    }
  } catch {
    // view unavailable — positions/collateral above still stand
  }
  return state;
}

// The trader PDA on-chain reflects a deposit the moment it confirms; the
// Phoenix API indexer can lag behind it by many seconds, which left "Deposit
// first" showing after a successful deposit. Chain is truth for collateral;
// callers overlay this onto the API state (which still supplies positions
// and orders). Returns null when the trader account doesn't exist yet or
// the RPC/decode fails — callers then fall back to the API value.
export async function fetchOnChainCollateralUsd(
  rpcUrl: string,
  authority: string,
): Promise<number | null> {
  try {
    const exchange = await fetchExchangeConfig();
    const addresses = await getTraderAddresses(
      authority as never,
      exchange.keys.canonicalMint as never,
      0,
      0,
    );
    const connection = new Connection(rpcUrl, "confirmed");
    const info = await connection.getAccountInfo(
      new PublicKey(String(addresses.traderAccount)),
    );
    if (!info) return null;
    const trader = decodeTrader(new Uint8Array(info.data));
    // Quote lots are USDC atoms (QUOTE_LOTS_DECIMALS = 6 in the SDK).
    const usd = Number(trader.state.quoteLotCollateral) / 10 ** USDC_DECIMALS;
    return Number.isFinite(usd) && usd >= 0 && usd < 1e9 ? usd : null;
  } catch {
    return null;
  }
}

// ── Instruction plumbing ─────────────────────────────────────────────

type ApiInstruction = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: number[];
};

function apiIxToWeb3(ix: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: BrowserBuffer.from(Uint8Array.from(ix.data)) as unknown as Buffer,
  });
}

type KitInstruction = {
  programAddress: string;
  accounts?: readonly { address: string; role: number }[];
  data?: Uint8Array;
};

function kitIxToWeb3(ix: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((account) => ({
      pubkey: new PublicKey(account.address),
      // AccountRole: 0 readonly, 1 writable, 2 readonly-signer, 3 writable-signer
      isSigner: account.role >= 2,
      isWritable: account.role === 1 || account.role === 3,
    })),
    data: BrowserBuffer.from(ix.data ?? new Uint8Array()) as unknown as Buffer,
  });
}

export async function buildSignableTransaction(
  rpcUrl: string,
  feePayer: string,
  instructions: TransactionInstruction[],
): Promise<{
  transaction: VersionedTransaction;
  connection: Connection;
  latestBlockhash: BlockhashWithExpiryBlockHeight;
}> {
  const connection = new Connection(rpcUrl, "confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: new PublicKey(feePayer),
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message();
  return {
    transaction: new VersionedTransaction(message),
    connection,
    latestBlockhash,
  };
}

// Connection construction lives here — NOT in solana-rpc.ts, which must stay
// free of @solana/web3.js so the eager page graph never pulls it (the page
// reaches this module only through its lazy import boundary).
export function createSolanaConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

// Decodes a base64-serialized transaction (Jupiter swap / Trigger flows).
export function deserializeBase64Tx(base64: string): VersionedTransaction {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

async function postIx(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${PHOENIX_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `phoenix-ix-${response.status}`;
    throw new Error(message);
  }
  return payload;
}

// ── Onboarding: whitelist + referral attribution ─────────────────────

export type PhoenixAccess = {
  whitelisted: boolean;
  inviteCodeUsed: string | null;
};

export async function checkPhoenixAccess(
  wallet: string,
): Promise<PhoenixAccess> {
  const response = await fetch(
    `${PHOENIX_API}/v1/invite/check/${encodeURIComponent(wallet)}`,
  );
  if (!response.ok) throw new Error(`phoenix-invite-check-${response.status}`);
  const data = (await response.json()) as {
    whitelisted?: boolean;
    invite_code_used?: string | null;
  };
  return {
    whitelisted: Boolean(data.whitelisted),
    inviteCodeUsed: data.invite_code_used ?? null,
  };
}

// Activate the Ralph referral via Phoenix's current delegated onboarding flow.
// The wallet signs locally; Phoenix validates, adds the onboarder signature,
// and submits. No deprecated invite/referral endpoint or wallet-login JWT.
export async function activatePhoenixReferral(
  authority: string,
  rpcUrl: string,
  signTransaction: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>,
): Promise<{ ok: boolean; message: string; signature: string | null }> {
  const client = createPhoenixClient({
    apiUrl: PHOENIX_API,
    rpcUrl,
    ws: false,
    exchangeMetadata: { stream: false },
  });
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const built = await client.api.invite().buildActivateReferralTxRequest({
      referralCode: PHOENIX_REFERRAL_CODE,
      traderAuthority: authority,
      traderPdaIndex: 0,
      traderSubaccountIndex: 0,
      recentBlockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: BigInt(latestBlockhash.lastValidBlockHeight),
      registerTraderMaxPositions: 128n,
      rpcUrl,
      signTransaction: async (_transaction, context) => {
        const transaction = VersionedTransaction.deserialize(
          context.unsignedTransactionBytes,
        );
        return signTransaction(transaction);
      },
    });
    const response = await client.api
      .invite()
      .activateReferralTx(built.request);
    return {
      ok: true,
      message:
        response.status === "already_activated"
          ? "Phoenix referral already active"
          : "Phoenix referral activated",
      signature: response.signature ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "referral-activate-tx",
      signature: null,
    };
  } finally {
    client.dispose();
  }
}

// ── Trader registration ──────────────────────────────────────────────

// Returns the register-parent-trader instruction if the wallet has never
// traded on Phoenix; empty array otherwise. Prepended to the first action.
//
// The API's `registered` flag is only a hint: it lags right after referral
// activation (indexer catch-up) and registering twice fails the whole
// transaction with an opaque Custom program error. The trader PDA on-chain
// is the source of truth, so check its existence via RPC and only fall back
// to the hint when the RPC lookup itself fails.
// Phoenix trader PDA size in bytes — registration creates it and the payer
// funds its rent-exempt deposit (5,360 bytes ≈ 0.0382 SOL on mainnet,
// verified by simulation). Locked in the account, not spent.
const TRADER_ACCOUNT_SIZE = 5360;
// Headroom for transaction fees on top of the rent deposit (~0.002 SOL).
const REGISTER_FEE_BUFFER_LAMPORTS = 2_000_000;

export async function ensureTraderRegisteredIxs(
  rpcUrl: string,
  authority: string,
  registeredHint: boolean,
): Promise<TransactionInstruction[]> {
  const exchange = await fetchExchangeConfig();
  type Reg = Parameters<typeof buildRegisterTraderIx>[0];
  const addresses = await getTraderAddresses(
    authority as Reg["trader"],
    exchange.keys.canonicalMint as never,
    0,
    0,
  );
  const connection = new Connection(rpcUrl, "confirmed");
  let registered = registeredHint;
  try {
    const info = await connection.getAccountInfo(
      new PublicKey(String(addresses.traderAccount)),
    );
    registered = info !== null;
  } catch {
    // RPC hiccup — keep the API-derived hint rather than blocking the action.
  }
  if (registered) return [];

  // Registration funds the trader PDA's rent from the wallet. Without this
  // check an underfunded wallet fails simulation with an opaque program
  // error 0x1 (System: insufficient lamports, propagated) — say it plainly.
  let shortfallMessage: string | null = null;
  try {
    const [balance, rent] = await Promise.all([
      connection.getBalance(new PublicKey(authority)),
      connection.getMinimumBalanceForRentExemption(TRADER_ACCOUNT_SIZE),
    ]);
    const needed = rent + REGISTER_FEE_BUFFER_LAMPORTS;
    if (balance < needed) {
      const fmt = (lamports: number) => (lamports / 1e9).toFixed(4);
      shortfallMessage =
        `Registering your Phoenix margin account needs a one-time ` +
        `~${fmt(rent)} SOL rent deposit plus fees. Wallet has ` +
        `${fmt(balance)} SOL — add ~${fmt(needed - balance)} SOL and retry.`;
    }
  } catch {
    // RPC hiccup — let the simulation surface whatever happens.
  }
  if (shortfallMessage) throw new Error(shortfallMessage);
  const ix = buildRegisterTraderIx({
    payer: authority as Reg["payer"],
    trader: authority as Reg["trader"],
    traderAccount: addresses.traderAccount,
    maxPositions: BigInt(toMaxPositions(MarginType.Cross)),
    traderPdaIndex: 0,
    traderSubaccountIndex: 0,
  });
  return [kitIxToWeb3(ix as unknown as KitInstruction)];
}

// ── Orders ────────────────────────────────────────────────────────────

export type PlacePhoenixOrderInput = {
  authority: string;
  symbol: string;
  side: PhoenixSide;
  orderType: "market" | "limit";
  /** Base quantity in UI units (e.g. 0.5 SOL). */
  quantity: number;
  /** Limit price (quote) — required for limit orders. */
  price?: number;
  /** USDC margin to transfer into the isolated subaccount with the order. */
  marginUsd?: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  reduceOnly?: boolean;
};

export async function buildPlaceOrderPlan(
  input: PlacePhoenixOrderInput,
): Promise<PlacedOrderPlan> {
  const endpoint =
    input.orderType === "market"
      ? "/v1/ix/place-isolated-market-order-enhanced"
      : "/v1/ix/place-isolated-limit-order-enhanced";
  // TP/SL close the position, so they trade opposite the entry side. The
  // API rejects a trigger without an execution price (400: "requires both
  // trigger and execution prices"). Mirroring the SDK's split: the TP
  // executes as a limit AT the trigger (a limit at target can never fill
  // past it), while only the SL gets the 10% TP_SL_MAX_SLIPPAGE_BPS band
  // so it can fill through gaps (Limit-at-trigger TP / IOC-banded SL).
  const closeSide: PhoenixSide = input.side === "bid" ? "ask" : "bid";
  const tpSl: Record<string, number> = {};
  if (input.takeProfitPrice) {
    tpSl.takeProfitTriggerPrice = input.takeProfitPrice;
    tpSl.takeProfitExecutionPrice = input.takeProfitPrice;
  }
  if (input.stopLossPrice) {
    tpSl.stopLossTriggerPrice = input.stopLossPrice;
    tpSl.stopLossExecutionPrice = tpSlExecutionPrice(
      input.stopLossPrice,
      closeSide,
      TP_SL_MAX_SLIPPAGE_BPS,
    );
  }
  const body: Record<string, unknown> = {
    authority: input.authority,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    isReduceOnly: input.reduceOnly ?? false,
    allowCrossAndIsolatedForAsset: true,
    ...(input.orderType === "limit" && input.price
      ? { price: input.price }
      : {}),
    // A reduce-only order can't open new exposure, so funding fresh isolated
    // margin alongside it would just strand collateral in the child
    // subaccount — drop the transfer even if a marginUsd slips through.
    ...(input.marginUsd && input.marginUsd > 0 && !input.reduceOnly
      ? { transferAmount: Math.round(input.marginUsd * 10 ** USDC_DECIMALS) }
      : {}),
    ...(Object.keys(tpSl).length > 0 ? { tpSl } : {}),
  };
  const payload = await postIx(endpoint, body);
  if (!isRecord(payload) || !Array.isArray(payload.instructions)) {
    throw new Error("phoenix-ix-malformed-response");
  }
  return {
    instructions: (payload.instructions as ApiInstruction[]).map(apiIxToWeb3),
    estimatedLiquidationPriceUsd: Number.isFinite(
      Number(payload.estimatedLiquidationPriceUsd),
    )
      ? Number(payload.estimatedLiquidationPriceUsd)
      : null,
  };
}

// ── Cancel ────────────────────────────────────────────────────────────

export async function buildCancelAllIxs(
  authority: string,
  symbol: string,
  side: PhoenixSide,
): Promise<TransactionInstruction[]> {
  const exchange = await fetchExchangeConfig();
  const market = exchange.markets.find((entry) => entry.symbol === symbol);
  if (!market) throw new Error(`phoenix-unknown-market-${symbol}`);
  type Cancel = Parameters<typeof buildCancelUpToIx>[0];
  const addresses = await getTraderAddresses(
    authority as Cancel["trader"],
    exchange.keys.canonicalMint as never,
    0,
    0,
  );
  const ix = buildCancelUpToIx({
    trader: authority,
    traderAccount: addresses.traderAccount,
    perpAssetMap: exchange.keys.perpAssetMap,
    orderbook: market.marketPubkey,
    splineCollection: market.splinePubkey,
    activeTraderBuffer: exchange.keys.activeTraderBuffer,
    globalTraderIndex: exchange.keys.globalTraderIndex,
    side: side === "bid" ? RiseSide.Bid : RiseSide.Ask,
    numOrdersToCancel: null,
    tickLimit: null,
  } as unknown as Cancel);
  return [kitIxToWeb3(ix as unknown as KitInstruction)];
}

// A resting order's FIFO id embeds its price level in ticks and the program
// walks that level looking for the sequence number. Orders always sit on the
// tick grid, so round — flooring float noise from the API's UI price could
// land one tick low and miss the order entirely.
function priceToTicks(priceUsd: number, market: ExchangeMarket): bigint {
  if (!market.tickSize) {
    throw new Error(`phoenix-missing-tick-size-${market.symbol}`);
  }
  return BigInt(
    Math.round(
      (priceUsd * 10 ** USDC_DECIMALS) /
        (market.tickSize * 10 ** market.baseLotsDecimals),
    ),
  );
}

/** PhoenixOpenOrder rows satisfy this directly; stop-loss rows should also
 * carry the owning position's subaccount (triggers live on the child trader
 * account, not the parent that regular book orders rest under). */
export type CancelPhoenixOrderInput = {
  symbol: string;
  side: PhoenixSide;
  /** Book price in UI units — needed to rebuild the FIFO order id. */
  price: number | null;
  orderSequenceNumber: string;
  isStopLoss: boolean;
  isStopLossDirection?: boolean;
  traderPdaIndex?: number;
  subaccountIndex?: number;
};

export async function buildCancelSingleOrderIxs(
  authority: string,
  order: CancelPhoenixOrderInput,
): Promise<TransactionInstruction[]> {
  const exchange = await fetchExchangeConfig();
  const market = exchange.markets.find(
    (entry) => entry.symbol === order.symbol,
  );
  if (!market) throw new Error(`phoenix-unknown-market-${order.symbol}`);
  const addresses = await getTraderAddresses(
    authority as never,
    exchange.keys.canonicalMint as never,
    order.traderPdaIndex ?? 0,
    order.subaccountIndex ?? 0,
  );
  if (order.isStopLoss) {
    // TP/SL triggers never rest on the book: they live in a per-asset
    // StopLosses PDA holding one trigger per direction, so the cancel
    // addresses a direction rather than an order id. The view's direction
    // bit follows the SDK's StopLosses decoder: set = GreaterThan.
    type CancelSl = Parameters<typeof buildCancelStopLossIx>[0];
    const stopLossAccount = await getPhoenixStopLossAddress({
      traderAccount: addresses.traderAccount,
      assetId: BigInt(market.assetId),
    });
    const ix = buildCancelStopLossIx({
      funder: authority,
      traderWallet: authority,
      traderAccount: addresses.traderAccount,
      stopLossAccount,
      executionDirection: order.isStopLossDirection
        ? RiseDirection.GreaterThan
        : RiseDirection.LessThan,
    } as unknown as CancelSl);
    return [kitIxToWeb3(ix as unknown as KitInstruction)];
  }
  // Both fields come from the trader view; refuse to guess rather than risk
  // cancelling a neighbouring order at the wrong price level.
  if (order.price === null || !/^\d+$/.test(order.orderSequenceNumber)) {
    throw new Error(`phoenix-cancel-unidentifiable-${order.symbol}`);
  }
  type CancelById = Parameters<typeof buildCancelOrdersByIdIx>[0];
  const ix = buildCancelOrdersByIdIx({
    traderWallet: authority,
    traderAccount: addresses.traderAccount,
    perpAssetMap: exchange.keys.perpAssetMap,
    globalTraderIndex: exchange.keys.globalTraderIndex,
    activeTraderBuffer: exchange.keys.activeTraderBuffer,
    orderbook: market.marketPubkey,
    splineCollection: market.splinePubkey,
    orderIds: [
      {
        // null pointer = let the program search the price level.
        nodePointer: null,
        orderId: {
          priceInTicks: priceToTicks(order.price, market),
          orderSequenceNumber: BigInt(order.orderSequenceNumber),
        },
      },
    ],
  } as unknown as CancelById);
  return [kitIxToWeb3(ix as unknown as KitInstruction)];
}

// ── Position TP/SL ───────────────────────────────────────────────────

export type PhoenixTpSlUpdate = {
  /** USD trigger to set/replace; null removes it; undefined leaves it be. */
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
};

// Edits a live position's TP/SL triggers. A trigger's StopLosses slot is
// fully determined by position direction — a long's TP fires when price
// rises (greater_than) and its SL when it falls (less_than); shorts are
// mirrored — and the chain keeps one trigger per direction per asset. The
// program has no in-place replace, so "set" clears the occupied slot then
// places, with both halves riding the caller's single atomic transaction.
export async function buildSetPositionTpSlIxs(
  authority: string,
  position: PhoenixPosition,
  opts: PhoenixTpSlUpdate,
): Promise<TransactionInstruction[]> {
  const client = createPhoenixClient();
  try {
    const orders = client.api.orders();
    const scope = {
      authority,
      traderPdaIndex: position.traderPdaIndex,
      traderSubaccountIndex: position.subaccountIndex,
      isIsolated:
        position.traderPdaIndex !== 0 || position.subaccountIndex !== 0,
      symbol: position.symbol,
    };
    const long = position.size > 0;
    // Triggers close the position, so they trade opposite to it.
    const side: PhoenixSide = long ? "ask" : "bid";
    const updates = [
      {
        kind: "tp" as const,
        next: opts.takeProfitPrice,
        current: position.takeProfitPrice,
      },
      {
        kind: "sl" as const,
        next: opts.stopLossPrice,
        current: position.stopLossPrice,
      },
    ];
    const built: unknown[] = [];
    for (const update of updates) {
      if (update.next === undefined) continue;
      const direction: "greater_than" | "less_than" =
        (update.kind === "tp") === long ? "greater_than" : "less_than";
      // Only clear slots we know are occupied — cancelling an empty slot
      // would fail the whole transaction.
      if (update.current !== null) {
        built.push(
          ...(await orders.cancelStopLossOrder({
            ...scope,
            executionDirection: direction,
          })),
        );
      }
      if (update.next !== null) {
        // Trigger prices go up in USD like the order-time tpSl config. The
        // API requires an execution price beside every trigger (400 without
        // it). Mirroring the SDK's split: the TP executes as a limit AT the
        // trigger (can never fill past target); only the SL is banded 10%
        // past the trigger (TP_SL_MAX_SLIPPAGE_BPS) so it can fill through
        // gaps (Limit-at-trigger TP / IOC-banded SL). `side` already holds
        // the close side.
        built.push(
          ...(await orders.placeStopLossOrder({
            ...scope,
            side,
            ...(update.kind === "tp"
              ? {
                  takeProfitTriggerPrice: update.next,
                  takeProfitExecutionPrice: update.next,
                }
              : {
                  stopLossTriggerPrice: update.next,
                  stopLossExecutionPrice: tpSlExecutionPrice(
                    update.next,
                    side,
                    TP_SL_MAX_SLIPPAGE_BPS,
                  ),
                }),
          })),
        );
      }
    }
    return built.map((ix) => kitIxToWeb3(ix as KitInstruction));
  } finally {
    client.dispose();
  }
}

// ── Collateral: deposit / withdraw ───────────────────────────────────

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function ataFor(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      TOKEN_PROGRAM.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ATA_PROGRAM,
  );
  return ata.toBase58();
}

async function collateralContext(authority: string) {
  const exchange = await fetchExchangeConfig();
  const addresses = resolvePhoenixInstructionAddresses();
  const [emberState, emberVault, trader] = await Promise.all([
    getEmberStateAddress(),
    getEmberVaultAddress(),
    getTraderAddresses(
      authority as never,
      exchange.keys.canonicalMint as never,
      0,
      0,
    ),
  ]);
  return {
    exchange: {
      phoenixProgramAddress: addresses.programAddress,
      logAuthorityAddress: addresses.logAuthorityAddress,
      globalConfigurationAddress: addresses.globalConfigurationAddress,
      canonicalMint: exchange.keys.canonicalMint,
      usdcMint: USDC_MINT,
      perpAssetMap: exchange.keys.perpAssetMap,
      globalVault: exchange.keys.globalVault,
      withdrawQueue: exchange.keys.withdrawQueue,
      globalTraderIndex: exchange.keys.globalTraderIndex,
      activeTraderBuffer: exchange.keys.activeTraderBuffer,
      emberState,
      emberVault,
    },
    trader: {
      authority,
      traderAccount: trader.traderAccount,
      usdcTokenAccount: ataFor(authority, USDC_MINT),
      phoenixTokenAccount: ataFor(authority, exchange.keys.canonicalMint),
    },
  };
}

export async function buildDepositIxs(
  authority: string,
  amountUsd: number,
): Promise<TransactionInstruction[]> {
  const context = await collateralContext(authority);
  type Input = Parameters<typeof buildDepositIxsResolved>[0];
  const result = buildDepositIxsResolved({
    ...context,
    amount: BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)),
  } as unknown as Input);
  return result.instructions.map((ix) =>
    kitIxToWeb3(ix as unknown as KitInstruction),
  );
}

export async function buildWithdrawIxs(
  authority: string,
  amountUsd: number,
): Promise<TransactionInstruction[]> {
  const context = await collateralContext(authority);
  type Input = Parameters<typeof buildWithdrawIxsResolved>[0];
  const result = buildWithdrawIxsResolved({
    ...context,
    amount: BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)),
  } as unknown as Input);
  return result.instructions.map((ix) =>
    kitIxToWeb3(ix as unknown as KitInstruction),
  );
}

// Tops up an isolated position's margin: moves free cross collateral from
// the parent subaccount (0/0) into the child holding the position. More
// child collateral pushes the liquidation price further from mark.
export async function buildAddIsolatedMarginIxs(
  authority: string,
  position: PhoenixPosition,
  amountUsd: number,
): Promise<TransactionInstruction[]> {
  const exchange = await fetchExchangeConfig();
  type Transfer = Parameters<typeof buildTransferCollateralIx>[0];
  const [parent, child] = await Promise.all([
    getTraderAddresses(
      authority as never,
      exchange.keys.canonicalMint as never,
      0,
      0,
    ),
    getTraderAddresses(
      authority as never,
      exchange.keys.canonicalMint as never,
      position.traderPdaIndex,
      position.subaccountIndex,
    ),
  ]);
  const ix = buildTransferCollateralIx({
    trader: authority,
    srcTraderAccount: parent.traderAccount,
    dstTraderAccount: child.traderAccount,
    perpAssetMap: exchange.keys.perpAssetMap,
    globalTraderIndex: exchange.keys.globalTraderIndex,
    activeTraderBuffer: exchange.keys.activeTraderBuffer,
    amount: BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)),
  } as unknown as Transfer);
  return [kitIxToWeb3(ix as unknown as KitInstruction)];
}
