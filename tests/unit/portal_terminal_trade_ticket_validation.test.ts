import { describe, expect, test } from "bun:test";
import { validateOrderConfig } from "../../apps/portal/app/terminal/components/trade-ticket-modal";

describe("portal terminal advanced trade ticket validation", () => {
  test("rejects invalid limit and post-only combinations", () => {
    const errors = validateOrderConfig({
      orderType: "limit",
      timeInForce: "ioc",
      reduceOnly: false,
      postOnly: true,
      quantityMode: "quote",
      amountAtomic: "1000",
      limitPriceAtomic: null,
      triggerPriceAtomic: null,
      takeProfitPriceAtomic: null,
      stopLossPriceAtomic: null,
      bracketEnabled: false,
    });
    expect(errors).toContain("Limit orders require a limit price.");
    expect(errors).toContain("Post-only cannot be combined with IOC or FOK.");
  });

  test("accepts valid trigger + bracket configuration", () => {
    const errors = validateOrderConfig({
      orderType: "trigger",
      timeInForce: "gtc",
      reduceOnly: true,
      postOnly: false,
      quantityMode: "quote",
      amountAtomic: "1000",
      limitPriceAtomic: null,
      triggerPriceAtomic: "900000",
      takeProfitPriceAtomic: "1100000",
      stopLossPriceAtomic: "850000",
      bracketEnabled: true,
    });
    expect(errors).toHaveLength(0);
  });
});
