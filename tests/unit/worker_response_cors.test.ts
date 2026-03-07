import { describe, expect, test } from "bun:test";
import { json, okCors, withCors } from "../../apps/worker/src/response";
import type { Env } from "../../apps/worker/src/types";

const TEST_ENV = {
  ALLOWED_ORIGINS: "http://localhost:3000",
} as Env;

describe("worker response cors headers", () => {
  test("withCors allows idempotency-key for execution submit preflight", () => {
    const response = withCors(json({ ok: true }), TEST_ENV);
    const allowHeaders =
      response.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase().includes("idempotency-key")).toBe(true);
    expect(allowHeaders.toLowerCase().includes("x-exec-api-key")).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  test("okCors returns 204 with cors headers", () => {
    const response = okCors(TEST_ENV);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "OPTIONS",
    );
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "payment-response",
    );
  });
});
