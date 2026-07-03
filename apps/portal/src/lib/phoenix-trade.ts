// Phoenix Perps venue integration.
//
// Execution model: the Phoenix API builds order instructions server-side
// (/v1/ix/*) in plain web3.js JSON ({programId, keys, data}); deposits,
// withdrawals, cancels and trader registration are built locally with
// @ellipsis-labs/rise. We assemble a v0 transaction and the caller signs it
// with the Privy embedded wallet. No keys or auth tokens are involved —
// every action is authorized purely by the wallet signature.

import {
  buildCancelUpToIx,
  buildDepositIxsResolved,
  buildRegisterTraderIx,
  buildWithdrawIxsResolved,
  createPhoenixClient,
  getEmberStateAddress,
  getEmberVaultAddress,
  getTraderAddresses,
  MarginType,
  Side as RiseSide,
  resolvePhoenixInstructionAddresses,
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
};

export type PhoenixOpenOrder = {
  symbol: string;
  side: PhoenixSide;
  price: number | null;
  remaining: number | null;
  orderSequenceNumber: string;
  isStopLoss: boolean;
};

export type PhoenixTraderState = {
  registered: boolean;
  collateralUsd: number | null;
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

export async function fetchPhoenixTraderState(
  authority: string,
): Promise<PhoenixTraderState> {
  const empty: PhoenixTraderState = {
    registered: false,
    collateralUsd: null,
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
  const data = (await response.json()) as { traders?: unknown[] };
  const traders = Array.isArray(data.traders)
    ? data.traders.filter(isRecord)
    : [];
  if (traders.length === 0) return empty;

  const state: PhoenixTraderState = { ...empty, registered: true };
  for (const trader of traders) {
    const pdaIndex = Number(trader.traderPdaIndex ?? 0);
    const subIndex = Number(trader.traderSubaccountIndex ?? 0);
    // Parent (0/0) carries the cross collateral headline.
    if (pdaIndex === 0 && subIndex === 0) {
      state.collateralUsd = tokenAmount(trader.collateralBalance);
      state.effectiveCollateralUsd = tokenAmount(trader.effectiveCollateral);
      state.riskTier =
        typeof trader.riskTier === "string" ? trader.riskTier : null;
    }
    const upnl = tokenAmount(trader.unrealizedPnl);
    if (upnl !== null) {
      state.unrealizedPnlUsd = (state.unrealizedPnlUsd ?? 0) + upnl;
    }
    const positions = Array.isArray(trader.positions)
      ? trader.positions.filter(isRecord)
      : [];
    for (const position of positions) {
      const size = tokenAmount(position.positionSize) ?? 0;
      if (size === 0) continue;
      state.positions.push({
        symbol: String(position.symbol ?? "?"),
        size,
        entryPrice: tokenAmount(position.entryPrice),
        liquidationPrice: tokenAmount(position.liquidationPrice),
        unrealizedPnl: tokenAmount(position.unrealizedPnl),
        positionValue: tokenAmount(position.positionValue),
        takeProfitPrice: tokenAmount(position.takeProfitPrice),
        stopLossPrice: tokenAmount(position.stopLossPrice),
        traderPdaIndex: pdaIndex,
        subaccountIndex: subIndex,
      });
    }
    const orderMap = isRecord(trader.limitOrders) ? trader.limitOrders : {};
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
          isStopLoss: Boolean(order.isStopLoss),
        });
      }
    }
  }
  return state;
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
export async function ensureTraderRegisteredIxs(
  authority: string,
  registered: boolean,
): Promise<TransactionInstruction[]> {
  if (registered) return [];
  const exchange = await fetchExchangeConfig();
  type Reg = Parameters<typeof buildRegisterTraderIx>[0];
  const addresses = await getTraderAddresses(
    authority as Reg["trader"],
    exchange.keys.canonicalMint as never,
    0,
    0,
  );
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
  const tpSl: Record<string, number> = {};
  if (input.takeProfitPrice)
    tpSl.takeProfitTriggerPrice = input.takeProfitPrice;
  if (input.stopLossPrice) tpSl.stopLossTriggerPrice = input.stopLossPrice;
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
    ...(input.marginUsd && input.marginUsd > 0
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
