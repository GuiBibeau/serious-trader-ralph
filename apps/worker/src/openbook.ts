import { createHash } from "node:crypto";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  I64_MAX_BN,
  OPENBOOK_PROGRAM_ID,
  Market as OpenBookMarket,
  OpenBookV2Client,
  OpenOrders,
  PlaceOrderTypeUtils,
  SelfTradeBehaviorUtils,
  SideUtils,
} from "@openbook-dex/openbook-v2";
import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { SUPPORTED_TRADING_PAIRS, type SupportedTradingPair } from "./defaults";
import type { JupiterQuoteResponse } from "./jupiter";

export const OPENBOOK_MARKET_ACCOUNT_LAYOUT = {
  discriminatorOffset: 0,
  discriminator: createHash("sha256")
    .update("account:Market")
    .digest()
    .subarray(0, 8),
  dataSize: 848,
  baseMintOffset: 576,
  quoteMintOffset: 608,
} as const;

export type OpenBookOrderOptions = {
  orderType?: "market" | "limit" | "trigger" | null;
  timeInForce?: "gtc" | "ioc" | "fok" | null;
  postOnly?: boolean | null;
  reduceOnly?: boolean | null;
  quantityMode?: "base" | "quote" | "notional" | null;
  limitPriceAtomic?: string | null;
  clientOrderId?: string | null;
};

export type OpenBookMarketSnapshot = {
  instrumentId: string;
  marketAddress: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  bestBidPriceUi: number | null;
  bestAskPriceUi: number | null;
  bestBidSizeUi: number | null;
  bestAskSizeUi: number | null;
  spreadBps: number | null;
  tickSizeUi: string;
  minOrderSizeUi: string;
  openOrdersAdminRequired: boolean;
  consumeEventsAdminRequired: boolean;
  closeMarketAdminRequired: boolean;
};

export type OpenBookOrderSnapshot = {
  orderId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  priceUi: string;
  sizeUi: string;
  expired: boolean;
};

export type OpenBookOpenOrdersSummary = {
  market: OpenBookMarketSnapshot;
  openOrdersIndexer: string;
  openOrdersAccount: string | null;
  userBaseAccount: string;
  userQuoteAccount: string;
  makerVolumeNative: string;
  takerVolumeNative: string;
  baseBalanceUi: string;
  quoteBalanceUi: string;
  orderCount: number;
  orders: OpenBookOrderSnapshot[];
};

export type OpenBookAccountPlan = {
  openOrdersIndexer: string;
  openOrdersAccount: string;
  userBaseAccount: string;
  userQuoteAccount: string;
  userFundingAccount: string;
  createdOpenOrdersIndexer: boolean;
  createdOpenOrdersAccount: boolean;
};

export type OpenBookResolvedOrderRequest = {
  side: "buy" | "sell";
  quantityAtomic: string;
  quantityBaseUi: number;
  orderType: "market" | "limit";
  timeInForce: "gtc" | "ioc" | "fok";
  postOnly: boolean;
  limitPriceAtomic: string;
  limitPriceUi: number;
  clientOrderId: string;
  estimatedQuoteUi: number;
  estimatedQuoteAtomic: string;
};

export type OpenBookPlaceOrderPlan = {
  unsignedTransactionBase64: string;
  lastValidBlockHeight: number | null;
  market: OpenBookMarketSnapshot;
  prerequisites: OpenBookAccountPlan;
  request: OpenBookResolvedOrderRequest;
  quotePreview: JupiterQuoteResponse;
};

export type OpenBookCancelOrderPlan = {
  unsignedTransactionBase64: string;
  lastValidBlockHeight: number | null;
  market: OpenBookMarketSnapshot;
  openOrdersAccount: string;
  clientOrderId: string;
};

export type OpenBookReplaceOrderPlan = {
  unsignedTransactionBase64: string;
  lastValidBlockHeight: number | null;
  market: OpenBookMarketSnapshot;
  openOrdersAccount: string;
  cancelledClientOrderId: string;
  replacement: OpenBookResolvedOrderRequest;
  quotePreview: JupiterQuoteResponse;
};

export type OpenBookSdkFacade = {
  buildPlaceOrderPlan(request: {
    rpcEndpoint: string;
    programId: string;
    walletPublicKey: string;
    instrumentId: string;
    side: "buy" | "sell";
    quantityAtomic: string;
    options?: OpenBookOrderOptions | null;
  }): Promise<OpenBookPlaceOrderPlan>;
  buildCancelOrderPlan(request: {
    rpcEndpoint: string;
    programId: string;
    walletPublicKey: string;
    instrumentId: string;
    clientOrderId: string;
  }): Promise<OpenBookCancelOrderPlan>;
  buildReplaceOrderPlan(request: {
    rpcEndpoint: string;
    programId: string;
    walletPublicKey: string;
    instrumentId: string;
    clientOrderId: string;
    side: "buy" | "sell";
    quantityAtomic: string;
    options?: OpenBookOrderOptions | null;
  }): Promise<OpenBookReplaceOrderPlan>;
  listOpenOrders(request: {
    rpcEndpoint: string;
    programId: string;
    walletPublicKey: string;
    instrumentId: string;
  }): Promise<OpenBookOpenOrdersSummary>;
};

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readTruthyBoolean(value: unknown): boolean {
  return (
    value === true ||
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

function parsePositiveAtomicString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

function parseOptionalClientOrderId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parsePositiveAtomicString(value);
}

function tryParsePublicKey(value: string): PublicKey | null {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function resolveSupportedPair(
  instrumentId: string,
): SupportedTradingPair | null {
  return (
    SUPPORTED_TRADING_PAIRS.find((pair) => pair.id === instrumentId.trim()) ??
    null
  );
}

function isVersionedTransaction(
  tx: Transaction | VersionedTransaction,
): tx is VersionedTransaction {
  return "version" in tx;
}

function serializeUnsignedTransactionBase64(
  tx: Transaction | VersionedTransaction,
): string {
  if (isVersionedTransaction(tx)) {
    return Buffer.from(tx.serialize()).toString("base64");
  }
  return Buffer.from(
    tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString("base64");
}

function buildReadOnlyWallet(publicKey: PublicKey): {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
} {
  return {
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      _tx: T,
    ): Promise<T> {
      throw new Error("openbook-read-only-wallet-cannot-sign");
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      _txs: T[],
    ): Promise<T[]> {
      throw new Error("openbook-read-only-wallet-cannot-sign");
    },
  };
}

function buildConnection(rpcEndpoint: string): Connection {
  return new Connection(rpcEndpoint, "confirmed");
}

function buildProvider(
  rpcEndpoint: string,
  walletPublicKey: string,
): AnchorProvider {
  return new AnchorProvider(
    buildConnection(rpcEndpoint),
    buildReadOnlyWallet(new PublicKey(walletPublicKey)) as never,
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    },
  );
}

function buildClient(input: {
  rpcEndpoint: string;
  programId: string;
  walletPublicKey: string;
}): OpenBookV2Client {
  return new OpenBookV2Client(
    buildProvider(input.rpcEndpoint, input.walletPublicKey),
    new PublicKey(input.programId),
  );
}

function buildMarketSnapshot(input: {
  instrumentId: string;
  market: OpenBookMarket;
}): OpenBookMarketSnapshot {
  const bestBid = input.market.bids?.best();
  const bestAsk = input.market.asks?.best();
  const spreadBps =
    bestBid && bestAsk && bestBid.price > 0
      ? ((bestAsk.price - bestBid.price) / bestBid.price) * 10_000
      : null;
  return {
    instrumentId: input.instrumentId,
    marketAddress: input.market.pubkey.toBase58(),
    baseMint: input.market.account.baseMint.toBase58(),
    quoteMint: input.market.account.quoteMint.toBase58(),
    baseDecimals: input.market.account.baseDecimals,
    quoteDecimals: input.market.account.quoteDecimals,
    bestBidPriceUi: bestBid?.price ?? null,
    bestAskPriceUi: bestAsk?.price ?? null,
    bestBidSizeUi: bestBid?.size ?? null,
    bestAskSizeUi: bestAsk?.size ?? null,
    spreadBps:
      spreadBps !== null && Number.isFinite(spreadBps) ? spreadBps : null,
    tickSizeUi: input.market.tickSize.toString(),
    minOrderSizeUi: input.market.minOrderSize.toString(),
    openOrdersAdminRequired: !input.market.account.openOrdersAdmin.key.equals(
      PublicKey.default,
    ),
    consumeEventsAdminRequired:
      !input.market.account.consumeEventsAdmin.key.equals(PublicKey.default),
    closeMarketAdminRequired: !input.market.account.closeMarketAdmin.key.equals(
      PublicKey.default,
    ),
  };
}

function topOfBookLiquidityScore(snapshot: OpenBookMarketSnapshot): number {
  return (
    (snapshot.bestBidPriceUi ?? 0) * (snapshot.bestBidSizeUi ?? 0) +
    (snapshot.bestAskPriceUi ?? 0) * (snapshot.bestAskSizeUi ?? 0)
  );
}

function compareMarketCandidates(
  a: OpenBookMarketSnapshot,
  b: OpenBookMarketSnapshot,
): number {
  const aHasBoth =
    a.bestBidPriceUi !== null && a.bestAskPriceUi !== null ? 1 : 0;
  const bHasBoth =
    b.bestBidPriceUi !== null && b.bestAskPriceUi !== null ? 1 : 0;
  if (aHasBoth !== bHasBoth) return bHasBoth - aHasBoth;
  const spreadA = a.spreadBps ?? Number.POSITIVE_INFINITY;
  const spreadB = b.spreadBps ?? Number.POSITIVE_INFINITY;
  if (spreadA !== spreadB) return spreadA - spreadB;
  const liquidityA = topOfBookLiquidityScore(a);
  const liquidityB = topOfBookLiquidityScore(b);
  if (liquidityA !== liquidityB) return liquidityB - liquidityA;
  return a.marketAddress.localeCompare(b.marketAddress);
}

export function buildOpenBookMarketAccountFilters(input: {
  baseMintAddress: PublicKey;
  quoteMintAddress: PublicKey;
}): Array<
  { dataSize: number } | { memcmp: { offset: number; bytes: string } }
> {
  return [
    {
      dataSize: OPENBOOK_MARKET_ACCOUNT_LAYOUT.dataSize,
    },
    {
      memcmp: {
        offset: OPENBOOK_MARKET_ACCOUNT_LAYOUT.discriminatorOffset,
        bytes: bs58.encode(OPENBOOK_MARKET_ACCOUNT_LAYOUT.discriminator),
      },
    },
    {
      memcmp: {
        offset: OPENBOOK_MARKET_ACCOUNT_LAYOUT.baseMintOffset,
        bytes: input.baseMintAddress.toBase58(),
      },
    },
    {
      memcmp: {
        offset: OPENBOOK_MARKET_ACCOUNT_LAYOUT.quoteMintOffset,
        bytes: input.quoteMintAddress.toBase58(),
      },
    },
  ];
}

async function findMarketAccountsByMints(input: {
  connection: Connection;
  baseMintAddress: PublicKey;
  quoteMintAddress: PublicKey;
  programId: PublicKey;
}) {
  return await input.connection.getProgramAccounts(input.programId, {
    commitment: "confirmed",
    filters: buildOpenBookMarketAccountFilters({
      baseMintAddress: input.baseMintAddress,
      quoteMintAddress: input.quoteMintAddress,
    }),
    dataSlice: {
      offset: 0,
      length: 0,
    },
  });
}

async function resolveMarket(input: {
  client: OpenBookV2Client;
  instrumentId: string;
}): Promise<{
  market: OpenBookMarket;
  snapshot: OpenBookMarketSnapshot;
}> {
  const pair = resolveSupportedPair(input.instrumentId);
  if (pair) {
    const accounts = await findMarketAccountsByMints({
      connection: input.client.connection,
      baseMintAddress: new PublicKey(pair.baseMint),
      quoteMintAddress: new PublicKey(pair.quoteMint),
      programId: input.client.programId,
    });
    if (accounts.length < 1) {
      throw new Error(`openbook-market-not-found:${input.instrumentId}`);
    }
    const loaded = await Promise.all(
      accounts.map(async ({ pubkey }) => {
        const market = await OpenBookMarket.load(input.client, pubkey);
        await market.loadOrderBook();
        return {
          market,
          snapshot: buildMarketSnapshot({
            instrumentId: input.instrumentId,
            market,
          }),
        };
      }),
    );
    loaded.sort((left, right) =>
      compareMarketCandidates(left.snapshot, right.snapshot),
    );
    return loaded[0] as {
      market: OpenBookMarket;
      snapshot: OpenBookMarketSnapshot;
    };
  }

  const marketKey = tryParsePublicKey(input.instrumentId);
  if (!marketKey) {
    throw new Error(`unsupported-openbook-instrument:${input.instrumentId}`);
  }
  const market = await OpenBookMarket.load(input.client, marketKey);
  await market.loadOrderBook();
  return {
    market,
    snapshot: buildMarketSnapshot({
      instrumentId: input.instrumentId,
      market,
    }),
  };
}

function deriveAggressivePriceUi(input: {
  market: OpenBookMarketSnapshot;
  side: "buy" | "sell";
}): number {
  const anchorPrice =
    input.side === "buy"
      ? input.market.bestAskPriceUi
      : input.market.bestBidPriceUi;
  if (anchorPrice === null || anchorPrice <= 0) {
    throw new Error("openbook-orderbook-liquidity-missing");
  }
  return input.side === "buy" ? anchorPrice * 1.05 : anchorPrice * 0.95;
}

function priceUiToAtomicString(priceUi: number, quoteDecimals: number): string {
  return Math.max(1, Math.round(priceUi * 10 ** quoteDecimals)).toString();
}

function quantityAtomicToBaseUi(
  quantityAtomic: string,
  baseDecimals: number,
): number {
  const quantity = Number(quantityAtomic);
  return quantity / 10 ** baseDecimals;
}

function computeQuoteNotionalAtomic(input: {
  priceAtomic: string;
  quantityAtomic: string;
  baseDecimals: number;
}): string {
  const priceAtomic = BigInt(input.priceAtomic);
  const quantityAtomic = BigInt(input.quantityAtomic);
  const baseScale = 10n ** BigInt(input.baseDecimals);
  return ((priceAtomic * quantityAtomic) / baseScale).toString();
}

function computeEstimatedQuoteUi(input: {
  limitPriceUi: number;
  quantityBaseUi: number;
}): number {
  return input.limitPriceUi * input.quantityBaseUi;
}

function computeMaxQuoteLotsIncludingFees(input: {
  market: OpenBookMarket;
  request: OpenBookResolvedOrderRequest;
}): BN {
  if (input.request.orderType === "market") {
    return I64_MAX_BN;
  }
  const quoteLimitUi = Math.max(
    input.request.estimatedQuoteUi * 1.02,
    input.market.quoteLotsToUi(new BN(1)),
  );
  return input.market.quoteUiToLots(quoteLimitUi);
}

export function resolveOpenBookOrderRequest(input: {
  market: OpenBookMarketSnapshot;
  side: "buy" | "sell";
  quantityAtomic: string;
  options?: OpenBookOrderOptions | null;
}): OpenBookResolvedOrderRequest {
  if (readTruthyBoolean(input.options?.reduceOnly)) {
    throw new Error("openbook-reduce-only-unsupported");
  }
  const quantityAtomic = parsePositiveAtomicString(input.quantityAtomic);
  if (!quantityAtomic) {
    throw new Error("openbook-quantity-atomic-invalid");
  }
  const quantityMode = readTrimmedString(input.options?.quantityMode) ?? "base";
  if (quantityMode !== "base") {
    throw new Error(`openbook-quantity-mode-unsupported:${quantityMode}`);
  }
  const orderTypeRaw = readTrimmedString(input.options?.orderType) ?? "limit";
  if (orderTypeRaw === "trigger") {
    throw new Error("openbook-trigger-orders-unsupported");
  }
  const orderType = orderTypeRaw === "market" ? "market" : "limit";
  const timeInForceRaw = readTrimmedString(input.options?.timeInForce) ?? "gtc";
  const timeInForce =
    timeInForceRaw === "ioc" || timeInForceRaw === "fok"
      ? timeInForceRaw
      : "gtc";
  const postOnly = readTruthyBoolean(input.options?.postOnly);
  if (postOnly && (orderType === "market" || timeInForce !== "gtc")) {
    throw new Error("openbook-post-only-incompatible");
  }
  const explicitLimitPriceAtomic = parsePositiveAtomicString(
    input.options?.limitPriceAtomic,
  );
  const limitPriceUi = explicitLimitPriceAtomic
    ? Number(explicitLimitPriceAtomic) / 10 ** input.market.quoteDecimals
    : deriveAggressivePriceUi({
        market: input.market,
        side: input.side,
      });
  if (!Number.isFinite(limitPriceUi) || limitPriceUi <= 0) {
    throw new Error("openbook-limit-price-invalid");
  }
  const limitPriceAtomic =
    explicitLimitPriceAtomic ??
    priceUiToAtomicString(limitPriceUi, input.market.quoteDecimals);
  const quantityBaseUi = quantityAtomicToBaseUi(
    quantityAtomic,
    input.market.baseDecimals,
  );
  if (!Number.isFinite(quantityBaseUi) || quantityBaseUi <= 0) {
    throw new Error("openbook-quantity-base-invalid");
  }
  const clientOrderId =
    parseOptionalClientOrderId(input.options?.clientOrderId) ??
    String(Date.now());
  const estimatedQuoteUi = computeEstimatedQuoteUi({
    limitPriceUi,
    quantityBaseUi,
  });
  return {
    side: input.side,
    quantityAtomic,
    quantityBaseUi,
    orderType,
    timeInForce,
    postOnly,
    limitPriceAtomic,
    limitPriceUi,
    clientOrderId,
    estimatedQuoteUi,
    estimatedQuoteAtomic: computeQuoteNotionalAtomic({
      priceAtomic: limitPriceAtomic,
      quantityAtomic,
      baseDecimals: input.market.baseDecimals,
    }),
  };
}

export function buildOpenBookSyntheticQuote(input: {
  market: OpenBookMarketSnapshot;
  request: OpenBookResolvedOrderRequest;
}): JupiterQuoteResponse {
  return input.request.side === "buy"
    ? {
        inputMint: input.market.quoteMint,
        outputMint: input.market.baseMint,
        inAmount: input.request.estimatedQuoteAtomic,
        outAmount: input.request.quantityAtomic,
        otherAmountThreshold: input.request.quantityAtomic,
        priceImpactPct:
          input.market.spreadBps !== null ? input.market.spreadBps / 100 : 0,
        routePlan: [
          {
            poolId: input.market.marketAddress,
            swapInfo: {
              label: "OpenBook v2",
              poolId: input.market.marketAddress,
            },
          },
        ],
      }
    : {
        inputMint: input.market.baseMint,
        outputMint: input.market.quoteMint,
        inAmount: input.request.quantityAtomic,
        outAmount: input.request.estimatedQuoteAtomic,
        otherAmountThreshold: input.request.estimatedQuoteAtomic,
        priceImpactPct:
          input.market.spreadBps !== null ? input.market.spreadBps / 100 : 0,
        routePlan: [
          {
            poolId: input.market.marketAddress,
            swapInfo: {
              label: "OpenBook v2",
              poolId: input.market.marketAddress,
            },
          },
        ],
      };
}

function mapSide(side: "buy" | "sell") {
  return side === "buy" ? SideUtils.Bid : SideUtils.Ask;
}

function mapPlaceOrderType(input: OpenBookResolvedOrderRequest) {
  if (input.postOnly) {
    return PlaceOrderTypeUtils.PostOnly;
  }
  if (input.orderType === "market") {
    return PlaceOrderTypeUtils.Market;
  }
  if (input.timeInForce === "ioc") {
    return PlaceOrderTypeUtils.ImmediateOrCancel;
  }
  if (input.timeInForce === "fok") {
    return PlaceOrderTypeUtils.FillOrKill;
  }
  return PlaceOrderTypeUtils.Limit;
}

function buildOpenOrdersAccountName(instrumentId: string): string {
  const pair = resolveSupportedPair(instrumentId);
  if (pair) {
    return `tr-${pair.baseSymbol.toLowerCase()}-${pair.quoteSymbol.toLowerCase()}`;
  }
  return `tr-ob-${instrumentId.slice(-8).toLowerCase()}`;
}

function collectRemainingAccounts(input: {
  market: OpenBookMarket;
  side: "buy" | "sell";
  postOnly: boolean;
}): PublicKey[] {
  if (input.postOnly) return [];
  const oppositeBook =
    input.side === "buy" ? input.market.asks : input.market.bids;
  if (!oppositeBook) return [];
  const accounts = new Set<string>();
  for (const order of oppositeBook.items()) {
    accounts.add(order.leafNode.owner.toBase58());
    if (accounts.size >= 3) break;
  }
  return Array.from(accounts).map((value) => new PublicKey(value));
}

function orderIdToString(value: unknown): string {
  if (value instanceof BN) return value.toString();
  return String(value ?? "");
}

async function buildUnsignedTransactionBase64(input: {
  client: OpenBookV2Client;
  walletPublicKey: PublicKey;
  instructions: TransactionInstruction[];
}): Promise<{
  unsignedTransactionBase64: string;
  lastValidBlockHeight: number;
}> {
  const blockhash =
    await input.client.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: input.walletPublicKey,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  });
  for (const instruction of input.instructions) {
    tx.add(instruction);
  }
  return {
    unsignedTransactionBase64: serializeUnsignedTransactionBase64(tx),
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
  };
}

export function createOpenBookSdkFacade(): OpenBookSdkFacade {
  async function loadSummary(input: {
    client: OpenBookV2Client;
    market: OpenBookMarket;
    snapshot: OpenBookMarketSnapshot;
    walletPublicKey: PublicKey;
  }): Promise<OpenBookOpenOrdersSummary> {
    await input.market.loadEventHeap();
    const openOrders = await OpenOrders.loadNullableForMarketAndOwner(
      input.market,
      input.walletPublicKey,
    );
    const userBaseAccount = await getAssociatedTokenAddress(
      input.market.account.baseMint,
      input.walletPublicKey,
    );
    const userQuoteAccount = await getAssociatedTokenAddress(
      input.market.account.quoteMint,
      input.walletPublicKey,
    );
    if (!openOrders) {
      return {
        market: input.snapshot,
        openOrdersIndexer: input.client
          .findOpenOrdersIndexer(input.walletPublicKey)
          .toBase58(),
        openOrdersAccount: null,
        userBaseAccount: userBaseAccount.toBase58(),
        userQuoteAccount: userQuoteAccount.toBase58(),
        makerVolumeNative: "0",
        takerVolumeNative: "0",
        baseBalanceUi: "0",
        quoteBalanceUi: "0",
        orderCount: 0,
        orders: [],
      };
    }
    await openOrders.reload();
    const orders = Array.from(openOrders.items()).map((order) => ({
      orderId: orderIdToString(order.leafNode.key),
      clientOrderId: orderIdToString(order.leafNode.clientOrderId),
      side: order.side.bid ? ("buy" as const) : ("sell" as const),
      priceUi: String(order.price),
      sizeUi: String(order.size),
      expired: order.isExpired,
    }));
    return {
      market: input.snapshot,
      openOrdersIndexer: input.client
        .findOpenOrdersIndexer(input.walletPublicKey)
        .toBase58(),
      openOrdersAccount: openOrders.pubkey.toBase58(),
      userBaseAccount: userBaseAccount.toBase58(),
      userQuoteAccount: userQuoteAccount.toBase58(),
      makerVolumeNative: openOrders.account.position.makerVolume.toString(),
      takerVolumeNative: openOrders.account.position.takerVolume.toString(),
      baseBalanceUi: String(openOrders.getBaseBalanceUi()),
      quoteBalanceUi: String(openOrders.getQuoteBalanceUi()),
      orderCount: orders.length,
      orders,
    };
  }

  return {
    async buildPlaceOrderPlan(request) {
      const client = buildClient(request);
      const walletPublicKey = new PublicKey(request.walletPublicKey);
      const { market, snapshot } = await resolveMarket({
        client,
        instrumentId: request.instrumentId,
      });
      const resolved = resolveOpenBookOrderRequest({
        market: snapshot,
        side: request.side,
        quantityAtomic: request.quantityAtomic,
        options: request.options,
      });
      const openOrdersIndexer = client.findOpenOrdersIndexer(walletPublicKey);
      const openOrdersIndexerAccount =
        await client.deserializeOpenOrdersIndexerAccount(openOrdersIndexer);
      const existingOpenOrders = await client.findOpenOrdersForMarket(
        walletPublicKey,
        market.pubkey,
      );
      const instructions: import("@solana/web3.js").TransactionInstruction[] =
        [];
      let createdOpenOrdersIndexer = false;
      let createdOpenOrdersAccount = false;
      let openOrdersAccount = existingOpenOrders[0] ?? null;
      if (!openOrdersAccount) {
        // `createOpenOrdersIx` already prepends indexer creation when needed.
        const [createOpenOrdersIxs, createdOpenOrders] =
          await client.createOpenOrdersIx(
            market.pubkey,
            buildOpenOrdersAccountName(request.instrumentId),
            walletPublicKey,
            null,
            openOrdersIndexer,
          );
        instructions.push(...createOpenOrdersIxs);
        openOrdersAccount = createdOpenOrders;
        createdOpenOrdersIndexer = !openOrdersIndexerAccount;
        createdOpenOrdersAccount = true;
      }
      if (!openOrdersAccount) {
        throw new Error("openbook-open-orders-account-missing");
      }
      const userBaseAccount = await getAssociatedTokenAddress(
        market.account.baseMint,
        walletPublicKey,
      );
      const userQuoteAccount = await getAssociatedTokenAddress(
        market.account.quoteMint,
        walletPublicKey,
      );
      const userFundingAccount =
        resolved.side === "buy" ? userQuoteAccount : userBaseAccount;
      instructions.push(
        await createAssociatedTokenAccountIdempotentInstruction(
          walletPublicKey,
          walletPublicKey,
          resolved.side === "buy"
            ? market.account.quoteMint
            : market.account.baseMint,
        ),
      );
      const priceLots = market.priceUiToLots(resolved.limitPriceUi);
      const maxBaseLots = market.baseUiToLots(resolved.quantityBaseUi);
      const remainingAccounts = collectRemainingAccounts({
        market,
        side: resolved.side,
        postOnly: resolved.postOnly,
      });
      const [placeOrderIx] = await client.placeOrderIx(
        openOrdersAccount,
        market.pubkey,
        market.account,
        userFundingAccount,
        {
          side: mapSide(resolved.side),
          priceLots,
          maxBaseLots,
          maxQuoteLotsIncludingFees: computeMaxQuoteLotsIncludingFees({
            market,
            request: resolved,
          }),
          clientOrderId: new BN(resolved.clientOrderId),
          orderType: mapPlaceOrderType(resolved),
          expiryTimestamp: new BN(0),
          selfTradeBehavior: SelfTradeBehaviorUtils.DecrementTake,
          limit: 16,
        },
        remainingAccounts,
      );
      instructions.push(placeOrderIx);
      const built = await buildUnsignedTransactionBase64({
        client,
        walletPublicKey,
        instructions,
      });
      return {
        unsignedTransactionBase64: built.unsignedTransactionBase64,
        lastValidBlockHeight: built.lastValidBlockHeight,
        market: snapshot,
        prerequisites: {
          openOrdersIndexer: openOrdersIndexer.toBase58(),
          openOrdersAccount: openOrdersAccount.toBase58(),
          userBaseAccount: userBaseAccount.toBase58(),
          userQuoteAccount: userQuoteAccount.toBase58(),
          userFundingAccount: userFundingAccount.toBase58(),
          createdOpenOrdersIndexer,
          createdOpenOrdersAccount,
        },
        request: resolved,
        quotePreview: buildOpenBookSyntheticQuote({
          market: snapshot,
          request: resolved,
        }),
      };
    },
    async buildCancelOrderPlan(request) {
      const client = buildClient(request);
      const walletPublicKey = new PublicKey(request.walletPublicKey);
      const { market, snapshot } = await resolveMarket({
        client,
        instrumentId: request.instrumentId,
      });
      const openOrdersAccounts = await client.findOpenOrdersForMarket(
        walletPublicKey,
        market.pubkey,
      );
      const openOrdersAccount = openOrdersAccounts[0];
      if (!openOrdersAccount) {
        throw new Error("openbook-open-orders-account-missing");
      }
      const openOrdersRecord =
        await client.deserializeOpenOrderAccount(openOrdersAccount);
      if (!openOrdersRecord) {
        throw new Error("openbook-open-orders-account-invalid");
      }
      const [cancelIx] = await client.cancelOrderByClientIdIx(
        openOrdersAccount,
        openOrdersRecord,
        market.account,
        new BN(request.clientOrderId),
      );
      const built = await buildUnsignedTransactionBase64({
        client,
        walletPublicKey,
        instructions: [cancelIx],
      });
      return {
        unsignedTransactionBase64: built.unsignedTransactionBase64,
        lastValidBlockHeight: built.lastValidBlockHeight,
        market: snapshot,
        openOrdersAccount: openOrdersAccount.toBase58(),
        clientOrderId: request.clientOrderId,
      };
    },
    async buildReplaceOrderPlan(request) {
      const client = buildClient(request);
      const walletPublicKey = new PublicKey(request.walletPublicKey);
      const { market, snapshot } = await resolveMarket({
        client,
        instrumentId: request.instrumentId,
      });
      const openOrdersAccounts = await client.findOpenOrdersForMarket(
        walletPublicKey,
        market.pubkey,
      );
      const openOrdersAccount = openOrdersAccounts[0];
      if (!openOrdersAccount) {
        throw new Error("openbook-open-orders-account-missing");
      }
      const openOrdersRecord =
        await client.deserializeOpenOrderAccount(openOrdersAccount);
      if (!openOrdersRecord) {
        throw new Error("openbook-open-orders-account-invalid");
      }
      const resolved = resolveOpenBookOrderRequest({
        market: snapshot,
        side: request.side,
        quantityAtomic: request.quantityAtomic,
        options: request.options,
      });
      const remainingAccounts = collectRemainingAccounts({
        market,
        side: resolved.side,
        postOnly: resolved.postOnly,
      });
      const userBaseAccount = await getAssociatedTokenAddress(
        market.account.baseMint,
        walletPublicKey,
      );
      const userQuoteAccount = await getAssociatedTokenAddress(
        market.account.quoteMint,
        walletPublicKey,
      );
      const userFundingAccount =
        resolved.side === "buy" ? userQuoteAccount : userBaseAccount;
      const [cancelIx] = await client.cancelOrderByClientIdIx(
        openOrdersAccount,
        openOrdersRecord,
        market.account,
        new BN(request.clientOrderId),
      );
      const [placeOrderIx] = await client.placeOrderIx(
        openOrdersAccount,
        market.pubkey,
        market.account,
        userFundingAccount,
        {
          side: mapSide(resolved.side),
          priceLots: market.priceUiToLots(resolved.limitPriceUi),
          maxBaseLots: market.baseUiToLots(resolved.quantityBaseUi),
          maxQuoteLotsIncludingFees: computeMaxQuoteLotsIncludingFees({
            market,
            request: resolved,
          }),
          clientOrderId: new BN(resolved.clientOrderId),
          orderType: mapPlaceOrderType(resolved),
          expiryTimestamp: new BN(0),
          selfTradeBehavior: SelfTradeBehaviorUtils.DecrementTake,
          limit: 16,
        },
        remainingAccounts,
      );
      const built = await buildUnsignedTransactionBase64({
        client,
        walletPublicKey,
        instructions: [cancelIx, placeOrderIx],
      });
      return {
        unsignedTransactionBase64: built.unsignedTransactionBase64,
        lastValidBlockHeight: built.lastValidBlockHeight,
        market: snapshot,
        openOrdersAccount: openOrdersAccount.toBase58(),
        cancelledClientOrderId: request.clientOrderId,
        replacement: resolved,
        quotePreview: buildOpenBookSyntheticQuote({
          market: snapshot,
          request: resolved,
        }),
      };
    },
    async listOpenOrders(request) {
      const client = buildClient(request);
      const walletPublicKey = new PublicKey(request.walletPublicKey);
      const { market, snapshot } = await resolveMarket({
        client,
        instrumentId: request.instrumentId,
      });
      return await loadSummary({
        client,
        market,
        snapshot,
        walletPublicKey,
      });
    },
  };
}

export class OpenBookClient {
  private readonly sdk: OpenBookSdkFacade;
  private readonly programId: string;

  constructor(
    private readonly rpcEndpoint: string,
    programId = OPENBOOK_PROGRAM_ID.toBase58(),
    deps?: {
      sdk?: OpenBookSdkFacade;
    },
  ) {
    this.programId = programId;
    this.sdk = deps?.sdk ?? createOpenBookSdkFacade();
  }

  async buildPlaceOrderPlan(request: {
    walletPublicKey: string;
    instrumentId: string;
    side: "buy" | "sell";
    quantityAtomic: string;
    options?: OpenBookOrderOptions | null;
  }): Promise<OpenBookPlaceOrderPlan> {
    return await this.sdk.buildPlaceOrderPlan({
      rpcEndpoint: this.rpcEndpoint,
      programId: this.programId,
      ...request,
    });
  }

  async buildCancelOrderPlan(request: {
    walletPublicKey: string;
    instrumentId: string;
    clientOrderId: string;
  }): Promise<OpenBookCancelOrderPlan> {
    return await this.sdk.buildCancelOrderPlan({
      rpcEndpoint: this.rpcEndpoint,
      programId: this.programId,
      ...request,
    });
  }

  async buildReplaceOrderPlan(request: {
    walletPublicKey: string;
    instrumentId: string;
    clientOrderId: string;
    side: "buy" | "sell";
    quantityAtomic: string;
    options?: OpenBookOrderOptions | null;
  }): Promise<OpenBookReplaceOrderPlan> {
    return await this.sdk.buildReplaceOrderPlan({
      rpcEndpoint: this.rpcEndpoint,
      programId: this.programId,
      ...request,
    });
  }

  async listOpenOrders(request: {
    walletPublicKey: string;
    instrumentId: string;
  }): Promise<OpenBookOpenOrdersSummary> {
    return await this.sdk.listOpenOrders({
      rpcEndpoint: this.rpcEndpoint,
      programId: this.programId,
      ...request,
    });
  }
}
