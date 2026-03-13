import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  normalizeOrcaQuoteResponse,
  OrcaClient,
  selectBestOrcaPoolSnapshot,
} from "../../apps/worker/src/orca";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("worker orca client", () => {
  test("selects the healthiest high-TVL whirlpool for a mint pair", () => {
    const pool = selectBestOrcaPoolSnapshot({
      pools: [
        {
          address: "warning-pool",
          poolType: "whirlpool",
          tokenMintA: "mint-a",
          tokenMintB: "mint-b",
          tvlUsdc: "999999",
          hasWarning: true,
        },
        {
          address: "best-pool",
          poolType: "whirlpool",
          tokenMintA: "mint-a",
          tokenMintB: "mint-b",
          tvlUsdc: "500000",
          hasWarning: false,
        },
      ],
      inputMint: "mint-a",
      outputMint: "mint-b",
    });

    expect(pool.address).toBe("best-pool");
  });

  test("normalizes Orca whirlpool quotes into the shared spot quote shape", () => {
    const normalized = normalizeOrcaQuoteResponse({
      pool: {
        address: "pool-1",
        tokenMintA: "mint-a",
        tokenMintB: "mint-b",
        feeRate: 400,
        tickSpacing: 4,
        tickCurrentIndex: -12,
        liquidity: "999",
        price: "2.2",
        tvlUsdc: "10000",
        tokenA: { decimals: 6 },
        tokenB: { decimals: 6 },
        stats: { "24h": { volume: "1200" } },
      },
      inputMint: "mint-a",
      outputMint: "mint-b",
      sdkQuote: {
        estimatedAmountInAtomic: "1000",
        estimatedAmountOutAtomic: "2200",
        otherAmountThresholdAtomic: "2100",
        estimatedFeeAmountAtomic: "3",
        sqrtPriceLimit: "123",
        tickArrayAddresses: ["tick-0", "tick-1", "tick-2"],
        aToB: true,
        amountSpecifiedIsInput: true,
      },
    });

    expect(normalized).toMatchObject({
      inputMint: "mint-a",
      outputMint: "mint-b",
      inAmount: "1000",
      outAmount: "2200",
      otherAmountThreshold: "2100",
      quoteProvider: "orca",
    });
    expect(normalized.routePlan?.[0]?.swapInfo?.label).toBe("Orca Whirlpool");
    expect(
      (normalized as Record<string, unknown>).orcaPoolSnapshot,
    ).toBeTruthy();
  });

  test("quotes through the Orca pools API and injected SDK facade", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          data: [
            {
              address: "pool-1",
              poolType: "whirlpool",
              tokenMintA: "mint-a",
              tokenMintB: "mint-b",
              feeRate: 400,
              tickSpacing: 4,
              liquidity: "999",
              tickCurrentIndex: -12,
              tvlUsdc: "10000",
              hasWarning: false,
              tokenA: { decimals: 6 },
              tokenB: { decimals: 6 },
              price: "2.2",
              stats: { "24h": { volume: "1200" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const quoteByInputPool = mock(async () => ({
      estimatedAmountInAtomic: "1000",
      estimatedAmountOutAtomic: "2200",
      otherAmountThresholdAtomic: "2100",
      estimatedFeeAmountAtomic: "3",
      sqrtPriceLimit: "123",
      tickArrayAddresses: ["tick-0", "tick-1", "tick-2"],
      aToB: true,
      amountSpecifiedIsInput: true,
    }));

    const client = new OrcaClient(
      "https://rpc.orca.test",
      "https://api.orca.test",
      {
        sdk: {
          quoteByInputPool,
          buildSwapTransaction: mock(async () => ({
            unsignedTransactionBase64: "unsigned",
            additionalSignerCount: 1,
            lastValidBlockHeight: 42,
          })),
        },
      },
    );
    const quote = await client.quoteBaseIn({
      inputMint: "mint-a",
      outputMint: "mint-b",
      amount: "1000",
      slippageBps: 50,
    });

    expect(requests).toEqual([
      "https://api.orca.test/v2/solana/pools?tokensBothOf=mint-a%2Cmint-b&size=10&sortBy=tvl&sortDirection=desc&stats=24h",
    ]);
    expect(quote.pool.address).toBe("pool-1");
    expect(quote.normalizedQuote.outAmount).toBe("2200");
    expect(quoteByInputPool).toHaveBeenCalledTimes(1);
  });

  test("rebuilds swap transactions from the normalized quote metadata", async () => {
    const buildSwapTransaction = mock(async () => ({
      unsignedTransactionBase64: "unsigned-base64",
      additionalSignerCount: 1,
      lastValidBlockHeight: 55,
    }));

    const client = new OrcaClient(
      "https://rpc.orca.test",
      "https://api.orca.test",
      {
        sdk: {
          quoteByInputPool: mock(async () => ({
            estimatedAmountInAtomic: "1000",
            estimatedAmountOutAtomic: "2200",
            otherAmountThresholdAtomic: "2100",
            estimatedFeeAmountAtomic: "3",
            sqrtPriceLimit: "123",
            tickArrayAddresses: ["tick-0", "tick-1", "tick-2"],
            aToB: true,
            amountSpecifiedIsInput: true,
          })),
          buildSwapTransaction,
        },
      },
    );

    const built = await client.buildSwapTransaction({
      walletPublicKey: "wallet-1",
      quoteResponse: {
        inputMint: "mint-a",
        outputMint: "mint-b",
        inAmount: "1000",
        outAmount: "2200",
        slippageBps: 50,
        orcaPoolSnapshot: {
          address: "pool-1",
        },
      },
    });

    expect(built.unsignedTransactionBase64).toBe("unsigned-base64");
    expect(buildSwapTransaction).toHaveBeenCalledWith({
      rpcEndpoint: "https://rpc.orca.test",
      poolAddress: "pool-1",
      inputMint: "mint-a",
      amountAtomic: "1000",
      slippageBps: 50,
      walletPublicKey: "wallet-1",
    });
  });
});
