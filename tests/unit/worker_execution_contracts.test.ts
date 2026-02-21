import { describe, expect, test } from "bun:test";
import {
  applyExecutionResultToTrace,
  buildExecutionOutcomeFromError,
  buildExecutionOutcomeFromResult,
  buildExecutionReceipt,
  createExecutionDecision,
  createExecutionIntent,
  EXEC_LATENCY_LAST_100_KEY,
  executionLatencyMinuteKey,
  newExecutionLatencyTrace,
  recordExecutionReceipt,
} from "../../apps/worker/src/execution/contracts";
import type { ExecuteSwapResult } from "../../apps/worker/src/execution/types";
import type { Env } from "../../apps/worker/src/types";

const BASE_QUOTE = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "100000000",
  outAmount: "18000000",
  priceImpactPct: "0.0012",
  routePlan: [{ swapInfo: { label: "Jupiter" } }],
};

describe("worker execution contracts", () => {
  test("builds deterministic content hash for same receipt payload", async () => {
    const intent = createExecutionIntent({
      receivedAt: "2026-02-21T20:00:00.000Z",
      userId: "user-1",
      wallet: "wallet-1",
      inputMint: BASE_QUOTE.inputMint,
      outputMint: BASE_QUOTE.outputMint,
      amountAtomic: "100000000",
      slippageBps: 50,
      source: "TERMINAL",
      execution: { adapter: "jupiter" },
      simulateOnly: false,
      dryRun: false,
      commitment: "confirmed",
    });
    const decision = createExecutionDecision({
      intentId: intent.intentId,
      decidedAt: "2026-02-21T20:00:01.000Z",
      route: "jupiter",
      simulateOnly: false,
      dryRun: false,
      commitment: "confirmed",
    });
    const trace = newExecutionLatencyTrace("2026-02-21T20:00:00.000Z");
    trace.validatedAt = "2026-02-21T20:00:00.500Z";
    trace.decisionAt = "2026-02-21T20:00:01.000Z";
    trace.sentAt = "2026-02-21T20:00:02.000Z";
    trace.confirmedAt = "2026-02-21T20:00:03.000Z";

    const outcome = {
      status: "confirmed" as const,
      signature: "sig-1",
      refreshed: false,
      lastValidBlockHeight: 123,
      error: null,
    };

    const first = await buildExecutionReceipt({
      generatedAt: "2026-02-21T20:00:03.000Z",
      intent,
      decision,
      trace,
      outcome,
      quote: BASE_QUOTE,
    });
    const second = await buildExecutionReceipt({
      generatedAt: "2026-02-21T20:00:03.000Z",
      intent,
      decision,
      trace,
      outcome,
      quote: BASE_QUOTE,
    });

    expect(first.storage.contentSha256).toBe(second.storage.contentSha256);
    expect(first.storage.key).toBe(second.storage.key);
    expect(first.receiptId).toBe(second.receiptId);
  });

  test("records receipt to content-addressed R2 key", async () => {
    const r2Writes = new Map<string, string>();
    const kvWrites = new Map<string, string>();
    const env = {
      LOGS_BUCKET: {
        put: async (key: string, value: string) => {
          r2Writes.set(key, value);
        },
      },
      CONFIG_KV: {
        get: async (key: string) => kvWrites.get(key) ?? null,
        put: async (key: string, value: string) => {
          kvWrites.set(key, value);
        },
      },
    } as Env;
    const intent = createExecutionIntent({
      receivedAt: "2026-02-21T20:10:00.000Z",
      userId: "user-2",
      wallet: "wallet-2",
      inputMint: BASE_QUOTE.inputMint,
      outputMint: BASE_QUOTE.outputMint,
      amountAtomic: "25000000",
      slippageBps: 25,
      source: "TERMINAL",
      execution: { adapter: "jupiter" },
      simulateOnly: false,
      dryRun: false,
      commitment: "confirmed",
    });
    const decision = createExecutionDecision({
      intentId: intent.intentId,
      decidedAt: "2026-02-21T20:10:01.000Z",
      route: "jupiter",
      simulateOnly: false,
      dryRun: false,
      commitment: "confirmed",
    });
    const trace = newExecutionLatencyTrace("2026-02-21T20:10:00.000Z");
    trace.validatedAt = "2026-02-21T20:10:00.400Z";
    trace.decisionAt = "2026-02-21T20:10:01.000Z";
    trace.sentAt = "2026-02-21T20:10:01.800Z";
    trace.confirmedAt = "2026-02-21T20:10:02.300Z";

    const receipt = await recordExecutionReceipt(env, {
      generatedAt: "2026-02-21T20:10:02.300Z",
      intent,
      decision,
      trace,
      outcome: {
        status: "confirmed",
        signature: "sig-2",
        refreshed: true,
        lastValidBlockHeight: 456,
        error: null,
      },
      quote: BASE_QUOTE,
    });

    expect(receipt.storage.key).toContain("exec/v1/receipts/sha256=");
    expect(r2Writes.has(receipt.storage.key)).toBe(true);
    const persisted = JSON.parse(
      r2Writes.get(receipt.storage.key) ?? "{}",
    ) as Record<string, unknown>;
    expect(persisted.receiptId).toBe(receipt.receiptId);
    expect(
      (
        persisted.storage as
          | { contentSha256?: string; key?: string }
          | undefined
      )?.contentSha256,
    ).toBe(receipt.storage.contentSha256);
    expect(kvWrites.has(EXEC_LATENCY_LAST_100_KEY)).toBe(true);
    expect(
      kvWrites.has(executionLatencyMinuteKey("2026-02-21T20:10:00.000Z")),
    ).toBe(true);
  });

  test("maps execution status to latency stages", () => {
    const trace = newExecutionLatencyTrace("2026-02-21T20:20:00.000Z");
    const result = {
      status: "finalized",
      signature: "sig-3",
      usedQuote: BASE_QUOTE,
      refreshed: false,
      lastValidBlockHeight: 999,
      err: null,
    } satisfies ExecuteSwapResult;

    const next = applyExecutionResultToTrace({
      trace,
      result,
      settledAt: "2026-02-21T20:20:02.000Z",
    });
    expect(next.sentAt).toBe("2026-02-21T20:20:02.000Z");
    expect(next.landedAt).toBe("2026-02-21T20:20:02.000Z");
    expect(next.confirmedAt).toBe("2026-02-21T20:20:02.000Z");
    expect(next.finalizedAt).toBe("2026-02-21T20:20:02.000Z");
    expect(next.failedAt).toBeNull();
  });

  test("uses executionMeta trace timestamps when provided", () => {
    const trace = newExecutionLatencyTrace("2026-02-21T20:21:00.000Z");
    const result = {
      status: "confirmed",
      signature: null,
      usedQuote: BASE_QUOTE,
      refreshed: false,
      lastValidBlockHeight: 1001,
      err: null,
      executionMeta: {
        route: "jito_bundle",
        classification: "confirmed",
        trace: {
          txBuiltAt: "2026-02-21T20:21:00.500Z",
          sentAt: "2026-02-21T20:21:01.000Z",
          landedAt: "2026-02-21T20:21:01.200Z",
          confirmedAt: "2026-02-21T20:21:01.400Z",
        },
      },
    } satisfies ExecuteSwapResult;

    const next = applyExecutionResultToTrace({
      trace,
      result,
      settledAt: "2026-02-21T20:21:02.000Z",
    });
    expect(next.txBuiltAt).toBe("2026-02-21T20:21:00.500Z");
    expect(next.sentAt).toBe("2026-02-21T20:21:01.000Z");
    expect(next.landedAt).toBe("2026-02-21T20:21:01.200Z");
    expect(next.confirmedAt).toBe("2026-02-21T20:21:01.400Z");
  });

  test("normalizes execution outcomes from result and thrown errors", () => {
    const fromResult = buildExecutionOutcomeFromResult({
      status: "simulate_error",
      signature: null,
      usedQuote: BASE_QUOTE,
      refreshed: false,
      lastValidBlockHeight: null,
      err: { code: "sim-failed" },
    });
    expect(fromResult.status).toBe("simulate_error");
    expect(fromResult.error).toContain("sim-failed");

    const fromError = buildExecutionOutcomeFromError(
      new Error("send-transaction-failed"),
    );
    expect(fromError.status).toBe("error");
    expect(fromError.error).toBe("send-transaction-failed");
  });
});
