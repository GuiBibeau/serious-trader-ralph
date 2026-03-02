import { afterEach, describe, expect, test } from "bun:test";
import { POST } from "../../apps/portal/app/api/waitlist/route";

const ORIGINAL_ENV = {
  NEXT_PUBLIC_EDGE_API_BASE: process.env.NEXT_PUBLIC_EDGE_API_BASE,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  WAITLIST_UPSTREAM_BEARER_TOKEN: process.env.WAITLIST_UPSTREAM_BEARER_TOKEN,
  WAITLIST_ALLOWED_ORIGINS: process.env.WAITLIST_ALLOWED_ORIGINS,
  NODE_ENV: process.env.NODE_ENV,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env.NEXT_PUBLIC_EDGE_API_BASE = ORIGINAL_ENV.NEXT_PUBLIC_EDGE_API_BASE;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV.NEXT_PUBLIC_SITE_URL;
  process.env.WAITLIST_UPSTREAM_BEARER_TOKEN =
    ORIGINAL_ENV.WAITLIST_UPSTREAM_BEARER_TOKEN;
  process.env.WAITLIST_ALLOWED_ORIGINS = ORIGINAL_ENV.WAITLIST_ALLOWED_ORIGINS;
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  globalThis.fetch = originalFetch;
});

describe("portal waitlist route", () => {
  test("rejects requests from invalid origins", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://dev.api.trader-ralph.com";
    process.env.WAITLIST_UPSTREAM_BEARER_TOKEN = "secret-token";
    process.env.NODE_ENV = "production";

    const response = await POST(
      new Request("https://dev.trader-ralph.com/api/waitlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          email: "user@example.com",
          source: "landing_page_modal",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid-origin",
    });
  });

  test("returns 503 when upstream bearer token is missing", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://dev.api.trader-ralph.com";
    process.env.WAITLIST_UPSTREAM_BEARER_TOKEN = "";
    process.env.NODE_ENV = "production";

    const response = await POST(
      new Request("https://dev.trader-ralph.com/api/waitlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://dev.trader-ralph.com",
        },
        body: JSON.stringify({
          email: "user@example.com",
          source: "landing_page_modal",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "missing WAITLIST_UPSTREAM_BEARER_TOKEN",
    });
  });

  test("forwards bearer token to worker upstream", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://dev.api.trader-ralph.com";
    process.env.WAITLIST_UPSTREAM_BEARER_TOKEN = "secret-token";
    process.env.NODE_ENV = "production";

    let capturedAuthHeader = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedAuthHeader = String(
        (init?.headers as Record<string, string> | undefined)?.authorization ??
          "",
      );
      return new Response(
        JSON.stringify({
          ok: true,
          email: "user@example.com",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const response = await POST(
      new Request("https://dev.trader-ralph.com/api/waitlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://dev.trader-ralph.com",
        },
        body: JSON.stringify({
          email: "user@example.com",
          source: "landing_page_modal",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(capturedAuthHeader).toBe("Bearer secret-token");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      email: "user@example.com",
    });
  });
});
