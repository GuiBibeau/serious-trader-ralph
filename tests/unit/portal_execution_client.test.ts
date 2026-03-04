import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createExecutionClient,
  ExecutionClientError,
  type ExecutionTransport,
} from "../../apps/portal/app/execution-client";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

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

function createExecClientEnv(): { env: Env; sqlite: Database } {
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
    },
  });
  return { env, sqlite };
}

function createWorkerTransport(env: Env): ExecutionTransport {
  return async (input) => {
    const response = await worker.fetch(
      new Request(`http://localhost${input.path}`, {
        method: input.method,
        headers: input.headers,
        ...(input.body ? { body: input.body } : {}),
        signal: input.signal,
      }),
      env,
      createExecutionContextStub(),
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      status: response.status,
      payload,
    };
  };
}

describe("portal execution client", () => {
  test("submit/status/receipt contract works against local worker", async () => {
    const { env, sqlite } = createExecClientEnv();
    try {
      const relayPayload = buildRelaySignedPayload();
      const client = createExecutionClient({
        transport: createWorkerTransport(env),
      });

      const submit = await client.submit(
        {
          schemaVersion: "v1",
          mode: "relay_signed",
          lane: "fast",
          relaySigned: {
            signedTransaction: relayPayload.relaySigned.signedTransaction,
            encoding: "base64",
          },
        },
        {
          idempotencyKey: "sdk-relay-idem-1",
          headers: {
            "payment-signature": "unit-signed-payment",
          },
        },
      );

      expect(submit.requestId.startsWith("execreq_")).toBe(true);
      expect(submit.state).toBe("validated");

      const status = await client.status(submit.requestId);
      expect(status.requestId).toBe(submit.requestId);
      expect(status.state).toBe("validated");
      expect(status.terminal).toBe(false);

      const receipt = await client.receipt(submit.requestId);
      expect(receipt.requestId).toBe(submit.requestId);
      expect(receipt.ready).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  test("decodes canonical execution errors", async () => {
    const { env, sqlite } = createExecClientEnv();
    try {
      const client = createExecutionClient({
        transport: createWorkerTransport(env),
      });

      try {
        await client.status("not_valid");
        throw new Error("expected status() to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutionClientError);
        const typed = error as ExecutionClientError;
        expect(typed.code).toBe("invalid-request");
        expect(typed.status).toBe(400);
        expect(typed.retryable).toBe(false);
      }
    } finally {
      sqlite.close();
    }
  });

  test("waitForTerminalReceipt retries transient failures", async () => {
    let statusCalls = 0;
    let receiptCalls = 0;
    const transport: ExecutionTransport = async (input) => {
      if (input.path.includes("/status/")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return {
            status: 503,
            payload: {
              ok: false,
              error: {
                code: "submission-failed",
                message: "temporary-status-failure",
              },
            },
          };
        }
        return {
          status: 200,
          payload: {
            ok: true,
            requestId: "execreq_retry1234567890",
            status: {
              state: "finalized",
              terminal: true,
            },
          },
        };
      }
      if (input.path.includes("/receipt/")) {
        receiptCalls += 1;
        return {
          status: 200,
          payload: {
            ok: true,
            requestId: "execreq_retry1234567890",
            ready: true,
            receipt: {
              outcome: {
                status: "finalized",
                signature: "sig_retry",
              },
            },
          },
        };
      }
      return {
        status: 404,
        payload: { ok: false, error: { code: "not-found", message: "nf" } },
      };
    };

    const client = createExecutionClient({
      transport,
      pollIntervalMs: 10,
      pollTimeoutMs: 500,
      requestRetryCount: 2,
      requestRetryBaseDelayMs: 5,
    });

    const terminal = await client.waitForTerminalReceipt({
      requestId: "execreq_retry1234567890",
    });
    expect(terminal.status).toBe("finalized");
    expect(terminal.signature).toBe("sig_retry");
    expect(statusCalls).toBe(2);
    expect(receiptCalls).toBe(1);
  });
});
