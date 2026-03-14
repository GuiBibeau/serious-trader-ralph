import { describe, expect, test } from "bun:test";
import {
  amendOpenOrder,
  cancelAllOpenOrders,
  cancelOpenOrder,
  executeOpenOrderSlice,
  mapTerminalOpenOrderSnapshot,
  type OpenOrderRow,
  promotePendingOrders,
  queueOpenOrder,
} from "../../apps/portal/app/terminal/components/open-orders";
import type { QueuedTerminalOrder } from "../../apps/portal/app/terminal/components/trade-ticket-modal";

function queuedOrder(
  overrides?: Partial<QueuedTerminalOrder>,
): QueuedTerminalOrder {
  return {
    id: overrides?.id ?? "order_1",
    createdAt: overrides?.createdAt ?? 1000,
    updatedAt: overrides?.updatedAt ?? 1000,
    pairId: overrides?.pairId ?? "SOL/USDC",
    direction: overrides?.direction ?? "buy",
    source: overrides?.source ?? "TERMINAL",
    reason: overrides?.reason ?? "test order",
    orderType: overrides?.orderType ?? "limit",
    timeInForce: overrides?.timeInForce ?? "gtc",
    amountUi: overrides?.amountUi ?? "2",
    remainingAmountUi: overrides?.remainingAmountUi ?? "2",
    slippageBps: overrides?.slippageBps ?? 50,
    lane: overrides?.lane ?? "safe",
    simulationPreference: overrides?.simulationPreference ?? "auto",
    priorityLevel: overrides?.priorityLevel ?? "normal",
    limitPriceUi: overrides?.limitPriceUi ?? "100",
    triggerPriceUi: overrides?.triggerPriceUi ?? null,
  };
}

describe("portal terminal open orders lifecycle", () => {
  test("queues then promotes pending orders", () => {
    const queued = queueOpenOrder([], queuedOrder());
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("pending");

    const promoted = promotePendingOrders(queued, 3000, 1000);
    expect(promoted[0]?.status).toBe("working");
  });

  test("amend validates amount and price", () => {
    const current: OpenOrderRow[] = queueOpenOrder([], queuedOrder());
    const invalid = amendOpenOrder({
      current,
      orderId: "order_1",
      amountUi: "0",
      priceUi: "100",
      now: 4000,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.next[0]?.lastError).toBe("invalid-amend-amount");

    const valid = amendOpenOrder({
      current,
      orderId: "order_1",
      amountUi: "1.5",
      priceUi: "101.25",
      now: 5000,
    });
    expect(valid.ok).toBe(true);
    expect(valid.next[0]?.remainingAmountUi).toBe("1.5");
    expect(valid.next[0]?.limitPriceUi).toBe("101.25");
    expect(valid.next[0]?.status).toBe("working");
  });

  test("execute slice updates remaining and supports cancel actions", () => {
    const current = queueOpenOrder(
      [],
      queuedOrder({ amountUi: "4", remainingAmountUi: "4" }),
    );
    const slice = executeOpenOrderSlice({
      current,
      orderId: "order_1",
      fraction: 0.5,
      now: 6000,
    });
    expect(slice.ok).toBe(true);
    if (!slice.ok) return;
    expect(slice.executeAmountUi).toBe("2");
    expect(slice.next[0]?.remainingAmountUi).toBe("2");
    expect(slice.next[0]?.status).toBe("partial");

    const cancelled = cancelOpenOrder(slice.next, "order_1", 7000);
    expect(cancelled[0]?.status).toBe("cancelled");

    const queuedTwo = queueOpenOrder(
      slice.next,
      queuedOrder({ id: "order_2" }),
    );
    const cancelledAll = cancelAllOpenOrders(queuedTwo, 8000);
    expect(cancelledAll.every((order) => order.status === "cancelled")).toBe(
      true,
    );
  });

  test("rejects execute for cancelled or failed orders", () => {
    const cancelledCurrent = cancelOpenOrder(
      queueOpenOrder([], queuedOrder()),
      "order_1",
      9000,
    );
    const cancelledAttempt = executeOpenOrderSlice({
      current: cancelledCurrent,
      orderId: "order_1",
      fraction: 1,
      now: 9100,
    });
    expect(cancelledAttempt.ok).toBe(false);
    if (cancelledAttempt.ok) return;
    expect(cancelledAttempt.error).toBe("order-not-executable");
    expect(cancelledAttempt.next[0]?.status).toBe("cancelled");

    const queuedFailed = queueOpenOrder([], queuedOrder());
    const firstFailed = queuedFailed[0];
    if (!firstFailed) throw new Error("expected queued order");
    const failedCurrent: OpenOrderRow[] = [
      {
        ...firstFailed,
        status: "failed",
        lastError: "test-failure",
      },
    ];
    const failedAttempt = executeOpenOrderSlice({
      current: failedCurrent,
      orderId: "order_1",
      fraction: 0.5,
      now: 9200,
    });
    expect(failedAttempt.ok).toBe(false);
    if (failedAttempt.ok) return;
    expect(failedAttempt.error).toBe("order-not-executable");
    expect(failedAttempt.next[0]?.status).toBe("failed");
  });

  test("hydrates remote Trigger snapshots into open-order rows", () => {
    const row = mapTerminalOpenOrderSnapshot({
      requestId: "execreq_trigger_row_123456",
      requestStatus: "dispatched",
      terminal: false,
      receivedAt: "2026-03-03T02:00:00.000Z",
      updatedAt: "2026-03-03T02:00:03.000Z",
      terminalAt: null,
      pairId: "SOL/USDC",
      direction: "buy",
      source: "TERMINAL",
      reason: "Hydrated order",
      orderType: "limit",
      timeInForce: "gtc",
      lane: "safe",
      simulationPreference: "always",
      priorityLevel: "high",
      priorityMicroLamports: 50_000,
      slippageBps: 50,
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      amountAtomic: "1000000",
      remainingAmountAtomic: "750000",
      takingAmountAtomic: "6666666",
      filledInputAtomic: "250000",
      filledOutputAtomic: "1666666",
      limitPriceAtomic: "150000000",
      triggerPriceAtomic: null,
      provider: "jupiter",
      signature: null,
      errorCode: null,
      errorMessage: null,
      status: "working",
      lifecycle: {
        orderState: "open",
        fillState: "pending",
        settlementState: "confirmed",
        notes: ["Open"],
      },
    });

    expect(row?.id).toBe("execreq_trigger_row_123456");
    expect(row?.requestId).toBe("execreq_trigger_row_123456");
    expect(row?.status).toBe("working");
    expect(row?.amountUi).toBe("1");
    expect(row?.remainingAmountUi).toBe("0.75");
    expect(row?.limitPriceUi).toBe("150");
    expect(row?.venueKey).toBe("jupiter");
    expect(row?.intentFamily).toBe("conditional_spot_order");
    expect(row?.lifecycle?.orderState).toBe("open");
  });

  test("hydrates venue-aware non-pair snapshots without forcing pair support", () => {
    const row = mapTerminalOpenOrderSnapshot({
      requestId: "execreq_drift_row_123456",
      requestStatus: "dispatched",
      terminal: false,
      receivedAt: "2026-03-03T02:00:00.000Z",
      updatedAt: "2026-03-03T02:00:03.000Z",
      terminalAt: null,
      intentFamily: "perp_order",
      venueKey: "drift",
      marketType: "perp",
      pairId: null,
      instrumentId: "SOL-PERP",
      instrumentLabel: "SOL-PERP",
      direction: "sell",
      source: "TERMINAL",
      reason: "Hydrated perp order",
      orderType: "limit",
      timeInForce: "gtc",
      lane: "safe",
      simulationPreference: "always",
      priorityLevel: "high",
      priorityMicroLamports: 50_000,
      slippageBps: 25,
      inputMint: null,
      outputMint: null,
      amountAtomic: "10",
      remainingAmountAtomic: "4",
      takingAmountAtomic: null,
      filledInputAtomic: "6",
      filledOutputAtomic: "0",
      limitPriceAtomic: "150000000",
      triggerPriceAtomic: null,
      provider: "drift",
      providerStatus: "healthy",
      signature: null,
      errorCode: null,
      errorMessage: null,
      status: "working",
      oracleStatus: {
        freshnessMs: 450,
        source: "pyth",
        stale: false,
      },
      lifecycle: {
        orderState: "open",
        fillState: "pending",
        settlementState: "confirmed",
        positionState: "opening",
        riskState: "healthy",
        notes: ["Perp order accepted"],
      },
    });

    expect(row?.pairId).toBeNull();
    expect(row?.instrumentLabel).toBe("SOL-PERP");
    expect(row?.venueKey).toBe("drift");
    expect(row?.familyLabel).toBe("Perps");
    expect(row?.providerStatus).toBe("healthy");
    expect(row?.oracleFreshnessLabel).toBe("450ms");
  });
});
