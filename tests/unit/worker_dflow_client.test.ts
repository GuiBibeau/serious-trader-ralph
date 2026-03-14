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
