import {
  BN,
  DriftClient as DriftSdkClient,
  configs as driftConfigs,
  getMarketsAndOraclesForSubscription,
  getUserAccountPublicKeySync,
  MarketType,
  OrderTriggerCondition,
  OrderType,
  PositionDirection,
} from "@drift-labs/sdk";
import {
  Connection,
  PublicKey,
  type Transaction,
  type TransactionVersion,
  type VersionedTransaction,
} from "@solana/web3.js";
import { SOL_MINT, SUPPORTED_TRADING_TOKENS, USDC_MINT } from "./defaults";
import type { DriftPerpIntentPreview } from "./drift";

type DriftBuildWallet = {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
};

const MAINNET_ENV = "mainnet-beta";
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const QUOTE_PRECISION = 1_000_000n;
const BASE_PRECISION = 1_000_000_000n;

export type DriftLiveSetupAction = "initialize_and_deposit" | "deposit";

export type DriftLiveAccountSnapshot = {
  userAccountAddress: string;
  marketIndex: number;
  positionDirection: "long" | "short" | "flat";
  baseAssetAmountAtomic: string;
  quoteAssetAmountAtomic: string;
  quoteEntryAmountAtomic: string;
  quoteBreakEvenAmountAtomic: string;
  settledPnlAtomic: string;
  collateralAtomic: string;
  freeCollateralAtomic: string;
  totalCollateralAtomic: string;
  initialMarginRequirementAtomic: string;
  maintenanceMarginRequirementAtomic: string;
  leverageTenThousand: string;
  health: number;
  openOrders: number;
};

export type DriftPreparedLivePerpOrder = {
  marketIndex: number;
  userAccountAddress: string;
  spotCollateralMint: string;
  setupAction: DriftLiveSetupAction | null;
  setupAmountAtomic: string | null;
  setupTransactionBase64: string | null;
  orderTransactionBase64: string | null;
  lastValidBlockHeight: number | null;
  snapshotBefore: DriftLiveAccountSnapshot | null;
};

export type DriftPreparedLiveCancelOrders = {
  marketIndex: number;
  userAccountAddress: string;
  cancelTransactionBase64: string;
  lastValidBlockHeight: number | null;
  snapshotBefore: DriftLiveAccountSnapshot;
};

type DriftSdkBundle = {
  client: DriftSdkClient;
  connection: Connection;
  walletPublicKey: PublicKey;
  perpMarket: (typeof driftConfigs)[typeof MAINNET_ENV]["PERP_MARKETS"][number];
};

type LegacyTransactionLike = {
  feePayer?: PublicKey;
  recentBlockhash?: string;
  instructions: unknown[];
  serialize(config?: {
    requireAllSignatures?: boolean;
    verifySignatures?: boolean;
  }): Uint8Array;
};

function createBuildWallet(publicKey: PublicKey): DriftBuildWallet {
  return {
    publicKey,
    async signTransaction(tx: Transaction): Promise<Transaction> {
      return tx;
    },
    async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
      return txs;
    },
  };
}

function resolvePerpMarket(instrumentId: string) {
  const normalized = instrumentId.trim().toUpperCase();
  const market =
    driftConfigs[MAINNET_ENV].PERP_MARKETS.find(
      (entry) => entry.symbol.toUpperCase() === normalized,
    ) ?? null;
  if (!market) {
    throw new Error(`drift-live-market-not-supported:${normalized}`);
  }
  return market;
}

function resolveUnderlyingMint(instrumentId: string): string {
  const symbol = instrumentId
    .trim()
    .toUpperCase()
    .replace(/-PERP$/, "");
  if (symbol === "SOL") return SOL_MINT;
  const token =
    SUPPORTED_TRADING_TOKENS.find(
      (entry) => entry.symbol.toUpperCase() === symbol,
    ) ?? null;
  if (!token) {
    throw new Error(`drift-live-underlying-mint-unresolved:${instrumentId}`);
  }
  return token.mint;
}

function deriveAssociatedTokenAddress(input: {
  owner: PublicKey;
  mint: PublicKey;
}): PublicKey {
  const [associatedTokenAddress] = PublicKey.findProgramAddressSync(
    [
      input.owner.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      input.mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return associatedTokenAddress;
}

function bigIntToBn(value: bigint): BN {
  return new BN(value.toString());
}

function positiveBigIntString(value: string | null | undefined): bigint | null {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function serializeTransactionToBase64(
  transaction: Transaction | VersionedTransaction,
  walletPublicKey: PublicKey,
): string {
  // Drift SDK can return legacy Transaction objects from a different
  // @solana/web3.js instance, so use structural detection instead of instanceof.
  if (
    "instructions" in transaction &&
    Array.isArray(
      (transaction as Transaction | LegacyTransactionLike).instructions,
    )
  ) {
    transaction.feePayer = walletPublicKey;
    return Buffer.from(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ).toString("base64");
  }
  return Buffer.from(transaction.serialize()).toString("base64");
}

async function refreshLegacyTransactionMetadata(input: {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
  walletPublicKey: PublicKey;
}): Promise<number | null> {
  if (
    !("instructions" in input.transaction) ||
    !Array.isArray(
      (input.transaction as Transaction | LegacyTransactionLike).instructions,
    )
  ) {
    return null;
  }
  const latest = await input.connection.getLatestBlockhash("confirmed");
  input.transaction.feePayer = input.walletPublicKey;
  input.transaction.recentBlockhash = latest.blockhash;
  return latest.lastValidBlockHeight;
}

function readOrderType(preview: DriftPerpIntentPreview): {
  orderType: ReturnType<typeof mapOrderType>;
  triggerCondition: typeof OrderTriggerCondition.ABOVE;
} {
  return {
    orderType: mapOrderType(preview),
    triggerCondition:
      preview.direction === "long"
        ? OrderTriggerCondition.ABOVE
        : OrderTriggerCondition.BELOW,
  };
}

function mapOrderType(preview: DriftPerpIntentPreview) {
  if (preview.orderType === "limit") return OrderType.LIMIT;
  if (preview.orderType === "trigger") {
    return preview.limitPriceAtomic
      ? OrderType.TRIGGER_LIMIT
      : OrderType.TRIGGER_MARKET;
  }
  return OrderType.MARKET;
}

function mapPositionDirection(preview: DriftPerpIntentPreview) {
  return preview.direction === "short"
    ? PositionDirection.SHORT
    : PositionDirection.LONG;
}

function readSetupShortfall(input: {
  preview: DriftPerpIntentPreview;
  snapshot: DriftLiveAccountSnapshot | null;
}): bigint | null {
  const requestedCollateral = positiveBigIntString(
    input.preview.collateralAtomic,
  );
  if (requestedCollateral === null) return null;
  if (!input.snapshot) return requestedCollateral;
  const freeCollateral = positiveBigIntString(
    input.snapshot.freeCollateralAtomic,
  );
  if (freeCollateral === null) return requestedCollateral;
  return requestedCollateral > freeCollateral
    ? requestedCollateral - freeCollateral
    : null;
}

function computeTargetBaseAmountAtomic(input: {
  targetNotionalUsd: string;
  referencePrice: number | null;
}): string {
  const price = input.referencePrice;
  if (price === null || !Number.isFinite(price) || price <= 0) {
    throw new Error("drift-live-reference-price-unavailable");
  }
  const priceAtomic = BigInt(Math.floor(price * Number(QUOTE_PRECISION)));
  if (priceAtomic <= 0n) {
    throw new Error("drift-live-reference-price-invalid");
  }
  const [wholeRaw, fractionRaw = ""] = String(input.targetNotionalUsd ?? "")
    .trim()
    .split(".", 2);
  const whole = /^[0-9]+$/.test(wholeRaw) ? BigInt(wholeRaw) : 0n;
  const fraction = /^[0-9]*$/.test(fractionRaw)
    ? BigInt(fractionRaw.padEnd(6, "0").slice(0, 6) || "0")
    : 0n;
  const notionalAtomic = whole * QUOTE_PRECISION + fraction;
  const baseAmount = (notionalAtomic * BASE_PRECISION) / priceAtomic;
  return (baseAmount > 0n ? baseAmount : 1n).toString();
}

function buildSdkBundle(input: {
  rpcEndpoint: string;
  walletPublicKey: string;
  instrumentId: string;
  skipLoadUsers: boolean;
}): DriftSdkBundle {
  const walletPublicKey = new PublicKey(input.walletPublicKey);
  const connection = new Connection(input.rpcEndpoint, "confirmed");
  const perpMarket = resolvePerpMarket(input.instrumentId);
  const quoteSpot = driftConfigs[MAINNET_ENV].SPOT_MARKETS.filter(
    (entry) => entry.marketIndex === 0,
  );
  const subscription = getMarketsAndOraclesForSubscription(
    MAINNET_ENV,
    [perpMarket],
    quoteSpot,
  );
  const client = new DriftSdkClient({
    connection,
    wallet: createBuildWallet(walletPublicKey),
    env: MAINNET_ENV,
    accountSubscription: {
      type: "websocket",
      commitment: "confirmed",
    },
    perpMarketIndexes: subscription.perpMarketIndexes,
    spotMarketIndexes: subscription.spotMarketIndexes,
    oracleInfos: subscription.oracleInfos,
    skipLoadUsers: input.skipLoadUsers,
    txVersion: "legacy" as TransactionVersion,
  });
  return {
    client,
    connection,
    walletPublicKey,
    perpMarket,
  };
}

async function ensureUserLoaded(input: {
  client: DriftSdkClient;
  walletPublicKey: PublicKey;
}): Promise<void> {
  if (!input.client.hasUser(0, input.walletPublicKey)) {
    await input.client.addUser(0, input.walletPublicKey);
  }
}

function buildSnapshot(input: {
  client: DriftSdkClient;
  marketIndex: number;
}): DriftLiveAccountSnapshot {
  const user = input.client.getUser();
  const position = user.getPerpPositionOrEmpty(input.marketIndex);
  const baseAssetAmount = BigInt(position.baseAssetAmount.toString());
  return {
    userAccountAddress: user.getUserAccountPublicKey().toBase58(),
    marketIndex: input.marketIndex,
    positionDirection:
      baseAssetAmount > 0n ? "long" : baseAssetAmount < 0n ? "short" : "flat",
    baseAssetAmountAtomic: position.baseAssetAmount.toString(),
    quoteAssetAmountAtomic: position.quoteAssetAmount.toString(),
    quoteEntryAmountAtomic: position.quoteEntryAmount.toString(),
    quoteBreakEvenAmountAtomic: position.quoteBreakEvenAmount.toString(),
    settledPnlAtomic: position.settledPnl.toString(),
    collateralAtomic: user.getTokenAmount(0).toString(),
    freeCollateralAtomic: user.getFreeCollateral("Initial").toString(),
    totalCollateralAtomic: user.getTotalCollateral("Initial").toString(),
    initialMarginRequirementAtomic: user
      .getInitialMarginRequirement(false, input.marketIndex)
      .toString(),
    maintenanceMarginRequirementAtomic: user
      .getMaintenanceMarginRequirement(undefined, input.marketIndex)
      .toString(),
    leverageTenThousand: user.getLeverage(true, input.marketIndex).toString(),
    health: user.getHealth(input.marketIndex),
    openOrders: position.openOrders,
  };
}

async function readUserAccountExists(input: {
  connection: Connection;
  walletPublicKey: PublicKey;
}): Promise<{
  exists: boolean;
  userAccountAddress: string;
}> {
  const userAccountPublicKey = getUserAccountPublicKeySync(
    new PublicKey(driftConfigs[MAINNET_ENV].DRIFT_PROGRAM_ID),
    input.walletPublicKey,
    0,
  );
  const account = await input.connection.getAccountInfo(
    userAccountPublicKey,
    "confirmed",
  );
  return {
    exists: account !== null,
    userAccountAddress: userAccountPublicKey.toBase58(),
  };
}

async function buildSetupTransaction(input: {
  client: DriftSdkClient;
  connection: Connection;
  walletPublicKey: PublicKey;
  amountAtomic: bigint;
  existingUser: boolean;
}): Promise<{
  setupAction: DriftLiveSetupAction;
  transactionBase64: string;
  lastValidBlockHeight: number | null;
}> {
  const usdcMint = new PublicKey(USDC_MINT);
  const usdcAta = deriveAssociatedTokenAddress({
    owner: input.walletPublicKey,
    mint: usdcMint,
  });
  if (input.existingUser) {
    await ensureUserLoaded({
      client: input.client,
      walletPublicKey: input.walletPublicKey,
    });
  }
  const transaction = input.existingUser
    ? await input.client.createDepositTxn(
        bigIntToBn(input.amountAtomic),
        0,
        usdcAta,
        0,
      )
    : (
        await input.client.createInitializeUserAccountAndDepositCollateral(
          bigIntToBn(input.amountAtomic),
          usdcAta,
          0,
          0,
        )
      )[0];
  const signatureBlock =
    "SIGNATURE_BLOCK_AND_EXPIRY" in transaction
      ? (
          transaction as Transaction & {
            SIGNATURE_BLOCK_AND_EXPIRY?: { lastValidBlockHeight?: number };
          }
        ).SIGNATURE_BLOCK_AND_EXPIRY
      : undefined;
  const refreshedLastValidBlockHeight = await refreshLegacyTransactionMetadata({
    connection: input.connection,
    transaction,
    walletPublicKey: input.walletPublicKey,
  });
  return {
    setupAction: input.existingUser ? "deposit" : "initialize_and_deposit",
    transactionBase64: serializeTransactionToBase64(
      transaction,
      input.walletPublicKey,
    ),
    lastValidBlockHeight:
      refreshedLastValidBlockHeight ??
      signatureBlock?.lastValidBlockHeight ??
      null,
  };
}

export async function readDriftLiveAccountSnapshot(input: {
  rpcEndpoint: string;
  walletPublicKey: string;
  instrumentId: string;
}): Promise<DriftLiveAccountSnapshot | null> {
  const sdk = buildSdkBundle({
    rpcEndpoint: input.rpcEndpoint,
    walletPublicKey: input.walletPublicKey,
    instrumentId: input.instrumentId,
    skipLoadUsers: false,
  });
  try {
    const exists = await readUserAccountExists({
      connection: sdk.connection,
      walletPublicKey: sdk.walletPublicKey,
    });
    if (!exists.exists) return null;
    await sdk.client.subscribe();
    await ensureUserLoaded({
      client: sdk.client,
      walletPublicKey: sdk.walletPublicKey,
    });
    await sdk.client.fetchAccounts();
    return buildSnapshot({
      client: sdk.client,
      marketIndex: sdk.perpMarket.marketIndex,
    });
  } finally {
    await sdk.client.unsubscribe().catch(() => {});
  }
}

export async function prepareDriftLivePerpOrder(input: {
  rpcEndpoint: string;
  walletPublicKey: string;
  preview: DriftPerpIntentPreview;
}): Promise<DriftPreparedLivePerpOrder> {
  const sdk = buildSdkBundle({
    rpcEndpoint: input.rpcEndpoint,
    walletPublicKey: input.walletPublicKey,
    instrumentId: input.preview.instrument.marketName,
    skipLoadUsers: false,
  });
  const existence = await readUserAccountExists({
    connection: sdk.connection,
    walletPublicKey: sdk.walletPublicKey,
  });

  let snapshotBefore: DriftLiveAccountSnapshot | null = null;
  if (existence.exists) {
    try {
      await sdk.client.subscribe();
      await ensureUserLoaded({
        client: sdk.client,
        walletPublicKey: sdk.walletPublicKey,
      });
      await sdk.client.fetchAccounts();
      snapshotBefore = buildSnapshot({
        client: sdk.client,
        marketIndex: sdk.perpMarket.marketIndex,
      });
    } finally {
      await sdk.client.unsubscribe().catch(() => {});
    }
  }

  const setupShortfall = readSetupShortfall({
    preview: input.preview,
    snapshot: snapshotBefore,
  });
  if (setupShortfall !== null && setupShortfall > 0n) {
    const setupSdk = buildSdkBundle({
      rpcEndpoint: input.rpcEndpoint,
      walletPublicKey: input.walletPublicKey,
      instrumentId: input.preview.instrument.marketName,
      skipLoadUsers: true,
    });
    try {
      await setupSdk.client.subscribe();
      const setup = await buildSetupTransaction({
        client: setupSdk.client,
        connection: setupSdk.connection,
        walletPublicKey: setupSdk.walletPublicKey,
        amountAtomic: setupShortfall,
        existingUser: existence.exists,
      });
      return {
        marketIndex: sdk.perpMarket.marketIndex,
        userAccountAddress: existence.userAccountAddress,
        spotCollateralMint: USDC_MINT,
        setupAction: setup.setupAction,
        setupAmountAtomic: setupShortfall.toString(),
        setupTransactionBase64: setup.transactionBase64,
        orderTransactionBase64: null,
        lastValidBlockHeight: setup.lastValidBlockHeight,
        snapshotBefore,
      };
    } finally {
      await setupSdk.client.unsubscribe().catch(() => {});
    }
  }

  if (!existence.exists) {
    throw new Error("drift-live-user-account-missing");
  }

  const liveSdk = buildSdkBundle({
    rpcEndpoint: input.rpcEndpoint,
    walletPublicKey: input.walletPublicKey,
    instrumentId: input.preview.instrument.marketName,
    skipLoadUsers: false,
  });
  try {
    await liveSdk.client.subscribe();
    await ensureUserLoaded({
      client: liveSdk.client,
      walletPublicKey: liveSdk.walletPublicKey,
    });
    await liveSdk.client.fetchAccounts();
    const { orderType, triggerCondition } = readOrderType(input.preview);
    const orderInstruction = await liveSdk.client.getPlaceAndTakePerpOrderIx({
      marketIndex: liveSdk.perpMarket.marketIndex,
      marketType: MarketType.PERP,
      direction: mapPositionDirection(input.preview),
      baseAssetAmount: bigIntToBn(
        positiveBigIntString(input.preview.quantityAtomic) ?? 1n,
      ),
      orderType,
      price: bigIntToBn(
        positiveBigIntString(input.preview.limitPriceAtomic) ?? 0n,
      ),
      reduceOnly: input.preview.reduceOnly,
      triggerPrice:
        positiveBigIntString(input.preview.triggerPriceAtomic) === null
          ? null
          : bigIntToBn(
              positiveBigIntString(input.preview.triggerPriceAtomic) ?? 0n,
            ),
      triggerCondition,
    });
    const transaction = await liveSdk.client.buildTransaction([
      orderInstruction,
    ]);
    const signatureBlock =
      "SIGNATURE_BLOCK_AND_EXPIRY" in transaction
        ? (
            transaction as Transaction & {
              SIGNATURE_BLOCK_AND_EXPIRY?: { lastValidBlockHeight?: number };
            }
          ).SIGNATURE_BLOCK_AND_EXPIRY
        : undefined;
    const refreshedLastValidBlockHeight =
      await refreshLegacyTransactionMetadata({
        connection: liveSdk.connection,
        transaction,
        walletPublicKey: liveSdk.walletPublicKey,
      });
    return {
      marketIndex: liveSdk.perpMarket.marketIndex,
      userAccountAddress: existence.userAccountAddress,
      spotCollateralMint: USDC_MINT,
      setupAction: null,
      setupAmountAtomic: null,
      setupTransactionBase64: null,
      orderTransactionBase64: serializeTransactionToBase64(
        transaction,
        liveSdk.walletPublicKey,
      ),
      lastValidBlockHeight:
        refreshedLastValidBlockHeight ??
        signatureBlock?.lastValidBlockHeight ??
        null,
      snapshotBefore: buildSnapshot({
        client: liveSdk.client,
        marketIndex: liveSdk.perpMarket.marketIndex,
      }),
    };
  } finally {
    await liveSdk.client.unsubscribe().catch(() => {});
  }
}

export async function prepareDriftLiveCancelOrders(input: {
  rpcEndpoint: string;
  walletPublicKey: string;
  instrumentId: string;
}): Promise<DriftPreparedLiveCancelOrders> {
  const sdk = buildSdkBundle({
    rpcEndpoint: input.rpcEndpoint,
    walletPublicKey: input.walletPublicKey,
    instrumentId: input.instrumentId,
    skipLoadUsers: false,
  });
  const existence = await readUserAccountExists({
    connection: sdk.connection,
    walletPublicKey: sdk.walletPublicKey,
  });
  if (!existence.exists) {
    throw new Error("drift-live-user-account-missing");
  }

  try {
    await sdk.client.subscribe();
    await ensureUserLoaded({
      client: sdk.client,
      walletPublicKey: sdk.walletPublicKey,
    });
    await sdk.client.fetchAccounts();
    const snapshotBefore = buildSnapshot({
      client: sdk.client,
      marketIndex: sdk.perpMarket.marketIndex,
    });
    const cancelIx = await sdk.client.getCancelOrdersIx(
      MarketType.PERP,
      sdk.perpMarket.marketIndex,
      null,
      0,
    );
    const transaction = await sdk.client.buildTransaction([cancelIx]);
    const signatureBlock =
      "SIGNATURE_BLOCK_AND_EXPIRY" in transaction
        ? (
            transaction as Transaction & {
              SIGNATURE_BLOCK_AND_EXPIRY?: { lastValidBlockHeight?: number };
            }
          ).SIGNATURE_BLOCK_AND_EXPIRY
        : undefined;
    const refreshedLastValidBlockHeight =
      await refreshLegacyTransactionMetadata({
        connection: sdk.connection,
        transaction,
        walletPublicKey: sdk.walletPublicKey,
      });
    return {
      marketIndex: sdk.perpMarket.marketIndex,
      userAccountAddress: existence.userAccountAddress,
      cancelTransactionBase64: serializeTransactionToBase64(
        transaction,
        sdk.walletPublicKey,
      ),
      lastValidBlockHeight:
        refreshedLastValidBlockHeight ??
        signatureBlock?.lastValidBlockHeight ??
        null,
      snapshotBefore,
    };
  } finally {
    await sdk.client.unsubscribe().catch(() => {});
  }
}

export function buildDriftSmokeIntent(input: {
  instrumentId: string;
  side: "long" | "short" | "close_long" | "close_short";
  targetNotionalUsd: string;
  referencePrice: number | null;
  collateralAtomic?: string | null;
}): {
  instrumentId: string;
  quantityAtomic: string;
  collateralAtomic: string | null;
} {
  return {
    instrumentId: input.instrumentId,
    quantityAtomic: computeTargetBaseAmountAtomic({
      targetNotionalUsd: input.targetNotionalUsd,
      referencePrice: input.referencePrice,
    }),
    collateralAtomic:
      input.side === "long" || input.side === "short"
        ? String(input.collateralAtomic ?? "5000000").trim() || "5000000"
        : null,
  };
}

export function resolveDriftSmokeUnderlyingMint(instrumentId: string): string {
  return resolveUnderlyingMint(instrumentId);
}
