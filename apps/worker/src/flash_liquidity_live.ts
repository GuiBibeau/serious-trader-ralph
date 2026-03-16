import type { Address } from "@coral-xyz/anchor";
import type { BankRaw, MarginfiGroupRaw } from "@mrgnlabs/marginfi-client-v2";
import type { BankMetadataMap } from "@mrgnlabs/mrgn-common";
import {
  type AccountInfo,
  type AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { NonSwapExecutionIntent } from "./execution/types";
import type { Env } from "./types";

type FlashLiquidityLiveProvider = "marginfi";

type MarginfiClientModule = typeof import("@mrgnlabs/marginfi-client-v2");
type MarginfiClient = InstanceType<MarginfiClientModule["MarginfiClient"]>;
type MarginfiAccountWrapper = Awaited<
  ReturnType<MarginfiClient["getMarginfiAccountsForAuthority"]>
>[number];
type Bank =
  ReturnType<MarginfiClient["getBankByMint"]> extends infer T
    ? Exclude<T, null>
    : never;

type ReadOnlyWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
};

export type FlashLiquidityLiveAccountResolution = {
  provider: FlashLiquidityLiveProvider;
  bankAddress: string;
  bankMint: string;
  tokenSymbol: string | null;
  borrowAmountAtomic: string;
  borrowAmountUi: number;
  marginfiAccountAddress: string;
  setup: {
    unsignedTransactionBase64: string;
    lastValidBlockHeight: number | null;
  } | null;
};

export type FlashLiquidityLiveTransactionPlan = {
  provider: FlashLiquidityLiveProvider;
  bankAddress: string;
  bankMint: string;
  tokenSymbol: string | null;
  borrowAmountAtomic: string;
  borrowAmountUi: number;
  referenceId: string;
  marginfiAccountAddress: string;
  unsignedTransactionBase64: string;
  lastValidBlockHeight: number | null;
  addressLookupTableAddresses: string[];
};

export type FlashLiquidityLiveAccountState = {
  provider: FlashLiquidityLiveProvider;
  marginfiAccountAddress: string;
  activeBalanceCount: number;
  activeBankAddresses: string[];
  activeBalances: Array<{
    assetQuantityUi: string;
    assetShares: string;
    bankAddress: string;
    liabilityQuantityUi: string;
    liabilityShares: string;
  }>;
};

let marginfiClientModulePromise: Promise<MarginfiClientModule> | null = null;

const MARGINFI_BANK_MINT_OFFSET = 8;
const MARGINFI_BANK_GROUP_OFFSET = MARGINFI_BANK_MINT_OFFSET + 32 + 1;

const KNOWN_FLASH_BANK_METADATA_BY_MINT: Record<
  string,
  { tokenName: string; tokenSymbol: string }
> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    tokenName: "USD Coin",
    tokenSymbol: "USDC",
  },
};

function loadMarginfiClientModule(): Promise<MarginfiClientModule> {
  marginfiClientModulePromise ??= import("@mrgnlabs/marginfi-client-v2");
  return marginfiClientModulePromise;
}

function readRpcEndpoint(env: Pick<Env, "RPC_ENDPOINT">): string {
  const rpcEndpoint = String(env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("rpc-endpoint-missing");
  }
  return rpcEndpoint;
}

function readPositiveAtomic(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error("flash-liquidity-live-amount-invalid");
  }
  return normalized;
}

function atomicToUiAmount(value: string, decimals: number): number {
  const atomic = BigInt(readPositiveAtomic(value));
  const base = 10n ** BigInt(Math.max(0, decimals));
  const intPart = atomic / base;
  const fracPart = atomic % base;
  const normalized =
    fracPart === 0n
      ? intPart.toString()
      : `${intPart.toString()}.${fracPart
          .toString()
          .padStart(decimals, "0")
          .replace(/0+$/, "")}`;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("flash-liquidity-live-ui-amount-invalid");
  }
  return parsed;
}

function makeReadOnlyWallet(publicKey: PublicKey): ReadOnlyWallet {
  return {
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> {
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> {
      return txs;
    },
  };
}

type LegacyTransactionLike = {
  feePayer?: PublicKey;
  recentBlockhash?: string;
  partialSign?: (...signers: Keypair[]) => void;
  serialize: (options?: {
    requireAllSignatures?: boolean;
    verifySignatures?: boolean;
  }) => Uint8Array;
};

type VersionedTransactionWithLookupTables = VersionedTransaction & {
  addressLookupTables?: AddressLookupTableAccount[];
};

function serializeUnsignedTransactionBase64(
  transaction: Transaction | VersionedTransaction,
  walletPublicKey: PublicKey,
): string {
  if (
    "instructions" in transaction &&
    Array.isArray(transaction.instructions)
  ) {
    transaction.feePayer = walletPublicKey;
    return Buffer.from(
      (transaction as Transaction | LegacyTransactionLike).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ).toString("base64");
  }
  return Buffer.from(transaction.serialize()).toString("base64");
}

async function refreshLegacyTransactionMetadata(input: {
  connection: Connection;
  transaction: Transaction;
  walletPublicKey: PublicKey;
}): Promise<number | null> {
  const latest = await input.connection.getLatestBlockhash("confirmed");
  input.transaction.feePayer = input.walletPublicKey;
  input.transaction.recentBlockhash = latest.blockhash;
  return latest.lastValidBlockHeight;
}

function readFlashMarginfiBorrowLeg(intent: NonSwapExecutionIntent): {
  provider: FlashLiquidityLiveProvider;
  mint: string;
  amountAtomic: string;
} {
  const borrowLegs = Array.isArray(intent.borrowLegs) ? intent.borrowLegs : [];
  if (borrowLegs.length !== 1) {
    throw new Error("flash-liquidity-live-single-borrow-leg-required");
  }
  const [leg] = borrowLegs;
  if (
    String(leg.provider ?? "")
      .trim()
      .toLowerCase() !== "marginfi"
  ) {
    throw new Error(
      `flash-liquidity-live-provider-not-supported:${String(
        leg.provider ?? "",
      ).trim()}`,
    );
  }
  const mint = String(leg.mint ?? "").trim();
  if (!mint) {
    throw new Error("flash-liquidity-live-mint-required");
  }
  const amountAtomic = readPositiveAtomic(leg.amountAtomic);
  const settlementMint = String(intent.settlementMint ?? "").trim();
  if (!settlementMint || settlementMint !== mint) {
    throw new Error("flash-liquidity-live-settlement-mint-mismatch");
  }
  return {
    provider: "marginfi",
    mint,
    amountAtomic,
  };
}

async function buildMarginfiClient(input: {
  env: Pick<Env, "RPC_ENDPOINT">;
  walletPublicKey: PublicKey;
  mint: string;
}): Promise<{
  connection: Connection;
  client: MarginfiClient;
  module: MarginfiClientModule;
}> {
  const rpcEndpoint = readRpcEndpoint(input.env);
  const connection = new Connection(rpcEndpoint, "confirmed");
  const module = await loadMarginfiClientModule();
  const wallet = makeReadOnlyWallet(input.walletPublicKey);
  const config = module.getConfig("production");
  const bankMint = new PublicKey(input.mint);
  const bankAddresses = await findMarginfiBankAddressesByMint({
    connection,
    groupAddress: config.groupPk,
    mint: bankMint,
    programId: config.programId,
  });
  const client = await module.MarginfiClient.fetch(config, wallet, connection, {
    bankMetadataMap: buildMinimalMarginfiBankMetadata({
      bankAddresses,
      mint: bankMint,
    }),
    fetchGroupDataOverride: (
      program,
      groupAddress,
      _commitment,
      preloaded,
      bankMetadataMap,
    ) =>
      fetchMarginfiGroupDataWithoutBatch({
        bankAddresses: preloaded,
        bankMetadataMap,
        groupAddress,
        module,
        program,
      }),
    preloadedBankAddresses: bankAddresses,
  });
  return { connection, client, module };
}

function selectReusableMarginfiAccount(
  accounts: MarginfiAccountWrapper[],
): MarginfiAccountWrapper | null {
  return (
    accounts.find(
      (account) => !account.isDisabled && account.activeBalances.length < 1,
    ) ?? null
  );
}

function buildMinimalMarginfiBankMetadata(input: {
  bankAddresses: PublicKey[];
  mint: PublicKey;
}): BankMetadataMap {
  const mint = input.mint.toBase58();
  const knownMetadata = KNOWN_FLASH_BANK_METADATA_BY_MINT[mint];
  return Object.fromEntries(
    input.bankAddresses.map((bankAddress) => [
      bankAddress.toBase58(),
      {
        tokenAddress: mint,
        tokenName: knownMetadata?.tokenName ?? mint,
        tokenSymbol: knownMetadata?.tokenSymbol ?? mint.slice(0, 6),
      },
    ]),
  );
}

async function findMarginfiBankAddressesByMint(input: {
  connection: Connection;
  groupAddress: PublicKey;
  mint: PublicKey;
  programId: PublicKey;
}): Promise<PublicKey[]> {
  const accounts = await input.connection.getProgramAccounts(input.programId, {
    commitment: "confirmed",
    dataSlice: { offset: 0, length: 0 },
    filters: [
      {
        memcmp: {
          offset: MARGINFI_BANK_MINT_OFFSET,
          bytes: input.mint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: MARGINFI_BANK_GROUP_OFFSET,
          bytes: input.groupAddress.toBase58(),
        },
      },
    ],
  });
  if (accounts.length < 1) {
    throw new Error(
      `flash-liquidity-live-bank-lookup-failed:${input.mint.toBase58()}:${accounts.length}`,
    );
  }
  return accounts.map((account) => account.pubkey);
}

async function readAccountInfosWithoutBatch(
  connection: Connection,
  publicKeys: PublicKey[],
): Promise<AccountInfo<Buffer>[]> {
  const accountInfos = await Promise.all(
    publicKeys.map((publicKey) =>
      connection.getAccountInfo(publicKey, "confirmed"),
    ),
  );
  if (accountInfos.some((accountInfo) => accountInfo === null)) {
    throw new Error("flash-liquidity-live-account-info-missing");
  }
  return accountInfos as AccountInfo<Buffer>[];
}

async function fetchMarginfiGroupDataWithoutBatch(input: {
  bankAddresses?: PublicKey[];
  bankMetadataMap?: BankMetadataMap;
  groupAddress: PublicKey;
  module: MarginfiClientModule;
  program: {
    account: {
      bank: {
        fetchMultiple(addresses: PublicKey[]): Promise<Array<BankRaw | null>>;
      };
      marginfiGroup: {
        fetch(address: PublicKey): Promise<MarginfiGroupRaw>;
      };
    };
    provider: {
      connection: Connection;
    };
  };
}): Promise<{
  marginfiGroup: unknown;
  banks: Map<string, Bank>;
  priceInfos: Map<string, unknown>;
  tokenDatas: Map<
    string,
    {
      mint: PublicKey;
      tokenProgram: PublicKey;
      feeBps: number;
      emissionTokenProgram: PublicKey | null;
    }
  >;
  feedIdMap: Map<never, never>;
}> {
  const bankAddresses = Array.isArray(input.bankAddresses)
    ? input.bankAddresses
    : [];
  if (bankAddresses.length < 1) {
    throw new Error("flash-liquidity-live-preloaded-bank-required");
  }
  const fetchedBankAccounts =
    await input.program.account.bank.fetchMultiple(bankAddresses);
  const bankDatasKeyed = bankAddresses.flatMap((address, index) => {
    const data = fetchedBankAccounts[index];
    return data === null ? [] : [{ address, data }];
  });
  const mintKeys = bankDatasKeyed.map((bank) => bank.data.mint);
  const emissionMintKeys = bankDatasKeyed
    .map((bank) => bank.data.emissionsMint)
    .filter((mint) => !mint.equals(PublicKey.default));
  const oracleKeys = bankDatasKeyed.map(
    (bank) =>
      input.module.findOracleKey(
        input.module.BankConfig.fromAccountParsed(bank.data.config),
      ).oracleKey,
  );
  const [marginfiGroupRaw, accountInfos] = await Promise.all([
    input.program.account.marginfiGroup.fetch(input.groupAddress),
    readAccountInfosWithoutBatch(input.program.provider.connection, [
      ...oracleKeys,
      ...mintKeys,
      ...emissionMintKeys,
    ]),
  ]);
  const oracleAis = accountInfos.splice(0, oracleKeys.length);
  const mintAis = accountInfos.splice(0, mintKeys.length);
  const emissionMintAis = accountInfos.splice(0);
  const banks = new Map(
    bankDatasKeyed.map(({ address, data }) => {
      const bankMetadata = input.bankMetadataMap?.[address.toBase58()];
      const bank = input.module.Bank.fromAccountParsed(
        address,
        data,
        undefined,
        bankMetadata,
      );
      return [address.toBase58(), bank];
    }),
  );
  const tokenDatas = new Map(
    bankDatasKeyed.map(({ address: bankAddress, data: bankData }, index) => {
      const mintAddress = mintKeys[index];
      const mintDataRaw = mintAis[index];
      if (!mintDataRaw) {
        throw new Error(
          `flash-liquidity-live-mint-account-missing:${bankAddress.toBase58()}`,
        );
      }
      let emissionTokenProgram: PublicKey | null = null;
      if (!bankData.emissionsMint.equals(PublicKey.default)) {
        const emissionMintIndex = emissionMintKeys.findIndex((mint) =>
          mint.equals(bankData.emissionsMint),
        );
        emissionTokenProgram =
          emissionMintIndex >= 0
            ? emissionMintAis[emissionMintIndex].owner
            : null;
      }
      return [
        bankAddress.toBase58(),
        {
          mint: mintAddress,
          tokenProgram: mintDataRaw.owner,
          feeBps: 0,
          emissionTokenProgram,
        },
      ];
    }),
  );
  const priceInfos = new Map(
    bankDatasKeyed.map(({ address: bankAddress, data: bankData }, index) => {
      const priceDataRaw = oracleAis[index];
      if (!priceDataRaw) {
        throw new Error(
          `flash-liquidity-live-oracle-account-missing:${bankAddress.toBase58()}`,
        );
      }
      const parsedBankConfig = input.module.BankConfig.fromAccountParsed(
        bankData.config,
      );
      const oracleSetup = input.module.parseOracleSetup(
        bankData.config.oracleSetup,
      );
      const fixedPrice = parsedBankConfig.fixedPrice;
      return [
        bankAddress.toBase58(),
        input.module.parsePriceInfo(oracleSetup, priceDataRaw.data, fixedPrice),
      ];
    }),
  );
  return {
    marginfiGroup: input.module.MarginfiGroup.fromAccountParsed(
      input.groupAddress,
      marginfiGroupRaw,
    ),
    banks,
    priceInfos,
    tokenDatas,
    feedIdMap: new Map(),
  };
}

async function listMarginfiAccountsForAuthority(input: {
  authority: PublicKey;
  client: MarginfiClient;
  module: MarginfiClientModule;
}): Promise<MarginfiAccountWrapper[]> {
  const accounts = await input.client.program.account.marginfiAccount.all([
    {
      memcmp: {
        bytes: input.client.groupAddress.toBase58(),
        offset: 8,
      },
    },
    {
      memcmp: {
        bytes: input.authority.toBase58(),
        offset: 8 + 32,
      },
    },
  ]);
  return accounts.map((account) =>
    input.module.MarginfiAccountWrapper.fromAccountParsed(
      account.publicKey,
      input.client,
      account.account,
    ),
  );
}

async function resolveMarginfiBank(input: {
  client: MarginfiClient;
  mint: string;
}): Promise<Bank> {
  const bank = input.client.getBankByMint(new PublicKey(input.mint));
  if (!bank) {
    throw new Error(`flash-liquidity-live-bank-not-found:${input.mint}`);
  }
  return bank;
}

export async function resolveFlashLiquidityLiveAccount(input: {
  env: Pick<Env, "RPC_ENDPOINT">;
  walletPublicKey: string;
  intent: NonSwapExecutionIntent;
}): Promise<FlashLiquidityLiveAccountResolution> {
  const walletPublicKey = new PublicKey(input.walletPublicKey);
  const borrowLeg = readFlashMarginfiBorrowLeg(input.intent);
  const { client, connection, module } = await buildMarginfiClient({
    env: input.env,
    mint: borrowLeg.mint,
    walletPublicKey,
  });
  const bank = await resolveMarginfiBank({
    client,
    mint: borrowLeg.mint,
  });
  const borrowAmountUi = atomicToUiAmount(
    borrowLeg.amountAtomic,
    bank.mintDecimals,
  );
  const accounts = await listMarginfiAccountsForAuthority({
    authority: walletPublicKey,
    client,
    module,
  });
  const reusableAccount = selectReusableMarginfiAccount(accounts);
  if (reusableAccount) {
    return {
      provider: "marginfi",
      bankAddress: bank.address.toBase58(),
      bankMint: bank.mint.toBase58(),
      tokenSymbol: bank.tokenSymbol ?? null,
      borrowAmountAtomic: borrowLeg.amountAtomic,
      borrowAmountUi,
      marginfiAccountAddress: reusableAccount.address.toBase58(),
      setup: null,
    };
  }

  const accountKeypair = Keypair.generate();
  const setupTransaction = await client.createMarginfiAccountTx({
    accountKeypair,
  });
  const lastValidBlockHeight = await refreshLegacyTransactionMetadata({
    connection,
    transaction: setupTransaction,
    walletPublicKey,
  });
  setupTransaction.partialSign(accountKeypair);
  return {
    provider: "marginfi",
    bankAddress: bank.address.toBase58(),
    bankMint: bank.mint.toBase58(),
    tokenSymbol: bank.tokenSymbol ?? null,
    borrowAmountAtomic: borrowLeg.amountAtomic,
    borrowAmountUi,
    marginfiAccountAddress: accountKeypair.publicKey.toBase58(),
    setup: {
      unsignedTransactionBase64: serializeUnsignedTransactionBase64(
        setupTransaction,
        walletPublicKey,
      ),
      lastValidBlockHeight,
    },
  };
}

export async function buildFlashLiquidityLiveTransactionPlan(input: {
  env: Pick<Env, "RPC_ENDPOINT">;
  walletPublicKey: string;
  marginfiAccountAddress: string;
  intent: NonSwapExecutionIntent;
}): Promise<FlashLiquidityLiveTransactionPlan> {
  const walletPublicKey = new PublicKey(input.walletPublicKey);
  const borrowLeg = readFlashMarginfiBorrowLeg(input.intent);
  const { client, connection, module } = await buildMarginfiClient({
    env: input.env,
    mint: borrowLeg.mint,
    walletPublicKey,
  });
  const bank = await resolveMarginfiBank({
    client,
    mint: borrowLeg.mint,
  });
  const marginfiAccount = await module.MarginfiAccountWrapper.fetch(
    input.marginfiAccountAddress as Address,
    client,
  );
  const borrowAmountUi = atomicToUiAmount(
    borrowLeg.amountAtomic,
    bank.mintDecimals,
  );
  const borrowIx = await marginfiAccount.makeBorrowIx(
    borrowAmountUi,
    bank.address,
    {
      createAtas: true,
      observationBanksOverride: [bank.address],
      wrapAndUnwrapSol: false,
    },
  );
  const repayIx = await marginfiAccount.makeRepayIx(
    borrowAmountUi,
    bank.address,
    false,
    {
      wrapAndUnwrapSol: false,
    },
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = await marginfiAccount.buildFlashLoanTx({
    blockhash: latest.blockhash,
    ixs: [...borrowIx.instructions, ...repayIx.instructions],
    signers: [...borrowIx.keys, ...repayIx.keys],
  });
  return {
    provider: "marginfi",
    bankAddress: bank.address.toBase58(),
    bankMint: bank.mint.toBase58(),
    tokenSymbol: bank.tokenSymbol ?? null,
    borrowAmountAtomic: borrowLeg.amountAtomic,
    borrowAmountUi,
    referenceId: String(input.intent.referenceId ?? "").trim(),
    marginfiAccountAddress: marginfiAccount.address.toBase58(),
    unsignedTransactionBase64: serializeUnsignedTransactionBase64(
      transaction,
      walletPublicKey,
    ),
    lastValidBlockHeight: latest.lastValidBlockHeight,
    addressLookupTableAddresses:
      (
        transaction as VersionedTransactionWithLookupTables
      ).addressLookupTables?.map((lookupTable) => lookupTable.key.toBase58()) ??
      [],
  };
}

export async function readFlashLiquidityLiveAccountState(input: {
  env: Pick<Env, "RPC_ENDPOINT">;
  bankMint: string;
  walletPublicKey: string;
  marginfiAccountAddress: string;
}): Promise<FlashLiquidityLiveAccountState> {
  const walletPublicKey = new PublicKey(input.walletPublicKey);
  const { client, module } = await buildMarginfiClient({
    env: input.env,
    mint: input.bankMint,
    walletPublicKey,
  });
  const marginfiAccount = await module.MarginfiAccountWrapper.fetch(
    input.marginfiAccountAddress as Address,
    client,
  );
  return {
    provider: "marginfi",
    marginfiAccountAddress: marginfiAccount.address.toBase58(),
    activeBalanceCount: marginfiAccount.activeBalances.length,
    activeBankAddresses: marginfiAccount.activeBalances.map((balance) =>
      balance.bankPk.toBase58(),
    ),
    activeBalances: marginfiAccount.activeBalances.map((balance) => {
      const bank = client.getBankByPk(balance.bankPk);
      const quantities = bank
        ? balance.computeQuantityUi(bank)
        : { assets: null, liabilities: null };
      return {
        bankAddress: balance.bankPk.toBase58(),
        assetShares: balance.assetShares.toFixed(),
        liabilityShares: balance.liabilityShares.toFixed(),
        assetQuantityUi:
          quantities.assets === null ? "unknown" : quantities.assets.toFixed(),
        liabilityQuantityUi:
          quantities.liabilities === null
            ? "unknown"
            : quantities.liabilities.toFixed(),
      };
    }),
  };
}
