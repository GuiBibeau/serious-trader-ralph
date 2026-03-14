import { describe, expect, test } from "bun:test";
import { normalizePolicy } from "../../apps/worker/src/policy";
import type { Env } from "../../apps/worker/src/types";

const { executeMangoIntent } = await import(
  "../../apps/worker/src/execution/mango_executor"
);

function buildAccountSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "v1",
    snapshotId: "margin_mango_sol_1",
    venueKey: "mango",
    accountRef: "mango-account-1",
    capturedAt: "2026-03-14T05:00:00Z",
    marketTypes: ["spot", "perp"],
    equityQuote: "12450.25",
    initHealthQuote: "3250.50",
    maintHealthQuote: "2110.25",
    initHealthRatioPct: "26.10",
    maintHealthRatioPct: "16.95",
    usedMarginQuote: "4200.00",
    freeCollateralQuote: "8250.25",
    liquidationBufferPct: "12.35",
    liquidationRiskLevel: "warning",
    beingLiquidated: false,
    isOperational: true,
    positions: [
      {
        instrumentId: "SOL-PERP",
        marketType: "perp",
        side: "long",
        quantityAtomic: "1000000",
        collateralAtomic: "250000",
        notionalQuote: "155.20",
        entryPriceQuote: "154.90",
        markPriceQuote: "155.20",
        unsettledPnlQuote: "0.30",
        reduceOnly: false,
        notes: ["bounded-preview"],
      },
    ],
    oracles: [
      {
        instrumentId: "SOL-PERP",
        provider: "pyth",
        status: "healthy",
        priceQuote: "155.20",
        confidencePct: "0.15",
        lastUpdatedSlot: 345,
        lastUpdatedAt: "2026-03-14T04:59:58Z",
        notes: ["fresh"],
      },
    ],
    tags: ["mango", "paper"],
    ...overrides,
  };
}

function buildSpotIntent() {
  return {
    family: "clob_order" as const,
    wallet: "11111111111111111111111111111111",
    venueKey: "mango" as const,
    marketType: "spot" as const,
    instrumentId: "SOL/USDC",
    side: "buy",
    quantityAtomic: "1000000",
    params: {
      orderType: "limit",
      limitPriceAtomic: "155000000",
      marketSnapshot: {
        instrumentId: "SOL/USDC",
        marketType: "spot",
        marketName: "SOL/USDC",
        orderbookSource: "openbook_v2",
        oracleProvider: "pyth",
        status: "active",
        referencePriceQuote: 155.2,
        initialMarginRatio: 0.1,
        maintenanceMarginRatio: 0.05,
      },
      accountSnapshot: buildAccountSnapshot({
        oracles: [
          {
            instrumentId: "SOL/USDC",
            provider: "pyth",
            status: "healthy",
            priceQuote: "155.20",
            confidencePct: "0.15",
            lastUpdatedSlot: 345,
            lastUpdatedAt: "2026-03-14T04:59:58Z",
            notes: ["fresh"],
          },
        ],
      }),
    },
  };
}

function buildPerpIntent() {
  return {
    family: "perp_order" as const,
    wallet: "11111111111111111111111111111111",
    venueKey: "mango" as const,
    marketType: "perp" as const,
    instrumentId: "SOL-PERP",
    side: "long" as const,
    quantityAtomic: "1000000",
    collateralAtomic: "250000",
    params: {
      orderType: "limit",
      limitPriceAtomic: "155000000",
      marketSnapshot: {
        instrumentId: "SOL-PERP",
        marketType: "perp",
        marketName: "SOL-PERP",
        orderbookSource: "mango_perp",
        oracleProvider: "pyth",
        status: "active",
        referencePriceQuote: 155.2,
        initialMarginRatio: 0.1,
        maintenanceMarginRatio: 0.05,
      },
      accountSnapshot: buildAccountSnapshot(),
    },
  };
}

describe("worker Mango execution adapter", () => {
  test("returns dry_run for bounded Mango spot margin orders", async () => {
    const result = await executeMangoIntent({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      intent: buildSpotIntent(),
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.executionMeta?.route).toBe("mango");
    expect(result.executionMeta?.lifecycle?.orderState).toBe("open");
  });

  test("simulates Mango perp intents in paper mode", async () => {
    const result = await executeMangoIntent({
      env: {} as Env,
      runtimeMode: "paper",
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      intent: buildPerpIntent(),
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.executionMeta?.referencePrice?.snapshot?.marketType).toBe(
      "perp",
    );
    expect(result.executionMeta?.lifecycle?.positionState).toBe("opening");
  });

  test("fails closed when the Mango account snapshot is missing", async () => {
    const intent = buildPerpIntent();
    intent.params = {
      ...intent.params,
      accountSnapshot: undefined,
    };

    await expect(
      executeMangoIntent({
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent,
        log: () => {},
      }),
    ).rejects.toThrow(/mango-account-snapshot-missing/);
  });

  test("requires a healthy oracle on the traded Mango instrument", async () => {
    const intent = buildPerpIntent();
    intent.params = {
      ...intent.params,
      accountSnapshot: buildAccountSnapshot({
        oracles: [
          {
            instrumentId: "BTC-PERP",
            provider: "pyth",
            status: "healthy",
            priceQuote: "72000.10",
            confidencePct: "0.10",
            lastUpdatedSlot: 345,
            lastUpdatedAt: "2026-03-14T04:59:58Z",
            notes: ["fresh"],
          },
          {
            instrumentId: "SOL-PERP",
            provider: "pyth",
            status: "stale",
            priceQuote: "155.20",
            confidencePct: "0.15",
            lastUpdatedSlot: 300,
            lastUpdatedAt: "2026-03-14T04:30:00Z",
            notes: ["stale"],
          },
        ],
      }),
    };

    await expect(
      executeMangoIntent({
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent,
        log: () => {},
      }),
    ).rejects.toThrow(/mango-oracle-health-missing/);
  });

  test("rejects malformed Mango sides that bypass submit-contract parsing", async () => {
    const intent = buildPerpIntent() as unknown as {
      side: string;
      family: "perp_order";
      marketType: "perp";
    };
    intent.side = "buy";

    await expect(
      executeMangoIntent({
        env: {} as Env,
        runtimeMode: "paper",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: intent as never,
        log: () => {},
      }),
    ).rejects.toThrow(/invalid-mango-perp-side/);
  });

  test("rejects live mode for Mango rollout", async () => {
    await expect(
      executeMangoIntent({
        env: {} as Env,
        runtimeMode: "live",
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        intent: buildPerpIntent(),
        log: () => {},
      }),
    ).rejects.toThrow(/mango-live-mode-not-supported/);
  });
});
