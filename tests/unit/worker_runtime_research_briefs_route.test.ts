import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;
const originalFetch = globalThis.fetch;

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              const result = statement.run(...(params as never[])) as {
                changes?: number;
              };
              return {
                meta: {
                  changes:
                    typeof result.changes === "number" ? result.changes : 0,
                },
              };
            },
            async first() {
              const statement = db.query(sql);
              return (statement.get(...(params as never[])) as unknown) ?? null;
            },
            async all() {
              const statement = db.query(sql);
              return {
                results: (statement.all(...(params as never[])) ??
                  []) as unknown[],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function createOpsEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
    "0027_runtime_canary.sql",
  ]) {
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations",
      migrationName,
    );
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      ...overrides,
    },
  });

  return { env, sqlite };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("worker runtime research brief route", () => {
  test("requires admin auth", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/runtime/research/briefs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ profile: "latest_strategy_papers" }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: "auth-required",
      });
    } finally {
      sqlite.close();
    }
  });

  test("builds and returns a research brief through the admin route", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://research.example.com/posts/momentum-alpha") {
          return new Response(
            `
              <html>
                <head>
                  <title>Momentum Alpha in Crypto</title>
                  <meta name="author" content="Ada Researcher" />
                  <meta property="article:published_time" content="2026-03-11T08:00:00Z" />
                </head>
                <body>
                  <p>Measure momentum across venue fragments and validate liquidity persistence.</p>
                </body>
              </html>
            `,
            { status: 200, headers: { "content-type": "text/html" } },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as typeof fetch;

      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/runtime/research/briefs", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            profile: "custom",
            title: "Manual strategy brief",
            explicitAllowedHosts: ["research.example.com"],
            requests: [
              {
                kind: "manual_url",
                url: "https://research.example.com/posts/momentum-alpha",
                sourceKind: "article",
                venueKeys: ["jupiter"],
                assetKeys: ["SOL"],
                tags: ["signal"],
              },
            ],
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        brief: {
          title: "Manual strategy brief",
          profile: "custom",
          sourceCount: 1,
          createdCount: 1,
          citations: [
            {
              notes: "published 2026-03-11T08:00:00.000Z",
            },
          ],
          sources: [
            {
              title: "Momentum Alpha in Crypto",
              canonicalUrl: "https://research.example.com/posts/momentum-alpha",
            },
          ],
        },
        markdown: expect.stringContaining("Momentum Alpha in Crypto"),
        storedSources: [
          {
            title: "Momentum Alpha in Crypto",
          },
        ],
      });
    } finally {
      sqlite.close();
    }
  });

  test("fails closed when a request host is not approved", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/ops/runtime/research/briefs", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            profile: "custom",
            requests: [
              {
                kind: "manual_url",
                url: "https://unapproved.example.com/posts/alpha",
              },
            ],
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "research-source-not-allowed:unapproved.example.com",
      });
    } finally {
      sqlite.close();
    }
  });
});
