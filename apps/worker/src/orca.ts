import { BN } from "@coral-xyz/anchor";
import { Percentage, ReadOnlyWallet } from "@orca-so/common-sdk";
import {
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import {
  Connection,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import type { JupiterQuoteResponse } from "./jupiter";

export type OrcaTokenSnapshot = {
  address?: string;
  programId?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  tags?: string[];
  [k: string]: unknown;
};

export type OrcaPoolStatsSnapshot = {
  volume?: string;
  fees?: string;
  rewards?: string;
  yieldOverTvl?: string;
  [k: string]: unknown;
};

export type OrcaLockedLiquiditySnapshot = {
  name?: string;
  lockedPercentage?: string;
  locked_percentage?: string;
  [k: string]: unknown;
};

export type OrcaPoolSnapshot = {
  address?: string;
  whirlpoolsConfig?: string;
  tickSpacing?: number;
  feeRate?: number;
  feeTierIndex?: number;
  liquidity?: string;
  sqrtPrice?: string;
  tickCurrentIndex?: number;
  tokenMintA?: string;
  tokenVaultA?: string;
  tokenMintB?: string;
  tokenVaultB?: string;
  tokenA?: OrcaTokenSnapshot;
  tokenB?: OrcaTokenSnapshot;
  price?: string;
  tvlUsdc?: string;
  yieldOverTvl?: string;
  hasWarning?: boolean;
  poolType?: string;
  adaptiveFeeEnabled?: boolean;
  addressLookupTable?: string;
  lockedLiquidityPercent?: OrcaLockedLiquiditySnapshot[];
  stats?: Record<string, OrcaPoolStatsSnapshot>;
  [k: string]: unknown;
};

export type OrcaPoolsResponse = {
  data?: OrcaPoolSnapshot[];
  [k: string]: unknown;
};

export type OrcaSdkQuoteResponse = {
  estimatedAmountInAtomic: string;
  estimatedAmountOutAtomic: string;
  otherAmountThresholdAtomic: string;
  estimatedFeeAmountAtomic: string;
  sqrtPriceLimit: string;
  tickArrayAddresses: string[];
  aToB: boolean;
  amountSpecifiedIsInput: boolean;
};

export type OrcaBuiltSwapTransaction = {
  unsignedTransactionBase64: string;
  additionalSignerCount: number;
  lastValidBlockHeight: number | null;
};

export type OrcaSdkFacade = {
  quoteByInputPool(request: {
    rpcEndpoint: string;
    poolAddress: string;
    inputMint: string;
    amountAtomic: string;
    slippageBps: number;
  }): Promise<OrcaSdkQuoteResponse>;
  buildSwapTransaction(request: {
    rpcEndpoint: string;
    poolAddress: string;
    inputMint: string;
    amountAtomic: string;
    slippageBps: number;
    walletPublicKey: string;
  }): Promise<OrcaBuiltSwapTransaction>;
};

function normalizeOrcaPath(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function isVersionedTransaction(
  tx: Transaction | VersionedTransaction,
): tx is VersionedTransaction {
  return "version" in tx;
}

function serializeUnsignedTransactionBase64(input: {
  transaction: Transaction | VersionedTransaction;
  signers: Array<{
    publicKey: PublicKey;
    secretKey: Uint8Array;
  }>;
}): string {
  if (isVersionedTransaction(input.transaction)) {
    input.transaction.sign(input.signers);
    return Buffer.from(input.transaction.serialize()).toString("base64");
  }
  for (const signer of input.signers) {
    input.transaction.partialSign(signer);
  }
  return Buffer.from(
    input.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString("base64");
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseAtomicToUi(
  amountAtomic: string,
  decimals: number | null,
): number | null {
  const amount = readFiniteNumber(amountAtomic);
  if (amount === null || decimals === null) return null;
  return amount / 10 ** decimals;
}

function poolContainsMintPair(input: {
  pool: OrcaPoolSnapshot;
  inputMint: string;
  outputMint: string;
}): boolean {
  const mintA = readTrimmedString(input.pool.tokenMintA);
  const mintB = readTrimmedString(input.pool.tokenMintB);
  if (!mintA || !mintB) return false;
  return (
    (mintA === input.inputMint && mintB === input.outputMint) ||
    (mintA === input.outputMint && mintB === input.inputMint)
  );
}

function compareOrcaPoolPriority(
  a: OrcaPoolSnapshot,
  b: OrcaPoolSnapshot,
): number {
  const warningA = a.hasWarning === true ? 1 : 0;
  const warningB = b.hasWarning === true ? 1 : 0;
  if (warningA !== warningB) return warningA - warningB;
  const tvlA = readFiniteNumber(a.tvlUsdc) ?? 0;
  const tvlB = readFiniteNumber(b.tvlUsdc) ?? 0;
  if (tvlA !== tvlB) return tvlB - tvlA;
  const feeRateA = readFiniteNumber(a.feeRate) ?? 0;
  const feeRateB = readFiniteNumber(b.feeRate) ?? 0;
  if (feeRateA !== feeRateB) return feeRateA - feeRateB;
  return String(a.address ?? "").localeCompare(String(b.address ?? ""));
}

function computeOrcaPriceImpactPct(input: {
  pool: OrcaPoolSnapshot;
  inputMint: string;
  outputMint: string;
  estimatedAmountInAtomic: string;
  estimatedAmountOutAtomic: string;
}): number {
  const poolPrice = readFiniteNumber(input.pool.price);
  if (poolPrice === null || poolPrice <= 0) {
    return 0;
  }
  const decimalsA = readFiniteNumber(input.pool.tokenA?.decimals);
  const decimalsB = readFiniteNumber(input.pool.tokenB?.decimals);
  const inUi =
    input.inputMint === input.pool.tokenMintA
      ? parseAtomicToUi(input.estimatedAmountInAtomic, decimalsA)
      : parseAtomicToUi(input.estimatedAmountInAtomic, decimalsB);
  const outUi =
    input.outputMint === input.pool.tokenMintB
      ? parseAtomicToUi(input.estimatedAmountOutAtomic, decimalsB)
      : parseAtomicToUi(input.estimatedAmountOutAtomic, decimalsA);
  if (!inUi || !outUi) return 0;

  const executionPrice =
    input.inputMint === input.pool.tokenMintA &&
    input.outputMint === input.pool.tokenMintB
      ? outUi / inUi
      : inUi / outUi;
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
    return 0;
  }
  return Math.max(0, Math.abs((executionPrice - poolPrice) / poolPrice) * 100);
}

export function selectBestOrcaPoolSnapshot(input: {
  pools: OrcaPoolSnapshot[];
  inputMint: string;
  outputMint: string;
}): OrcaPoolSnapshot {
  const candidates = input.pools
    .filter(
      (pool) => pool.poolType === undefined || pool.poolType === "whirlpool",
    )
    .filter((pool) =>
      poolContainsMintPair({
        pool,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
      }),
    )
    .sort(compareOrcaPoolPriority);
  if (candidates.length < 1) {
    throw new Error("orca-whirlpool-pool-not-found");
  }
  return candidates[0] as OrcaPoolSnapshot;
}

export function normalizeOrcaQuoteResponse(input: {
  pool: OrcaPoolSnapshot;
  inputMint: string;
  outputMint: string;
  slippageBps: number;
  sdkQuote: OrcaSdkQuoteResponse;
}): JupiterQuoteResponse {
  return {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmount: input.sdkQuote.estimatedAmountInAtomic,
    outAmount: input.sdkQuote.estimatedAmountOutAtomic,
    otherAmountThreshold: input.sdkQuote.otherAmountThresholdAtomic,
    priceImpactPct: computeOrcaPriceImpactPct({
      pool: input.pool,
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      estimatedAmountInAtomic: input.sdkQuote.estimatedAmountInAtomic,
      estimatedAmountOutAtomic: input.sdkQuote.estimatedAmountOutAtomic,
    }),
    routePlan: [
      {
        poolId: input.pool.address,
        swapInfo: {
          label: "Orca Whirlpool",
          poolId: input.pool.address,
          inputMint: input.inputMint,
          outputMint: input.outputMint,
          feeRate: input.pool.feeRate,
          feeAmount: input.sdkQuote.estimatedFeeAmountAtomic,
        },
      },
    ],
    slippageBps: input.slippageBps,
    quoteProvider: "orca",
    orcaPoolSnapshot: input.pool,
    orcaQuote: input.sdkQuote,
  };
}

export function createOrcaSdkFacade(): OrcaSdkFacade {
  async function buildQuote(input: {
    rpcEndpoint: string;
    poolAddress: string;
    inputMint: string;
    amountAtomic: string;
    slippageBps: number;
    walletPublicKey: string;
  }) {
    const connection = new Connection(input.rpcEndpoint, "confirmed");
    const wallet = new ReadOnlyWallet(new PublicKey(input.walletPublicKey));
    const ctx = WhirlpoolContext.from(connection, wallet);
    const client = buildWhirlpoolClient(ctx);
    const pool = await client.getPool(new PublicKey(input.poolAddress));
    const quote = await swapQuoteByInputToken(
      pool,
      new PublicKey(input.inputMint),
      new BN(input.amountAtomic),
      Percentage.fromFraction(input.slippageBps, 10_000),
      ctx.program.programId,
      ctx.fetcher,
    );
    return { ctx, pool, quote };
  }

  return {
    async quoteByInputPool(request) {
      const { quote } = await buildQuote({
        ...request,
        walletPublicKey: PublicKey.default.toBase58(),
      });
      return {
        estimatedAmountInAtomic: quote.estimatedAmountIn.toString(),
        estimatedAmountOutAtomic: quote.estimatedAmountOut.toString(),
        otherAmountThresholdAtomic: quote.otherAmountThreshold.toString(),
        estimatedFeeAmountAtomic: quote.estimatedFeeAmount.toString(),
        sqrtPriceLimit: quote.sqrtPriceLimit.toString(),
        tickArrayAddresses: [
          quote.tickArray0.toBase58(),
          quote.tickArray1.toBase58(),
          quote.tickArray2.toBase58(),
        ],
        aToB: quote.aToB,
        amountSpecifiedIsInput: quote.amountSpecifiedIsInput,
      };
    },
    async buildSwapTransaction(request) {
      const { pool, quote } = await buildQuote(request);
      const txBuilder = await pool.swap(
        quote,
        new PublicKey(request.walletPublicKey),
      );
      const built = await txBuilder.build({
        maxSupportedTransactionVersion: 0,
        blockhashCommitment: "confirmed",
      });
      return {
        unsignedTransactionBase64: serializeUnsignedTransactionBase64({
          transaction: built.transaction,
          signers: built.signers,
        }),
        additionalSignerCount: built.signers.length,
        lastValidBlockHeight: built.recentBlockhash.lastValidBlockHeight,
      };
    },
  };
}

export class OrcaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sdk: OrcaSdkFacade;

  constructor(
    private readonly rpcEndpoint: string,
    private readonly apiBaseUrl = "https://api.orca.so",
    deps?: {
      fetch?: typeof fetch;
      sdk?: OrcaSdkFacade;
    },
  ) {
    const fetchImpl = deps?.fetch;
    this.fetchImpl = fetchImpl
      ? (input, init) => fetchImpl(input, init)
      : (input, init) => fetch(input, init);
    this.sdk = deps?.sdk ?? createOrcaSdkFacade();
  }

  async listPoolsByPair(request: {
    inputMint: string;
    outputMint: string;
    size?: number;
    statsWindow?: string;
  }): Promise<OrcaPoolSnapshot[]> {
    const url = new URL(normalizeOrcaPath("/v2/solana/pools"), this.apiBaseUrl);
    url.searchParams.set(
      "tokensBothOf",
      [request.inputMint, request.outputMint].join(","),
    );
    url.searchParams.set("size", String(request.size ?? 10));
    url.searchParams.set("sortBy", "tvl");
    url.searchParams.set("sortDirection", "desc");
    url.searchParams.set("stats", request.statsWindow ?? "24h");
    const response = await this.fetchImpl(url.toString(), { method: "GET" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `orca-pools-fetch-failed: ${response.status}${body ? ` ${body}` : ""}`,
      );
    }
    const payload = (await response.json()) as OrcaPoolsResponse;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("orca-pools-invalid-response");
    }
    if (!Array.isArray(payload.data)) {
      throw new Error("orca-pools-missing-data");
    }
    return payload.data;
  }

  async quoteBaseIn(request: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
  }): Promise<{
    pool: OrcaPoolSnapshot;
    sdkQuote: OrcaSdkQuoteResponse;
    normalizedQuote: JupiterQuoteResponse;
  }> {
    const pools = await this.listPoolsByPair({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
    });
    const pool = selectBestOrcaPoolSnapshot({
      pools,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
    });
    const poolAddress = readTrimmedString(pool.address);
    if (!poolAddress) {
      throw new Error("orca-whirlpool-pool-address-missing");
    }
    const sdkQuote = await this.sdk.quoteByInputPool({
      rpcEndpoint: this.rpcEndpoint,
      poolAddress,
      inputMint: request.inputMint,
      amountAtomic: request.amount,
      slippageBps: request.slippageBps,
    });
    return {
      pool,
      sdkQuote,
      normalizedQuote: normalizeOrcaQuoteResponse({
        pool,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        slippageBps: request.slippageBps,
        sdkQuote,
      }),
    };
  }

  async buildSwapTransaction(request: {
    quoteResponse: JupiterQuoteResponse;
    walletPublicKey: string;
  }): Promise<OrcaBuiltSwapTransaction> {
    const pool = (request.quoteResponse as Record<string, unknown>)
      ?.orcaPoolSnapshot as OrcaPoolSnapshot | null;
    if (!pool || typeof pool !== "object" || Array.isArray(pool)) {
      throw new Error("orca-pool-snapshot-missing");
    }
    const poolAddress = readTrimmedString(pool.address);
    if (!poolAddress) {
      throw new Error("orca-whirlpool-pool-address-missing");
    }
    return await this.sdk.buildSwapTransaction({
      rpcEndpoint: this.rpcEndpoint,
      poolAddress,
      inputMint: request.quoteResponse.inputMint,
      amountAtomic: String(request.quoteResponse.inAmount ?? ""),
      slippageBps: readFiniteNumber(request.quoteResponse.slippageBps) ?? 50,
      walletPublicKey: request.walletPublicKey,
    });
  }
}
