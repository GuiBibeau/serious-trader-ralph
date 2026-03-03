import { describe, expect, test } from "bun:test";
import { parseExecSubmitPayload } from "../../apps/worker/src/execution/submit_contract";

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
      dryRun: false,
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
    expect(parsed.value.privyExecute?.options?.commitment).toBe("confirmed");
    expect(parsed.metadataForStorage).toEqual({
      source: "terminal-ui",
      reason: "manual-swap",
      clientRequestId: "req_abc_001",
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
