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

describe("worker discovery proxy routes", () => {
  test("proxies /openapi.json and preserves CORS", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("https://dev.trader-ralph.com/openapi.json");
      expect(init?.method).toBe("GET");
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("https://dev.api.trader-ralph.com/openapi.json"),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("proxies /api/agent-registry/metadata.json", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe(
        "https://www.trader-ralph.com/api/agent-registry/metadata.json",
      );
      return new Response('{"lane":"production"}', {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request(
          "https://api.trader-ralph.com/api/agent-registry/metadata.json",
        ),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.lane).toBe("production");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("proxies preview-worker discovery docs to the configured preview portal", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe(
        "https://serious-trader-ralph-git-codex-issue-235-preview-guivercelpro.vercel.app/openapi.json",
      );
      return new Response('{"preview":true}', {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request(
          "https://ralph-edge-pr-235.gui-bibeau.workers.dev/openapi.json",
        ),
        {
          ...env,
          PORTAL_SITE_URL:
            "https://serious-trader-ralph-git-codex-issue-235-preview-guivercelpro.vercel.app",
        },
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.preview).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
