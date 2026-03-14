import { expect, test } from "bun:test";
import type { RalphConfig } from "../../src/config/config.js";
import { SessionJournal, TradeJournal } from "../../src/journal/index.js";
import { JupiterClient } from "../../src/jupiter/client.js";
import type { SolanaAdapter } from "../../src/solana/adapter.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { registerDefaultTools } from "../../src/tools/tools.js";

const stubConfig: RalphConfig = {
  rpc: { endpoint: "http://localhost:8899" },
  wallet: {},
  jupiter: { apiKey: "test", baseUrl: "https://api.jup.ag" },
  solana: { sdkMode: "web3" },
  llm: {
    provider: "openai_chat",
    baseUrl: "https://api.z.ai/api/paas/v4",
    apiKey: "test",
    model: "glm-4.7",
  },
  autopilot: { enabled: false, intervalMs: 15000 },
  gateway: { bind: "127.0.0.1", port: 8787, authToken: "test" },
  tools: { skillsDir: "skills" },
  openclaw: {},
  notify: {},
  runtime: {
    sessionsDir: "sessions",
    runsDir: "runs",
    lanes: { main: 1, subagent: 4, autopilot: 1 },
  },
  agents: {
    defaultAgentId: "main",
    agents: {},
  },
  policy: {
    killSwitch: false,
    allowedMints: [],
    maxTradeAmountLamports: "0",
    maxSlippageBps: 50,
    maxPriceImpactPct: 1,
    cooldownSeconds: 30,
  },
};

const stubSolana: SolanaAdapter = {
  getPublicKey: () => "11111111111111111111111111111111",
  getSolBalanceLamports: async () => "0",
  getSplBalances: async () => [],
  getLatestBlockhash: async () => ({
    blockhash: "111",
    lastValidBlockHeight: 0,
  }),
  signRawTransaction: async (tx) => tx,
  sendAndConfirmRawTx: async () => ({ signature: "sig" }),
};

function buildRegistry() {
  const registry = new ToolRegistry();
  const jupiter = new JupiterClient(
    stubConfig.jupiter.baseUrl,
    stubConfig.jupiter.apiKey,
  );
  registerDefaultTools(registry, jupiter);
  const ctx = {
    config: stubConfig,
    solana: stubSolana,
    sessionJournal: new SessionJournal("test", ".tmp/sessions"),
    tradeJournal: new TradeJournal(".tmp/trades"),
  };
  return { registry, ctx };
}

test("market.prediction_markets_list supports DFlow discovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DFLOW_METADATA_API_BASE;
  let requestUrl = "";
  globalThis.fetch = (async (input) => {
    requestUrl = String(input);
    return new Response(
      JSON.stringify({
        markets: [
          {
            ticker: "PRES-2028",
            title: "Will candidate X win in 2028?",
            endTime: "2028-11-06T08:00:00.000Z",
            accounts: [
              {
                yesMint: "YesMint1111111111111111111111111111111",
                noMint: "NoMint11111111111111111111111111111111",
                settlementMint: "USDCMint11111111111111111111111111111",
                yesBid: 0.49,
                yesAsk: 0.52,
                noBid: 0.47,
                noAsk: 0.51,
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    process.env.DFLOW_METADATA_API_BASE =
      "https://dev-prediction-markets-api.dflow.net/api/v1";
    const { registry, ctx } = buildRegistry();
    const result = (await registry.invoke(
      "market.prediction_markets_list",
      ctx,
      {
        venue: "dflow",
      },
    )) as {
      markets: Array<{ id: string; yesMint: string; noMint: string }>;
    };

    expect(result.markets[0]?.id).toBe("PRES-2028");
    expect(result.markets[0]?.yesMint).toBe(
      "YesMint1111111111111111111111111111111",
    );
    expect(result.markets[0]?.noMint).toBe(
      "NoMint11111111111111111111111111111111",
    );
    expect(requestUrl).toBe(
      "https://dev-prediction-markets-api.dflow.net/api/v1/markets?status=active&limit=200",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.DFLOW_METADATA_API_BASE;
    } else {
      process.env.DFLOW_METADATA_API_BASE = originalBaseUrl;
    }
  }
});

test("market.prediction_market_quote falls back to market list when DFlow by-mint lookup misses", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DFLOW_METADATA_API_BASE;
  const requestUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requestUrls.push(url);
    if (url.includes("/markets/by-mint/")) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        markets: [
          {
            ticker: "PRES-2028",
            title: "Will candidate X win in 2028?",
            accounts: [
              {
                yesMint: "YesMint1111111111111111111111111111111",
                noMint: "NoMint11111111111111111111111111111111",
                settlementMint: "USDCMint11111111111111111111111111111",
                yesBid: 0.49,
                yesAsk: 0.52,
                noBid: 0.47,
                noAsk: 0.51,
                openInterest: 5000,
                volume: 2450,
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    process.env.DFLOW_METADATA_API_BASE =
      "https://dev-prediction-markets-api.dflow.net/api/v1";
    const { registry, ctx } = buildRegistry();
    const result = (await registry.invoke(
      "market.prediction_market_quote",
      ctx,
      {
        venue: "dflow",
        marketId: "PRES-2028",
      },
    )) as { yesPrice: string; noPrice: string; liquidity: string };

    expect(result.yesPrice).toBe("0.52");
    expect(result.noPrice).toBe("0.51");
    expect(result.liquidity).toBe("7450");
    expect(requestUrls).toEqual([
      "https://dev-prediction-markets-api.dflow.net/api/v1/markets/by-mint/PRES-2028",
      "https://dev-prediction-markets-api.dflow.net/api/v1/markets?status=active&limit=200",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.DFLOW_METADATA_API_BASE;
    } else {
      process.env.DFLOW_METADATA_API_BASE = originalBaseUrl;
    }
  }
});
