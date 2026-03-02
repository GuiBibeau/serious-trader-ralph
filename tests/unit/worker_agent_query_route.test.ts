import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

const env = {
  ALLOWED_ORIGINS: "*",
} as Env;

describe("worker /api/agent/query", () => {
  test("GET route is public and deterministic", async () => {
    const response = await worker.fetch(
      new Request(
        "http://api.trader-ralph.com/api/agent/query?q=macro+signals",
        {
          method: "GET",
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.query).toBe("macro signals");
    expect(Array.isArray(body.suggestedEndpoints)).toBe(true);
    expect((body.suggestedEndpoints as unknown[]).length).toBeGreaterThan(0);
  });

  test("POST route accepts JSON body and enforces query truncation", async () => {
    const longQuery = "x".repeat(800);
    const response = await worker.fetch(
      new Request("http://api.trader-ralph.com/api/agent/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: longQuery }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.query).toBe("string");
    expect(String(body.query).length).toBe(512);
  });

  test("missing query still returns capability response", async () => {
    const response = await worker.fetch(
      new Request("http://api.trader-ralph.com/api/agent/query", {
        method: "GET",
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.query).toBe("");
    expect(String(body.answer).length).toBeGreaterThan(10);
  });
});
