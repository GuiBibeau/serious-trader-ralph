import { afterEach, describe, expect, test } from "bun:test";
import {
  normalizeRaydiumQuoteResponse,
  RaydiumClient,
} from "../../apps/worker/src/raydium";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("worker raydium client", () => {
  test("normalizes Raydium quote responses into the shared spot quote shape", () => {
    const normalized = normalizeRaydiumQuoteResponse({
      id: "quote-1",
      success: true,
      data: {
        swapType: "BaseIn",
        inputMint: "mint-in",
        inputAmount: "1000",
        outputMint: "mint-out",
        outputAmount: "2200",
        otherAmountThreshold: "2100",
        slippageBps: 50,
        priceImpactPct: "0.003",
        routePlan: [
          {
            poolId: "pool-1",
            inputMint: "mint-in",
            outputMint: "mint-out",
            feeMint: "mint-in",
            feeRate: 25,
            feeAmount: "3",
          },
        ],
      },
    });

    expect(normalized).toMatchObject({
      inputMint: "mint-in",
      outputMint: "mint-out",
      inAmount: "1000",
      outAmount: "2200",
      otherAmountThreshold: "2100",
      slippageBps: 50,
      priceImpactPct: 0.003,
      quoteProvider: "raydium",
    });
    expect(normalized.routePlan?.[0]?.swapInfo?.label).toBe("Raydium");
    expect(
      (normalized as Record<string, unknown>).raydiumQuoteEnvelope,
    ).toBeTruthy();
  });

  test("quotes and builds swap transactions against Raydium's HTTP APIs", async () => {
    const requests: Array<{ url: string; body: string | null }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({
        url,
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (url.startsWith("https://tx.raydium.test/compute/swap-base-in")) {
        return new Response(
          JSON.stringify({
            id: "quote-1",
            success: true,
            data: {
              swapType: "BaseIn",
              inputMint: "mint-in",
              inputAmount: "1000",
              outputMint: "mint-out",
              outputAmount: "2200",
              otherAmountThreshold: "2100",
              slippageBps: 50,
              priceImpactPct: 0,
              routePlan: [
                {
                  poolId: "pool-1",
                  feeAmount: "3",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://api.raydium.test/main/auto-fee") {
        return new Response(
          JSON.stringify({
            id: "fee-1",
            success: true,
            data: {
              default: {
                m: 12000,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://tx.raydium.test/transaction/swap-base-in") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          computeUnitPriceMicroLamports?: string;
          swapResponse?: { id?: string };
          wallet?: string;
        };
        expect(body.computeUnitPriceMicroLamports).toBe("12000");
        expect(body.swapResponse?.id).toBe("quote-1");
        expect(body.wallet).toBe("wallet-1");
        return new Response(
          JSON.stringify({
            id: "tx-1",
            success: true,
            data: [
              {
                transaction: "unsigned-tx-1",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected-route", { status: 500 });
    }) as typeof fetch;

    const client = new RaydiumClient(
      "https://api.raydium.test",
      "https://tx.raydium.test",
    );
    const quote = await client.quoteBaseIn({
      inputMint: "mint-in",
      outputMint: "mint-out",
      amount: "1000",
      slippageBps: 50,
    });
    const built = await client.buildSwapTransactions({
      quoteEnvelope: quote.envelope,
      wallet: "wallet-1",
      wrapSol: false,
      unwrapSol: false,
    });

    expect(quote.normalizedQuote.outAmount).toBe("2200");
    expect(built.transactions).toEqual(["unsigned-tx-1"]);
    expect(built.computeUnitPriceMicroLamports).toBe("12000");
    expect(requests.map((entry) => entry.url)).toEqual([
      "https://tx.raydium.test/compute/swap-base-in?inputMint=mint-in&outputMint=mint-out&amount=1000&slippageBps=50&txVersion=V0",
      "https://api.raydium.test/main/auto-fee",
      "https://tx.raydium.test/transaction/swap-base-in",
    ]);
  });
});
