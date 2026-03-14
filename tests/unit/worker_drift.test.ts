import { describe, expect, mock, test } from "bun:test";
import { DriftClient } from "../../apps/worker/src/drift";

describe("worker Drift client", () => {
  test("describes perp intents from the Drift data API and preserves Swift availability", async () => {
    const fetchMock = mock(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://drift.test/contracts") {
        return new Response(
          JSON.stringify({
            contracts: [
              {
                marketName: "SOL-PERP",
                marketIndex: 2,
                oracle: "oracle-sol",
                oracleSource: "pyth",
                status: "active",
                contractType: "perp",
                initialMarginRatio: 1000,
                maintenanceMarginRatio: 500,
              },
            ],
          }),
        );
      }
      if (url === "https://drift.test/fundingRates?marketName=SOL-PERP") {
        return new Response(
          JSON.stringify({
            fundingRates: [
              {
                marketName: "SOL-PERP",
                fundingRate: 0.00012,
                oraclePrice: 153.25,
                markPrice: 153.3,
                ts: "2026-03-13T23:59:00.000Z",
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const client = new DriftClient(
      {
        dataApiBase: "https://drift.test",
        swiftApiBase: "https://swift.test",
      },
      { fetch: fetchMock as typeof fetch },
    );
    const preview = await client.describePerpIntent({
      instrumentId: "sol-perp",
      side: "long",
      quantityAtomic: "1000000",
      collateralAtomic: "250000",
      options: {
        orderType: "limit",
        timeInForce: "gtc",
        limitPriceAtomic: "155000000",
      },
      executionAdapter: "drift_swift",
    });

    expect(preview.instrument.marketName).toBe("SOL-PERP");
    expect(preview.instrument.marketIndex).toBe(2);
    expect(preview.funding?.fundingRate1hBps).toBe(1.2);
    expect(preview.limitPriceAtomic).toBe("155000000");
    expect(preview.swiftSupported).toBe(true);
  });
});
