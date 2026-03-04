import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
  MAINNET_USDC_MINT,
  SOL_MINT,
} from "../integration/_worker_live_test_utils";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

type SubmitAck = {
  ok?: boolean;
  requestId?: string;
};

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

function createExecLoadEnv(overrides?: Partial<Env>): {
  env: Env;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite
    .query("INSERT INTO waitlist (email, source) VALUES (?1, ?2)")
    .run("user@example.com", "unit-test");
  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0025_execution_fabric.sql",
  );
  sqlite.exec(readFileSync(migrationPath, "utf8"));

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
      ...(overrides ?? {}),
    },
  });
  return { env, sqlite };
}

function percentile(values: number[], pct: number): number {
  if (values.length < 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? 0;
}

function writeExecutionBenchmarkArtifact(
  summary: Record<string, unknown>,
): void {
  const outputPath = resolve(
    process.cwd(),
    ".tmp",
    "execution-benchmarks",
    "phase2-load-benchmark.json",
  );
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  } catch {
    // Benchmark artifact writing is best-effort and should not fail tests.
  }
}

async function submitRelay(env: Env, idempotencyKey: string) {
  const relayPayload = buildRelaySignedPayload();
  const started = performance.now();
  const response = await worker.fetch(
    new Request("http://localhost/api/x402/exec/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "payment-signature": "unit-signed-payment",
      },
      body: JSON.stringify(relayPayload),
    }),
    env,
    createExecutionContextStub(),
  );
  const elapsedMs = performance.now() - started;
  const payload = (await response.json().catch(() => null)) as SubmitAck | null;
  return {
    status: response.status,
    elapsedMs,
    requestId: typeof payload?.requestId === "string" ? payload.requestId : "",
  };
}

describe("execution fabric e2e load and reliability", () => {
  test("benchmarks concurrent relay submits and validates status/receipt consistency", async () => {
    const { env, sqlite } = createExecLoadEnv();
    try {
      const concurrency = 100;
      const submits = await Promise.all(
        Array.from({ length: concurrency }, (_, idx) =>
          submitRelay(env, `load-relay-${idx}`),
        ),
      );

      const successes = submits.filter(
        (entry) =>
          entry.status === 200 && entry.requestId.startsWith("execreq_"),
      );
      const successRate = successes.length / concurrency;
      const p95Ms = percentile(
        submits.map((entry) => entry.elapsedMs),
        95,
      );

      expect(successRate).toBeGreaterThanOrEqual(0.99);
      expect(p95Ms).toBeLessThan(1_500);

      const requestIds = successes.map((entry) => entry.requestId);
      const statusResponses = await Promise.all(
        requestIds.map((requestId) =>
          worker.fetch(
            new Request(`http://localhost/api/x402/exec/status/${requestId}`),
            env,
            createExecutionContextStub(),
          ),
        ),
      );
      const receiptResponses = await Promise.all(
        requestIds.map((requestId) =>
          worker.fetch(
            new Request(`http://localhost/api/x402/exec/receipt/${requestId}`),
            env,
            createExecutionContextStub(),
          ),
        ),
      );

      for (let idx = 0; idx < requestIds.length; idx += 1) {
        const statusResponse = statusResponses[idx];
        const receiptResponse = receiptResponses[idx];
        expect(statusResponse?.status).toBe(200);
        expect(receiptResponse?.status).toBe(200);
        const statusPayload = (await statusResponse
          ?.json()
          .catch(() => null)) as { ok?: boolean; requestId?: string } | null;
        const receiptPayload = (await receiptResponse
          ?.json()
          .catch(() => null)) as {
          ok?: boolean;
          requestId?: string;
          ready?: boolean;
        } | null;
        expect(statusPayload?.ok).toBe(true);
        expect(statusPayload?.requestId).toBe(requestIds[idx]);
        expect(receiptPayload?.ok).toBe(true);
        expect(receiptPayload?.requestId).toBe(requestIds[idx]);
        expect(typeof receiptPayload?.ready).toBe("boolean");
      }

      writeExecutionBenchmarkArtifact({
        generatedAt: new Date().toISOString(),
        scenario: "concurrent-relay-submit",
        requestCount: concurrency,
        successCount: successes.length,
        successRate,
        p95Ms,
      });
    } finally {
      sqlite.close();
    }
  });

  test("preserves idempotency replay and immutability guarantees", async () => {
    const { env, sqlite } = createExecLoadEnv();
    try {
      const relayPayload = buildRelaySignedPayload();

      const first = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-load-immutability",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { requestId?: string };
      const requestId = String(firstBody.requestId ?? "");
      expect(requestId.startsWith("execreq_")).toBe(true);

      const replay = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-load-immutability",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(replay.status).toBe(200);
      const replayBody = (await replay.json()) as { requestId?: string };
      expect(replayBody.requestId).toBe(requestId);

      const metadataRow = sqlite
        .query(
          "SELECT metadata_json as metadataJson FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(requestId) as { metadataJson?: string } | undefined;
      const metadata = JSON.parse(
        String(metadataRow?.metadataJson ?? "{}"),
      ) as {
        relayImmutability?: { receivedTxHash?: string };
      };
      metadata.relayImmutability = {
        ...(metadata.relayImmutability ?? {}),
        receivedTxHash: `sha256:${"f".repeat(64)}`,
      };
      sqlite
        .query(
          "UPDATE execution_requests SET metadata_json = ?2 WHERE request_id = ?1",
        )
        .run(requestId, JSON.stringify(metadata));

      const divergentReplay = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-load-immutability",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(divergentReplay.status).toBe(403);
      const divergentBody = (await divergentReplay.json()) as {
        error?: { code?: string; details?: { reason?: string } };
      };
      expect(divergentBody.error?.code).toBe("policy-denied");
      expect(divergentBody.error?.details?.reason).toBe(
        "relay-immutability-mismatch",
      );
    } finally {
      sqlite.close();
    }
  });

  test("accepts privy_execute flow for api key actors", async () => {
    const { env, sqlite } = createExecLoadEnv({
      EXEC_API_KEYS: "ops_actor:ops-secret:privy_execute",
    });
    try {
      const payload = {
        schemaVersion: "v1",
        mode: "privy_execute",
        lane: "safe",
        privyExecute: {
          intentType: "swap",
          wallet: "11111111111111111111111111111111",
          swap: {
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amountAtomic: "1000000",
            slippageBps: 50,
          },
        },
      };

      const submit = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-load-privy-api-key",
            "x-exec-api-key": "ops-secret",
          },
          body: JSON.stringify(payload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submit.status).toBe(200);
      const submitBody = (await submit.json()) as { requestId?: string };
      const requestId = String(submitBody.requestId ?? "");
      expect(requestId.startsWith("execreq_")).toBe(true);

      const status = await worker.fetch(
        new Request(`http://localhost/api/x402/exec/status/${requestId}`),
        env,
        createExecutionContextStub(),
      );
      expect(status.status).toBe(200);
      const statusBody = (await status.json()) as {
        ok?: boolean;
        status?: { mode?: string; actorType?: string };
      };
      expect(statusBody.ok).toBe(true);
      expect(statusBody.status?.mode).toBe("privy_execute");
      expect(statusBody.status?.actorType).toBe("api_key_actor");
    } finally {
      sqlite.close();
    }
  });
});
