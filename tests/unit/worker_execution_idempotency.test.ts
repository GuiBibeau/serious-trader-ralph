import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hashExecutionSubmitPayload,
  idempotencyScopeForActor,
  normalizeIdempotencyKey,
  readIdempotencyKey,
  reserveExecutionSubmitRequest,
} from "../../apps/worker/src/execution/idempotency";

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

async function withExecutionSchema(
  run: (db: D1Database) => Promise<void> | void,
): Promise<void> {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0025_execution_fabric.sql",
  );
  sqlite.exec(readFileSync(migrationPath, "utf8"));
  const d1 = createSqliteD1Adapter(sqlite);
  try {
    await run(d1);
  } finally {
    sqlite.close();
  }
}

describe("worker execution idempotency engine", () => {
  test("normalizes and reads idempotency key", () => {
    expect(normalizeIdempotencyKey("  abc-123  ")).toBe("abc-123");
    expect(normalizeIdempotencyKey("   ")).toBeNull();

    const request = new Request("https://example.com", {
      headers: {
        "idempotency-key": "  replay-key  ",
      },
    });
    expect(readIdempotencyKey(request)).toBe("replay-key");
  });

  test("builds stable payload hash regardless of object key order", async () => {
    const hashA = await hashExecutionSubmitPayload({
      mode: "relay_signed",
      lane: "fast",
      relay: {
        signedTxBase64: "AAAA",
        hint: "abc",
      },
    });
    const hashB = await hashExecutionSubmitPayload({
      lane: "fast",
      relay: {
        hint: "abc",
        signedTxBase64: "AAAA",
      },
      mode: "relay_signed",
    });
    expect(hashA).toBe(hashB);
  });

  test("scopes idempotency keys to actor identity", () => {
    expect(
      idempotencyScopeForActor({
        actorType: "anonymous_x402",
      }),
    ).toBe("anonymous_x402:anon");
    expect(
      idempotencyScopeForActor({
        actorType: "privy_user",
        actorId: "user_123",
      }),
    ).toBe("privy_user:user_123");
  });

  test("returns created then replay for same actor + key + payload", async () => {
    await withExecutionSchema(async (db) => {
      const payloadHash = await hashExecutionSubmitPayload({
        mode: "relay_signed",
        lane: "fast",
        relay: {
          signedTxBase64: "AAAA",
        },
      });

      const created = await reserveExecutionSubmitRequest({
        db,
        requestId: "req_1",
        idempotencyKey: "idem_1",
        actorType: "anonymous_x402",
        actorId: "bot_a",
        mode: "relay_signed",
        lane: "fast",
        payloadHash,
        nowIso: "2026-03-03T01:00:00.000Z",
      });
      expect(created.result).toBe("created");
      expect(created.request.requestId).toBe("req_1");

      const replay = await reserveExecutionSubmitRequest({
        db,
        requestId: "req_2",
        idempotencyKey: "idem_1",
        actorType: "anonymous_x402",
        actorId: "bot_a",
        mode: "relay_signed",
        lane: "fast",
        payloadHash,
        nowIso: "2026-03-03T01:00:01.000Z",
      });
      expect(replay.result).toBe("replay");
      expect(replay.request.requestId).toBe("req_1");
    });
  });

  test("returns deterministic conflict on same actor + key but different payload", async () => {
    await withExecutionSchema(async (db) => {
      const payloadHashA = await hashExecutionSubmitPayload({
        mode: "relay_signed",
        lane: "fast",
        relay: { signedTxBase64: "AAAA" },
      });
      const payloadHashB = await hashExecutionSubmitPayload({
        mode: "relay_signed",
        lane: "fast",
        relay: { signedTxBase64: "BBBB" },
      });

      await reserveExecutionSubmitRequest({
        db,
        requestId: "req_10",
        idempotencyKey: "idem_conflict",
        actorType: "anonymous_x402",
        actorId: "bot_conflict",
        mode: "relay_signed",
        lane: "fast",
        payloadHash: payloadHashA,
      });

      const conflict = await reserveExecutionSubmitRequest({
        db,
        requestId: "req_11",
        idempotencyKey: "idem_conflict",
        actorType: "anonymous_x402",
        actorId: "bot_conflict",
        mode: "relay_signed",
        lane: "fast",
        payloadHash: payloadHashB,
      });
      expect(conflict.result).toBe("conflict");
      expect(conflict.error).toBe("idempotency-key-conflict");
      expect(conflict.request.requestId).toBe("req_10");
    });
  });

  test("supports concurrent duplicate retries with one created result", async () => {
    await withExecutionSchema(async (db) => {
      const payloadHash = await hashExecutionSubmitPayload({
        mode: "relay_signed",
        lane: "fast",
        relay: { signedTxBase64: "CCCC" },
      });

      const results = await Promise.all(
        Array.from({ length: 6 }, (_value, index) =>
          reserveExecutionSubmitRequest({
            db,
            requestId: `req_parallel_${index}`,
            idempotencyKey: "idem_parallel",
            actorType: "anonymous_x402",
            actorId: "bot_parallel",
            mode: "relay_signed",
            lane: "fast",
            payloadHash,
          }),
        ),
      );

      const createdCount = results.filter(
        (result) => result.result === "created",
      ).length;
      const replayCount = results.filter(
        (result) => result.result === "replay",
      ).length;
      expect(createdCount).toBe(1);
      expect(replayCount).toBe(5);
      const requestIds = new Set(
        results.map((result) => result.request.requestId),
      );
      expect(requestIds.size).toBe(1);
    });
  });
});
