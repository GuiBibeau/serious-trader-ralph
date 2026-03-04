import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

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

function createExecObservabilityEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
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
      ADMIN_TOKEN: "admin-secret",
      EXEC_OBS_ALERT_MIN_SAMPLE_SIZE: "1",
      EXEC_OBS_ALERT_FAIL_RATE_WARN: "0.2",
      EXEC_OBS_ALERT_FAIL_RATE_CRITICAL: "0.5",
      ...overrides,
    },
  });
  return { env, sqlite };
}

function seedExecutionObservabilityFixtures(sqlite: Database): void {
  const now = Date.now();
  const requestReceivedBase = now - 30_000;

  const req1 = "execreq_aaaaaaaaaaaaaaaa";
  const req2 = "execreq_bbbbbbbbbbbbbbbb";
  const req3 = "execreq_cccccccccccccccc";

  const req1Received = new Date(requestReceivedBase - 2_000).toISOString();
  const req2Received = new Date(requestReceivedBase - 1_500).toISOString();
  const req3Received = new Date(requestReceivedBase - 1_000).toISOString();

  const req1Terminal = new Date(requestReceivedBase + 7_000).toISOString();
  const req2Terminal = new Date(requestReceivedBase + 12_000).toISOString();
  const req3Terminal = new Date(requestReceivedBase + 18_000).toISOString();

  sqlite
    .query(
      `INSERT INTO execution_requests (
        request_id,
        idempotency_scope,
        idempotency_key,
        payload_hash,
        actor_type,
        actor_id,
        mode,
        lane,
        status,
        status_reason,
        metadata_json,
        received_at,
        validated_at,
        terminal_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .run(
      req1,
      "x402",
      "idem-obs-1",
      "hash-1",
      "anonymous_x402",
      null,
      "relay_signed",
      "fast",
      "finalized",
      null,
      null,
      req1Received,
      req1Received,
      req1Terminal,
    );
  sqlite
    .query(
      `INSERT INTO execution_requests (
        request_id,
        idempotency_scope,
        idempotency_key,
        payload_hash,
        actor_type,
        actor_id,
        mode,
        lane,
        status,
        status_reason,
        metadata_json,
        received_at,
        validated_at,
        terminal_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .run(
      req2,
      "x402",
      "idem-obs-2",
      "hash-2",
      "anonymous_x402",
      null,
      "relay_signed",
      "protected",
      "failed",
      "venue-timeout",
      null,
      req2Received,
      req2Received,
      req2Terminal,
    );
  sqlite
    .query(
      `INSERT INTO execution_requests (
        request_id,
        idempotency_scope,
        idempotency_key,
        payload_hash,
        actor_type,
        actor_id,
        mode,
        lane,
        status,
        status_reason,
        metadata_json,
        received_at,
        validated_at,
        terminal_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .run(
      req3,
      "user",
      "idem-obs-3",
      "hash-3",
      "privy_user",
      "user_1",
      "privy_execute",
      "safe",
      "expired",
      "expired-blockhash",
      null,
      req3Received,
      req3Received,
      req3Terminal,
    );

  sqlite
    .query(
      `INSERT INTO execution_status_events (
        event_id,
        request_id,
        seq,
        status,
        reason,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .run(
      "event-1",
      req1,
      1,
      "dispatched",
      null,
      null,
      new Date(requestReceivedBase - 1_500).toISOString(),
    );
  sqlite
    .query(
      `INSERT INTO execution_status_events (
        event_id,
        request_id,
        seq,
        status,
        reason,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .run(
      "event-2",
      req1,
      2,
      "landed",
      null,
      null,
      new Date(requestReceivedBase + 4_000).toISOString(),
    );
  sqlite
    .query(
      `INSERT INTO execution_status_events (
        event_id,
        request_id,
        seq,
        status,
        reason,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .run(
      "event-3",
      req2,
      1,
      "dispatched",
      null,
      null,
      new Date(requestReceivedBase - 1_000).toISOString(),
    );
  sqlite
    .query(
      `INSERT INTO execution_status_events (
        event_id,
        request_id,
        seq,
        status,
        reason,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .run(
      "event-4",
      req3,
      1,
      "dispatched",
      null,
      null,
      new Date(requestReceivedBase - 900).toISOString(),
    );

  sqlite
    .query(
      `INSERT INTO execution_attempts (
        attempt_id,
        request_id,
        attempt_no,
        lane,
        provider,
        status,
        provider_request_id,
        provider_response_json,
        error_code,
        error_message,
        started_at,
        completed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .run(
      "attempt-1",
      req1,
      1,
      "fast",
      "helius",
      "finalized",
      null,
      null,
      null,
      null,
      req1Received,
      req1Terminal,
    );
  sqlite
    .query(
      `INSERT INTO execution_attempts (
        attempt_id,
        request_id,
        attempt_no,
        lane,
        provider,
        status,
        provider_request_id,
        provider_response_json,
        error_code,
        error_message,
        started_at,
        completed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .run(
      "attempt-2",
      req2,
      1,
      "protected",
      "jito",
      "error",
      null,
      null,
      "venue-timeout",
      "timeout",
      req2Received,
      req2Terminal,
    );
  sqlite
    .query(
      `INSERT INTO execution_attempts (
        attempt_id,
        request_id,
        attempt_no,
        lane,
        provider,
        status,
        provider_request_id,
        provider_response_json,
        error_code,
        error_message,
        started_at,
        completed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .run(
      "attempt-3",
      req3,
      1,
      "safe",
      "jito",
      "error",
      null,
      null,
      "expired-blockhash",
      "expired",
      req3Received,
      req3Terminal,
    );
  sqlite
    .query(
      `INSERT INTO execution_attempts (
        attempt_id,
        request_id,
        attempt_no,
        lane,
        provider,
        status,
        provider_request_id,
        provider_response_json,
        error_code,
        error_message,
        started_at,
        completed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .run(
      "attempt-4",
      req3,
      2,
      "safe",
      "jito",
      "expired",
      null,
      null,
      "expired-blockhash",
      "expired",
      req3Received,
      req3Terminal,
    );
}

describe("worker execution observability route", () => {
  test("requires admin bearer token", async () => {
    const { env, sqlite } = createExecObservabilityEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/execution/observability"),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "auth-required",
      });
    } finally {
      sqlite.close();
    }
  });

  test("returns execution metrics, dimensions, and alert states", async () => {
    const { env, sqlite } = createExecObservabilityEnv();
    try {
      seedExecutionObservabilityFixtures(sqlite);
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/execution/observability?windowMinutes=120&maxRequests=100",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok?: boolean;
        totals?: {
          accepted?: number;
          succeeded?: number;
          failed?: number;
          expired?: number;
          duplicateRate?: number;
          failRate?: number;
        };
        latenciesMs?: {
          dispatch?: { count?: number };
          finalization?: { count?: number };
        };
        dimensions?: {
          provider?: Array<{
            provider?: string;
            attempts?: number;
          }>;
          lane?: Array<{
            key?: string;
            accepted?: number;
          }>;
        };
        alerts?: Array<{
          code?: string;
          state?: string;
        }>;
      };
      expect(body.ok).toBe(true);
      expect(body.totals?.accepted).toBe(3);
      expect(body.totals?.succeeded).toBe(1);
      expect(body.totals?.failed).toBe(2);
      expect(body.totals?.expired).toBe(1);
      expect(body.totals?.duplicateRate).toBeCloseTo(1 / 3, 6);
      expect(body.totals?.failRate).toBeCloseTo(2 / 3, 6);
      expect(body.latenciesMs?.dispatch?.count).toBe(3);
      expect(body.latenciesMs?.finalization?.count).toBe(3);
      const jito = body.dimensions?.provider?.find(
        (entry) => entry.provider === "jito",
      );
      expect(jito?.attempts).toBe(3);
      const fastLane = body.dimensions?.lane?.find(
        (entry) => entry.key === "fast",
      );
      expect(fastLane?.accepted).toBe(1);
      const failRateAlert = body.alerts?.find(
        (entry) => entry.code === "fail-rate",
      );
      expect(failRateAlert?.state).toBe("critical");
    } finally {
      sqlite.close();
    }
  });

  test("returns 503 when admin auth is not configured", async () => {
    const { env, sqlite } = createExecObservabilityEnv({ ADMIN_TOKEN: "" });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/admin/execution/observability"),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "admin-auth-not-configured",
      });
    } finally {
      sqlite.close();
    }
  });
});
