import { expect, test } from "bun:test";
import { fetchHistoricalOhlcvRuntime } from "../../apps/worker/src/historical_ohlcv";
import type { Env } from "../../apps/worker/src/types";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const integrationTest = runIntegration ? test : test.skip;

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function createMockDb() {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };
}

integrationTest("worker historical ohlcv (live birdeye smoke)", async () => {
  if (!process.env.BIRDEYE_API_KEY) return;
  const env = {
    WAITLIST_DB: createMockDb() as never,
    BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY,
  } as Env;

  const result = await fetchHistoricalOhlcvRuntime(
    env,
    {
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
      lookbackHours: 72,
      limit: 48,
    },
    {
      dataSources: { priority: ["birdeye"] },
      requireMints: true,
    },
  );

  expect(result.bars.length).toBeGreaterThan(0);
  for (let i = 1; i < result.bars.length; i += 1) {
    const prev = result.bars[i - 1];
    const cur = result.bars[i];
    if (!prev || !cur) continue;
    expect(Date.parse(prev.ts)).toBeLessThanOrEqual(Date.parse(cur.ts));
    expect(prev.low).toBeLessThanOrEqual(prev.high);
    expect(cur.low).toBeLessThanOrEqual(cur.high);
  }
});
