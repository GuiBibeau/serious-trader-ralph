import { describe, expect, test } from "bun:test";
import {
  buildExecSubmitIntentSummary,
  parseExecSubmitPayload,
  resolveExecSubmitIntentFamily,
  resolveExecSubmitSpotSwap,
  toExecSubmitRequestV1Compat,
} from "../../apps/worker/src/execution/submit_contract";

const VALID_PRIVY_SUBMIT = {
  schemaVersion: "v1",
  mode: "privy_execute",
  lane: "protected",
  metadata: {
    source: "terminal-ui",
    reason: "manual-swap",
    clientRequestId: "req_abc_001",
  },
  privyExecute: {
    intentType: "swap",
    wallet: "11111111111111111111111111111111",
    swap: {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "1000000",
      slippageBps: 50,
    },
    options: {
      simulateOnly: true,
      requireSimulation: true,
      dryRun: false,
      priorityMicroLamports: 50000,
      commitment: "confirmed",
    },
  },
} as const;

describe("exec submit contract: privy_execute", () => {
  test("parses a valid privy_execute intent into typed adapter-ready payload", () => {
    const parsed = parseExecSubmitPayload(VALID_PRIVY_SUBMIT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe("privy_execute");
    expect(parsed.value.privyExecute?.intentType).toBe("swap");
    expect(parsed.value.privyExecute?.swap.amountAtomic).toBe("1000000");
    expect(parsed.value.privyExecute?.options?.simulateOnly).toBe(true);
    expect(parsed.value.privyExecute?.options?.requireSimulation).toBe(true);
    expect(parsed.value.privyExecute?.options?.priorityMicroLamports).toBe(
      50000,
    );
    expect(parsed.value.privyExecute?.options?.commitment).toBe("confirmed");
    expect(parsed.metadataForStorage).toEqual({
      source: "terminal-ui",
      reason: "manual-swap",
      clientRequestId: "req_abc_001",
    });
  });

  test("accepts advanced order options for privy_execute submits", () => {
    const parsed = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      privyExecute: {
        ...VALID_PRIVY_SUBMIT.privyExecute,
        options: {
          ...VALID_PRIVY_SUBMIT.privyExecute.options,
          orderType: "trigger",
          timeInForce: "ioc",
          reduceOnly: true,
          postOnly: false,
          quantityMode: "notional",
          limitPriceAtomic: "1000000",
          triggerPriceAtomic: "950000",
          takeProfitPriceAtomic: "1200000",
          stopLossPriceAtomic: "880000",
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.privyExecute?.options?.orderType).toBe("trigger");
    expect(parsed.value.privyExecute?.options?.quantityMode).toBe("notional");
    expect(parsed.value.privyExecute?.options?.triggerPriceAtomic).toBe(
      "950000",
    );
  });

  test("parses a v2 spot_swap payload and exposes swap compatibility helpers", () => {
    const parsed = parseExecSubmitPayload({
      schemaVersion: "v2",
      mode: "privy_execute",
      lane: "safe",
      metadata: {
        source: "terminal-ui",
      },
      privyExecute: {
        wallet: "11111111111111111111111111111111",
        intent: {
          family: "spot_swap",
          venueKey: "jupiter",
          marketType: "spot",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountAtomic: "2500000",
          slippageBps: 35,
        },
        options: {
          commitment: "confirmed",
          requireSimulation: true,
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(resolveExecSubmitIntentFamily(parsed.value)).toBe("spot_swap");
    expect(resolveExecSubmitSpotSwap(parsed.value)?.swap.amountAtomic).toBe(
      "2500000",
    );
    expect(toExecSubmitRequestV1Compat(parsed.value)?.schemaVersion).toBe("v1");
    expect(buildExecSubmitIntentSummary(parsed.value)).toEqual({
      family: "spot_swap",
      marketType: "spot",
      venueKey: "jupiter",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  test("parses a non-swap v2 intent family without forcing swap compatibility", () => {
    const parsed = parseExecSubmitPayload({
      schemaVersion: "v2",
      mode: "privy_execute",
      lane: "protected",
      privyExecute: {
        wallet: "11111111111111111111111111111111",
        intent: {
          family: "perp_order",
          venueKey: "drift",
          marketType: "perp",
          instrumentId: "SOL-PERP",
          side: "long",
          quantityAtomic: "1000000",
          collateralAtomic: "250000",
        },
        options: {
          orderType: "limit",
          limitPriceAtomic: "155000000",
          reduceOnly: false,
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(resolveExecSubmitIntentFamily(parsed.value)).toBe("perp_order");
    expect(resolveExecSubmitSpotSwap(parsed.value)).toBeNull();
    expect(toExecSubmitRequestV1Compat(parsed.value)).toBeNull();
    expect(buildExecSubmitIntentSummary(parsed.value)).toEqual({
      family: "perp_order",
      marketType: "perp",
      venueKey: "drift",
      instrumentId: "SOL-PERP",
      side: "long",
    });
  });

  test("rejects malformed v2 family payloads deterministically", () => {
    const missingConditionalPricing = parseExecSubmitPayload({
      schemaVersion: "v2",
      mode: "privy_execute",
      lane: "protected",
      privyExecute: {
        wallet: "11111111111111111111111111111111",
        intent: {
          family: "conditional_spot_order",
          venueKey: "jupiter",
          marketType: "spot",
          instrumentId: "SOL/USDC",
          side: "buy",
          quantityAtomic: "1000000",
        },
      },
    });
    expect(missingConditionalPricing).toEqual({
      ok: false,
      error: "invalid-request",
    });

    const invalidPredictionMarket = parseExecSubmitPayload({
      schemaVersion: "v2",
      mode: "privy_execute",
      lane: "protected",
      privyExecute: {
        wallet: "11111111111111111111111111111111",
        intent: {
          family: "prediction_order",
          venueKey: "dflow",
          marketType: "prediction",
          instrumentId: "election-2026",
          side: "buy_yes",
          quantityAtomic: "1000000",
        },
      },
    });
    expect(invalidPredictionMarket).toEqual({
      ok: false,
      error: "invalid-request",
    });
  });

  test("rejects invalid privy_execute payloads deterministically", () => {
    const invalidIntentType = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      privyExecute: {
        ...VALID_PRIVY_SUBMIT.privyExecute,
        intentType: "bridge",
      },
    });
    expect(invalidIntentType).toEqual({ ok: false, error: "invalid-request" });

    const zeroAmount = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      privyExecute: {
        ...VALID_PRIVY_SUBMIT.privyExecute,
        swap: {
          ...VALID_PRIVY_SUBMIT.privyExecute.swap,
          amountAtomic: "0",
        },
      },
    });
    expect(zeroAmount).toEqual({ ok: false, error: "invalid-request" });

    const invalidOptionShape = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      privyExecute: {
        ...VALID_PRIVY_SUBMIT.privyExecute,
        options: {
          ...VALID_PRIVY_SUBMIT.privyExecute.options,
          simulateOnly: "yes",
        },
      },
    });
    expect(invalidOptionShape).toEqual({
      ok: false,
      error: "invalid-request",
    });

    const invalidPriorityBounds = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      privyExecute: {
        ...VALID_PRIVY_SUBMIT.privyExecute,
        options: {
          ...VALID_PRIVY_SUBMIT.privyExecute.options,
          priorityMicroLamports: 2_000_001,
        },
      },
    });
    expect(invalidPriorityBounds).toEqual({
      ok: false,
      error: "invalid-request",
    });
  });

  test("rejects mode/payload mismatches", () => {
    const modeMismatch = parseExecSubmitPayload({
      ...VALID_PRIVY_SUBMIT,
      mode: "relay_signed",
      relaySigned: {
        encoding: "base64",
        signedTransaction: "QUFBQUFBQUFBQUFBQUFBQQ==",
      },
    });
    expect(modeMismatch).toEqual({ ok: false, error: "invalid-request" });
  });
});
