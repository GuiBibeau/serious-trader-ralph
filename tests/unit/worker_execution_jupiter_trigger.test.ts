import { describe, expect, test } from "bun:test";
import {
  findJupiterTriggerOrderByKey,
  resolveJupiterConditionalSpotOrder,
  summarizeJupiterTriggerOrder,
} from "../../apps/worker/src/execution/jupiter_trigger";
import type { NonSwapExecutionIntent } from "../../apps/worker/src/execution/types";

function createIntent(
  overrides?: Partial<NonSwapExecutionIntent>,
): NonSwapExecutionIntent {
  return {
    family: "conditional_spot_order",
    wallet: "11111111111111111111111111111111",
    venueKey: "jupiter",
    marketType: "spot",
    instrumentId: "SOL/USDC",
    side: "buy",
    quantityAtomic: "100000000",
    params: {
      orderType: "limit",
      timeInForce: "gtc",
      limitPriceAtomic: "100000000",
    },
    ...overrides,
  };
}

describe("worker Jupiter trigger conditional order helpers", () => {
  test("resolves buy limit orders into Jupiter trigger createOrder params", () => {
    const resolved = resolveJupiterConditionalSpotOrder(createIntent());

    expect(resolved.side).toBe("buy");
    expect(resolved.orderType).toBe("limit");
    expect(resolved.inputMint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(resolved.outputMint).toBe(
      "So11111111111111111111111111111111111111112",
    );
    expect(resolved.makingAmount).toBe("100000000");
    expect(resolved.takingAmount).toBe("1000000000");
    expect(resolved.triggerCondition).toBe("below");
  });

  test("resolves sell trigger orders into above or below semantics by side", () => {
    const resolved = resolveJupiterConditionalSpotOrder(
      createIntent({
        side: "sell",
        quantityAtomic: "2500000000",
        params: {
          orderType: "trigger",
          triggerPriceAtomic: "135000000",
        },
      }),
    );

    expect(resolved.side).toBe("sell");
    expect(resolved.orderType).toBe("trigger");
    expect(resolved.inputMint).toBe(
      "So11111111111111111111111111111111111111112",
    );
    expect(resolved.outputMint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(resolved.takingAmount).toBe("337500000");
    expect(resolved.triggerCondition).toBe("below");
  });

  test("fails closed on unsupported bracket options", () => {
    expect(() =>
      resolveJupiterConditionalSpotOrder(
        createIntent({
          params: {
            orderType: "trigger",
            triggerPriceAtomic: "101000000",
            takeProfitPriceAtomic: "120000000",
          },
        }),
      ),
    ).toThrow(/unsupported-jupiter-trigger-take-profit/);
  });

  test("normalizes active, partial, triggered, and terminal order states", () => {
    const open = summarizeJupiterTriggerOrder({
      order: "order-open",
      status: "Open",
      makingAmount: "100000000",
      takingAmount: "1000000000",
      remainingMakingAmount: "100000000",
    });
    expect(open.lifecycle.orderState).toBe("open");

    const partial = summarizeJupiterTriggerOrder({
      order: "order-partial",
      status: "Partially Filled",
      makingAmount: "100000000",
      takingAmount: "1000000000",
      remainingMakingAmount: "50000000",
    });
    expect(partial.lifecycle.orderState).toBe("partially_filled");
    expect(partial.filledInputAtomic).toBe("50000000");

    const triggered = summarizeJupiterTriggerOrder({
      order: "order-triggered",
      status: "Triggered",
    });
    expect(triggered.lifecycle.orderState).toBe("triggered");

    const cancelled = summarizeJupiterTriggerOrder({
      order: "order-cancelled",
      status: "Cancelled",
      closeTx: "sig-cancel",
    });
    expect(cancelled.lifecycle.orderState).toBe("cancelled");
    expect(cancelled.terminalReason).toBe("cancelled");
    expect(cancelled.signature).toBe("sig-cancel");

    const filled = summarizeJupiterTriggerOrder({
      order: "order-filled",
      status: "Filled",
      makingAmount: "100000000",
      takingAmount: "1000000000",
      remainingMakingAmount: "0",
      closeTx: "sig-fill",
    });
    expect(filled.lifecycle.orderState).toBe("filled");
    expect(filled.terminalReason).toBe("filled");
    expect(filled.filledInputAtomic).toBe("100000000");
    expect(filled.filledOutputAtomic).toBe("1000000000");

    const completed = summarizeJupiterTriggerOrder({
      orderKey: "order-completed",
      status: "Completed",
      makingAmount: "5.25",
      takingAmount: "0.054108916",
      rawMakingAmount: "5250000",
      rawTakingAmount: "54108916",
      remainingMakingAmount: "0",
      rawRemainingMakingAmount: "0",
      closeTx: "sig-completed",
    });
    expect(completed.lifecycle.orderState).toBe("filled");
    expect(completed.terminalReason).toBe("filled");
    expect(completed.filledInputAtomic).toBe("5250000");
    expect(completed.filledOutputAtomic).toBe("54108916");
  });

  test("finds an order by public key", () => {
    expect(
      findJupiterTriggerOrderByKey(
        [{ order: "order-a" }, { order: "order-b" }],
        "order-b",
      )?.order,
    ).toBe("order-b");
  });

  test("finds an order by orderKey when Jupiter returns the current field names", () => {
    expect(
      findJupiterTriggerOrderByKey(
        [{ orderKey: "order-a" }, { orderKey: "order-b" }],
        "order-b",
      )?.orderKey,
    ).toBe("order-b");
  });
});
