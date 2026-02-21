import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import {
  LOOP_B_ANOMALY_FEED_KEY,
  LOOP_B_LIQUIDITY_STRESS_KEY,
  LOOP_B_SCORES_LATEST_KEY,
  LOOP_B_TOP_MOVERS_KEY,
} from "../../apps/worker/src/loop_b/minute_accumulator";
import type { Env } from "../../apps/worker/src/types";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function createEnv(overrides?: Partial<Env>): Env {
  const kvStore = new Map<string, string>();
  return {
    ALLOWED_ORIGINS: "*",
    X402_NETWORK: "solana-devnet",
    X402_PAY_TO: "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
    X402_ASSET_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    X402_MAX_TIMEOUT_SECONDS: "60",
    X402_SOLANA_MARKS_LATEST_PRICE_USD: "0.01",
    X402_SOLANA_SCORES_LATEST_PRICE_USD: "0.01",
    X402_SOLANA_VIEWS_TOP_PRICE_USD: "0.01",
    CONFIG_KV: {
      async get(key: string) {
        return kvStore.get(key) ?? null;
      },
      async put(key: string, value: string) {
        kvStore.set(key, value);
      },
    } as KVNamespace,
    ...overrides,
  } as Env;
}

describe("worker x402 loop routes", () => {
  test("serves solana marks latest from KV", async () => {
    const env = createEnv();
    await env.CONFIG_KV?.put(
      "loopA:v1:marks:confirmed:latest",
      JSON.stringify({
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:00:00.000Z",
        commitment: "confirmed",
        latestSlot: 123,
        count: 1,
        marks: [{ pairId: "SOL:USDC" }],
      }),
    );

    const response = await worker.fetch(
      new Request("http://localhost/api/x402/read/solana_marks_latest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "signed",
        },
        body: JSON.stringify({ commitment: "confirmed" }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.commitment).toBe("confirmed");
    const marks = body.marks as Record<string, unknown>;
    expect(marks.latestSlot).toBe(123);
  });

  test("filters loop B scores by pair id when requested", async () => {
    const env = createEnv();
    await env.CONFIG_KV?.put(
      LOOP_B_SCORES_LATEST_KEY,
      JSON.stringify({
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:01:00.000Z",
        minute: "2026-02-21T20:01:00.000Z",
        count: 2,
        rows: [
          { pairId: "SOL:USDC", finalScore: 0.9 },
          { pairId: "BTC:USDC", finalScore: 0.4 },
        ],
      }),
    );

    const response = await worker.fetch(
      new Request("http://localhost/api/x402/read/solana_scores_latest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "signed",
        },
        body: JSON.stringify({ pairId: "SOL:USDC" }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.pairId).toBe("SOL:USDC");
    const scores = body.scores as Record<string, unknown>;
    expect(scores.count).toBe(1);
    const rows = Array.isArray(scores.rows) ? scores.rows : [];
    expect(rows.length).toBe(1);
  });

  test("serves selected loop B top view from KV", async () => {
    const env = createEnv();
    await env.CONFIG_KV?.put(
      LOOP_B_TOP_MOVERS_KEY,
      JSON.stringify({
        schemaVersion: "v1",
        generatedAt: "2026-02-21T20:02:00.000Z",
        minute: "2026-02-21T20:02:00.000Z",
        count: 1,
        movers: [{ pairId: "SOL:USDC", pctChange: 0.03 }],
      }),
    );
    await env.CONFIG_KV?.put(
      LOOP_B_LIQUIDITY_STRESS_KEY,
      JSON.stringify({ schemaVersion: "v1", count: 0, pairs: [] }),
    );
    await env.CONFIG_KV?.put(
      LOOP_B_ANOMALY_FEED_KEY,
      JSON.stringify({ schemaVersion: "v1", count: 0, anomalies: [] }),
    );

    const response = await worker.fetch(
      new Request("http://localhost/api/x402/read/solana_views_top", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "signed",
        },
        body: JSON.stringify({ view: "top_movers" }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.view).toBe("top_movers");
    const topMovers = body.topMovers as Record<string, unknown>;
    expect(topMovers.count).toBe(1);
    expect(body.liquidityStress).toBeUndefined();
    expect(body.anomalyFeed).toBeUndefined();
  });

  test("rejects invalid commitment and view filters", async () => {
    const env = createEnv();

    const marksResponse = await worker.fetch(
      new Request("http://localhost/api/x402/read/solana_marks_latest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "signed",
        },
        body: JSON.stringify({ commitment: "invalid" }),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(marksResponse.status).toBe(400);
    await expect(marksResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid-commitment",
    });

    const viewsResponse = await worker.fetch(
      new Request("http://localhost/api/x402/read/solana_views_top", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": "signed",
        },
        body: JSON.stringify({ view: "invalid" }),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(viewsResponse.status).toBe(400);
    await expect(viewsResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid-view-request",
    });
  });
});
