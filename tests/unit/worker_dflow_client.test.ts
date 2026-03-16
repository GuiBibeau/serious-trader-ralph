import { expect, test } from "bun:test";
import { DFlowClient } from "../../apps/worker/src/dflow";

test("DFlow client preserves versioned API base for market metadata routes", async () => {
  const requestUrls: string[] = [];
  const client = new DFlowClient(
    {
      metadataApiBase: "https://dev-prediction-markets-api.dflow.net/api/v1",
      apiKey: "test-key",
    },
    {
      fetch: (async (input) => {
        const url = String(input);
        requestUrls.push(url);
        if (url.includes("/markets/by-mint/")) {
          return new Response(
            JSON.stringify({
              market: {
                ticker: "PRES-2028",
                title: "Will candidate X win in 2028?",
                accounts: [],
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({
            markets: [
              {
                ticker: "PRES-2028",
                title: "Will candidate X win in 2028?",
                accounts: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch,
    },
  );

  await client.listPredictionMarkets({ status: "active", limit: 5 });
  await client.getPredictionMarketByMint(
    "YesMint1111111111111111111111111111111",
  );

  expect(requestUrls).toEqual([
    "https://dev-prediction-markets-api.dflow.net/api/v1/markets?status=active&limit=5",
    "https://dev-prediction-markets-api.dflow.net/api/v1/markets/by-mint/YesMint1111111111111111111111111111111",
  ]);
});

test("DFlow client uses trade and proof API bases for live prediction routes", async () => {
  const requests: Array<{ url: string; apiKey: string | null }> = [];
  const client = new DFlowClient(
    {
      metadataApiBase: "https://dev-prediction-markets-api.dflow.net/api/v1",
      tradeApiBase: "https://dev-quote-api.dflow.net",
      proofApiBase: "https://proof.dflow.net",
      apiKey: "test-key",
    },
    {
      fetch: (async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          apiKey:
            init?.headers && typeof init.headers === "object"
              ? String(
                  "x-api-key" in init.headers
                    ? init.headers["x-api-key" as keyof typeof init.headers]
                    : "",
                ) || null
              : null,
        });
        if (url.includes("/verify/")) {
          return new Response(JSON.stringify({ verified: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            transaction: "base64tx",
            executionMode: "sync",
            inAmount: "1000000",
            outAmount: "1900000",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch,
    },
  );

  const verification = await client.verifyPredictionWallet(
    "Wallet11111111111111111111111111111111111",
  );
  const order = await client.buildPredictionOrderTransaction({
    walletPublicKey: "Wallet11111111111111111111111111111111111",
    preview: {
      market: {
        marketId: "PRES-2028",
        title: "Will candidate X win in 2028?",
        eventTitle: "Election",
        status: "active",
        result: null,
        endTime: null,
        settleTime: null,
        accounts: [],
      },
      marketAccount: {
        accountId: "acct_1",
        yesMint: "YesMint1111111111111111111111111111111",
        noMint: "NoMint11111111111111111111111111111111",
        ledgerMint: "Ledger1111111111111111111111111111111",
        settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        scalarOutcomePct: null,
        yesBid: 0.49,
        yesAsk: 0.52,
        noBid: 0.47,
        noAsk: 0.51,
        volume: 2450,
        openInterest: 5000,
        redemptionStatus: "open",
        status: "active",
      },
      outcomeMint: "YesMint1111111111111111111111111111111",
      outcomeSide: "yes",
      side: "buy_yes",
      orderType: "market",
      timeInForce: "gtc",
      quantityMode: "notional",
      quantityAtomic: "1000000",
      settlementMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      priceQuote: 0.52,
      estimatedNotionalUsd: 1,
      liveReady: false,
      notes: [],
    },
  });

  expect(verification.verified).toBe(true);
  expect(order.transactionBase64).toBe("base64tx");
  expect(requests).toEqual([
    {
      url: "https://proof.dflow.net/verify/Wallet11111111111111111111111111111111111",
      apiKey: "test-key",
    },
    {
      url: "https://dev-quote-api.dflow.net/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=YesMint1111111111111111111111111111111&amount=1000000&userPublicKey=Wallet11111111111111111111111111111111111",
      apiKey: "test-key",
    },
  ]);
});
