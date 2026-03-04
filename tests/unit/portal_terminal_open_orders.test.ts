import { describe, expect, test } from "bun:test";
import {
  amendOpenOrder,
  cancelAllOpenOrders,
  cancelOpenOrder,
  executeOpenOrderSlice,
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
});
