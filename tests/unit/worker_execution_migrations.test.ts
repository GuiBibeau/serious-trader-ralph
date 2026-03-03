import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function withExecutionSchema(run: (db: Database) => void): void {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations/0025_execution_fabric.sql",
    );
    const migrationSql = readFileSync(migrationPath, "utf8");
    db.exec(migrationSql);
    run(db);
  } finally {
    db.close();
  }
}

function insertRequest(
  db: Database,
  overrides?: Partial<{
    requestId: string;
    scope: string;
    key: string;
    payloadHash: string;
    actorType: string;
    actorId: string | null;
    mode: string;
    lane: string;
    status: string;
  }>,
): void {
  const requestId = overrides?.requestId ?? crypto.randomUUID();
  const scope = overrides?.scope ?? "anonymous_x402:anon";
  const key = overrides?.key ?? `idem_${crypto.randomUUID()}`;
  const payloadHash = overrides?.payloadHash ?? "sha256_payload_hash";
  const actorType = overrides?.actorType ?? "anonymous_x402";
  const actorId = overrides?.actorId ?? "anon";
  const mode = overrides?.mode ?? "relay_signed";
  const lane = overrides?.lane ?? "fast";
  const status = overrides?.status ?? "received";

  db.query(
    `
      INSERT INTO execution_requests (
        request_id,
        idempotency_scope,
        idempotency_key,
        payload_hash,
        actor_type,
        actor_id,
        mode,
        lane,
        status,
        received_at,
        validated_at,
        created_at,
        updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10, ?10)
      `,
  ).run(
    requestId,
    scope,
    key,
    payloadHash,
    actorType,
    actorId,
    mode,
    lane,
    status,
    "2026-03-03T00:00:00.000Z",
  );
}

describe("worker execution schema migration", () => {
  test("creates all execution tables", () => {
    withExecutionSchema((db) => {
      const tableNames = db
        .query(
          `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'execution_requests',
              'execution_attempts',
              'execution_status_events',
              'execution_receipts'
            )
          ORDER BY name
          `,
        )
        .all() as Array<{ name: string }>;

      expect(tableNames.map((row) => row.name)).toEqual([
        "execution_attempts",
        "execution_receipts",
        "execution_requests",
        "execution_status_events",
      ]);
    });
  });

  test("enforces idempotency uniqueness on execution_requests", () => {
    withExecutionSchema((db) => {
      insertRequest(db, {
        requestId: "req_1",
        scope: "anonymous_x402:anon",
        key: "same-key",
        payloadHash: "payload-1",
      });

      expect(() =>
        insertRequest(db, {
          requestId: "req_2",
          scope: "anonymous_x402:anon",
          key: "same-key",
          payloadHash: "payload-1",
        }),
      ).toThrow();
    });
  });

  test("enforces single canonical receipt per request", () => {
    withExecutionSchema((db) => {
      insertRequest(db, { requestId: "req_1", key: "key-1" });
      insertRequest(db, { requestId: "req_2", key: "key-2" });

      db.query(
        `
          INSERT INTO execution_receipts (
            request_id,
            receipt_id,
            finalized_status,
            lane,
            provider,
            ready_at,
            created_at,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
          `,
      ).run(
        "req_1",
        "receipt_1",
        "landed",
        "fast",
        "helius_sender",
        "2026-03-03T00:01:00.000Z",
      );

      expect(() =>
        db
          .query(
            `
            INSERT INTO execution_receipts (
              request_id,
              receipt_id,
              finalized_status,
              lane,
              provider,
              ready_at,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
            `,
          )
          .run(
            "req_1",
            "receipt_2",
            "landed",
            "fast",
            "helius_sender",
            "2026-03-03T00:02:00.000Z",
          ),
      ).toThrow();

      expect(() =>
        db
          .query(
            `
            INSERT INTO execution_receipts (
              request_id,
              receipt_id,
              finalized_status,
              lane,
              provider,
              ready_at,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
            `,
          )
          .run(
            "req_2",
            "receipt_1",
            "landed",
            "fast",
            "helius_sender",
            "2026-03-03T00:03:00.000Z",
          ),
      ).toThrow();
    });
  });

  test("cascades child rows when request is deleted", () => {
    withExecutionSchema((db) => {
      insertRequest(db, { requestId: "req_1", key: "key-1" });

      db.query(
        `
          INSERT INTO execution_attempts (
            attempt_id,
            request_id,
            attempt_no,
            lane,
            provider,
            status,
            started_at,
            created_at,
            updated_at
          ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?6, ?6)
          `,
      ).run(
        "attempt_1",
        "req_1",
        "fast",
        "helius_sender",
        "dispatched",
        "2026-03-03T00:10:00.000Z",
      );

      db.query(
        `
          INSERT INTO execution_status_events (
            event_id,
            request_id,
            seq,
            status,
            reason,
            created_at
          ) VALUES (?1, ?2, 1, ?3, ?4, ?5)
          `,
      ).run("event_1", "req_1", "received", null, "2026-03-03T00:10:01.000Z");

      db.query(
        `
          INSERT INTO execution_receipts (
            request_id,
            receipt_id,
            finalized_status,
            lane,
            provider,
            ready_at,
            created_at,
            updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
          `,
      ).run(
        "req_1",
        "receipt_1",
        "landed",
        "fast",
        "helius_sender",
        "2026-03-03T00:10:02.000Z",
      );

      db.query("DELETE FROM execution_requests WHERE request_id = ?1").run(
        "req_1",
      );

      const attemptsCount = db
        .query("SELECT COUNT(*) as count FROM execution_attempts")
        .get() as { count: number };
      const eventsCount = db
        .query("SELECT COUNT(*) as count FROM execution_status_events")
        .get() as { count: number };
      const receiptsCount = db
        .query("SELECT COUNT(*) as count FROM execution_receipts")
        .get() as { count: number };

      expect(attemptsCount.count).toBe(0);
      expect(eventsCount.count).toBe(0);
      expect(receiptsCount.count).toBe(0);
    });
  });
});
