import { describe, expect, test } from "bun:test";
import {
  computeQuoteReferenceDivergenceBps,
  validateExecutionQualityConfig,
  validateOrderConfig,
} from "../../apps/portal/app/terminal/components/trade-ticket-modal";
import { getTerminalSpotVenueDefinition } from "../../apps/portal/app/terminal/terminal-venues";

describe("portal terminal advanced trade ticket validation", () => {
  test("rejects invalid limit and post-only combinations", () => {
    const errors = validateOrderConfig({
      orderType: "limit",
      timeInForce: "ioc",
      lane: "safe",
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

  test("accepts a valid Trigger-backed spot order without bracket controls", () => {
    const errors = validateOrderConfig({
      orderType: "trigger",
      timeInForce: "gtc",
      lane: "safe",
      venue: getTerminalSpotVenueDefinition("jupiter"),
      reduceOnly: false,
      postOnly: false,
      quantityMode: "quote",
      amountAtomic: "1000",
      limitPriceAtomic: null,
      triggerPriceAtomic: "900000",
      takeProfitPriceAtomic: null,
      stopLossPriceAtomic: null,
      bracketEnabled: false,
    });
    expect(errors).toHaveLength(0);
  });

  test("fails closed for bracket controls until Trigger TP/SL flows are wired", () => {
    const errors = validateOrderConfig({
      orderType: "trigger",
      timeInForce: "gtc",
      lane: "safe",
      venue: getTerminalSpotVenueDefinition("jupiter"),
      reduceOnly: false,
      postOnly: false,
      quantityMode: "quote",
      amountAtomic: "1000",
      limitPriceAtomic: null,
      triggerPriceAtomic: "900000",
      takeProfitPriceAtomic: "1100000",
      stopLossPriceAtomic: "850000",
      bracketEnabled: true,
    });
    expect(errors).toContain(
      "Bracket TP/SL is not wired yet for Trigger-backed orders.",
    );
  });

  test("fails closed for unsupported OpenBook trigger controls", () => {
    const errors = validateOrderConfig({
      orderType: "trigger",
      timeInForce: "gtc",
      lane: "safe",
      venue: getTerminalSpotVenueDefinition("openbook"),
      reduceOnly: false,
      postOnly: false,
      quantityMode: "quote",
      amountAtomic: "1000",
      limitPriceAtomic: null,
      triggerPriceAtomic: "900000",
      takeProfitPriceAtomic: null,
      stopLossPriceAtomic: null,
      bracketEnabled: false,
    });
    expect(errors).toContain(
      "OpenBook v2 does not support TRIGGER spot orders.",
    );
  });

  test("blocks invalid safe lane + no-simulation quality combo", () => {
    const errors = validateExecutionQualityConfig({
      lane: "safe",
      simulationPreference: "never",
      slippageBps: 50,
      priorityMicroLamports: 5000,
    });
    expect(errors).toContain(
      "Safe lane requires simulation (choose auto or always).",
    );
  });

  test("accepts valid execution quality controls", () => {
    const errors = validateExecutionQualityConfig({
      lane: "protected",
      simulationPreference: "always",
      slippageBps: 120,
      priorityMicroLamports: 200000,
    });
    expect(errors).toHaveLength(0);
  });

  test("computes quote divergence against reference price for buys", () => {
    const divergence = computeQuoteReferenceDivergenceBps({
      direction: "buy",
      quotedInputAtomic: "155000000",
      quotedOutputAtomic: "1000000",
      inputDecimals: 6,
      outputDecimals: 6,
      referencePrice: 155,
    });

    expect(divergence).toBe(0);
  });

  test("computes quote divergence against reference price for sells without inverting the quote", () => {
    const divergence = computeQuoteReferenceDivergenceBps({
      direction: "sell",
      quotedInputAtomic: "1000000",
      quotedOutputAtomic: "155000000",
      inputDecimals: 6,
      outputDecimals: 6,
      referencePrice: 155,
    });

    expect(divergence).toBe(0);
  });
});
