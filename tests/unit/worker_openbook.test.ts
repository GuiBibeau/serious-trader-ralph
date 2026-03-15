import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import {
  buildOpenBookMarketAccountFilters,
  buildOpenBookSyntheticQuote,
  OPENBOOK_MARKET_ACCOUNT_LAYOUT,
  OpenBookClient,
  resolveOpenBookOrderRequest,
} from "../../apps/worker/src/openbook";

const MARKET = {
  instrumentId: "SOL/USDC",
  marketAddress: "market-1",
  baseMint: "mint-base",
  quoteMint: "mint-quote",
  baseDecimals: 9,
  quoteDecimals: 6,
  bestBidPriceUi: 149.5,
  bestAskPriceUi: 150,
  bestBidSizeUi: 2,
  bestAskSizeUi: 3,
  spreadBps: 33,
  tickSizeUi: "0.01",
  minOrderSizeUi: "0.001",
  openOrdersAdminRequired: false,
  consumeEventsAdminRequired: false,
  closeMarketAdminRequired: false,
} as const;

describe("worker openbook helpers", () => {
  test("resolves limit buy requests into normalized order parameters", () => {
    const request = resolveOpenBookOrderRequest({
      market: MARKET,
      side: "buy",
      quantityAtomic: "250000000",
      options: {
        orderType: "limit",
        timeInForce: "gtc",
        limitPriceAtomic: "150000000",
        clientOrderId: "42",
      },
    });

    expect(request).toMatchObject({
      side: "buy",
      orderType: "limit",
      timeInForce: "gtc",
      postOnly: false,
      quantityAtomic: "250000000",
      limitPriceAtomic: "150000000",
      clientOrderId: "42",
    });
    expect(request.quantityBaseUi).toBe(0.25);
    expect(request.estimatedQuoteUi).toBe(37.5);
    expect(request.estimatedQuoteAtomic).toBe("37500000");
  });

  test("builds a synthetic quote preview for OpenBook buy orders", () => {
    const request = resolveOpenBookOrderRequest({
      market: MARKET,
      side: "buy",
      quantityAtomic: "1000000000",
      options: {
        orderType: "limit",
        limitPriceAtomic: "151000000",
      },
    });
    const quote = buildOpenBookSyntheticQuote({
      market: MARKET,
      request,
    });

    expect(quote).toMatchObject({
      inputMint: "mint-quote",
      outputMint: "mint-base",
      outAmount: "1000000000",
    });
    expect(quote.routePlan?.[0]?.swapInfo?.label).toBe("OpenBook v2");
  });

  test("fails closed when the opposite side of book is missing", () => {
    expect(() =>
      resolveOpenBookOrderRequest({
        market: {
          ...MARKET,
          bestAskPriceUi: null,
        },
        side: "buy",
        quantityAtomic: "1000000000",
        options: {
          orderType: "market",
        },
      }),
    ).toThrow(/openbook-orderbook-liquidity-missing/);
  });

  test("builds market account filters with the live layout offsets", () => {
    const filters = buildOpenBookMarketAccountFilters({
      baseMintAddress: new PublicKey(
        "So11111111111111111111111111111111111111112",
      ),
      quoteMintAddress: new PublicKey(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    });

    expect(filters[0]).toEqual({
      dataSize: OPENBOOK_MARKET_ACCOUNT_LAYOUT.dataSize,
    });
    expect(filters[2]).toEqual({
      memcmp: {
        offset: OPENBOOK_MARKET_ACCOUNT_LAYOUT.baseMintOffset,
        bytes: "So11111111111111111111111111111111111111112",
      },
    });
    expect(filters[3]).toEqual({
      memcmp: {
        offset: OPENBOOK_MARKET_ACCOUNT_LAYOUT.quoteMintOffset,
        bytes: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      },
    });
  });

  test("delegates place-order plan building through the injected SDK facade", async () => {
    const buildPlaceOrderPlan = mock(async () => ({
      unsignedTransactionBase64: "unsigned",
      lastValidBlockHeight: 55,
      market: MARKET,
      prerequisites: {
        openOrdersIndexer: "indexer-1",
        openOrdersAccount: "oo-1",
        userBaseAccount: "base-ata",
        userQuoteAccount: "quote-ata",
        userFundingAccount: "quote-ata",
        createdOpenOrdersIndexer: true,
        createdOpenOrdersAccount: true,
      },
      request: resolveOpenBookOrderRequest({
        market: MARKET,
        side: "buy",
        quantityAtomic: "1000000000",
        options: { orderType: "limit", limitPriceAtomic: "151000000" },
      }),
      quotePreview: {
        inputMint: "mint-quote",
        outputMint: "mint-base",
        inAmount: "151000000",
        outAmount: "1000000000",
      },
    }));

    const client = new OpenBookClient("https://rpc.test", "program-1", {
      sdk: {
        buildPlaceOrderPlan,
        buildCancelOrderPlan: mock(async () => {
          throw new Error("unused");
        }),
        buildReplaceOrderPlan: mock(async () => {
          throw new Error("unused");
        }),
        listOpenOrders: mock(async () => {
          throw new Error("unused");
        }),
      },
    });

    const plan = await client.buildPlaceOrderPlan({
      walletPublicKey: "11111111111111111111111111111111",
      instrumentId: "SOL/USDC",
      side: "buy",
      quantityAtomic: "1000000000",
      options: { orderType: "limit", limitPriceAtomic: "151000000" },
    });

    expect(plan.prerequisites.openOrdersAccount).toBe("oo-1");
    expect(buildPlaceOrderPlan).toHaveBeenCalledTimes(1);
  });
});
