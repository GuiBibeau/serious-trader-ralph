import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRelayImmutabilitySnapshot } from "../../apps/worker/src/execution/relay_immutability";
import {
  appendExecutionStatusEvent,
  createExecutionAttemptIdempotent,
  createExecutionRequestIdempotent,
  finalizeExecutionAttempt,
  getExecutionLatestStatus,
  getExecutionRequestById,
  getExecutionRequestByIdempotency,
  listExecutionAttempts,
  listExecutionStatusEvents,
  terminalizeExecutionRequest,
  updateExecutionRequestStatus,
  upsertExecutionReceiptIdempotent,
} from "../../apps/worker/src/execution/repository";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

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

async function withExecutionRepo(
  run: (db: Database, d1: D1Database) => Promise<void> | void,
): Promise<void> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0025_execution_fabric.sql",
  );
  db.exec(readFileSync(migrationPath, "utf8"));
  const d1 = createSqliteD1Adapter(db);
  try {
    await run(db, d1);
  } finally {
    db.close();
  }
}

describe("worker execution repository", () => {
  test("creates and reuses execution request idempotently", async () => {
    await withExecutionRepo(async (_db, d1) => {
      const created = await createExecutionRequestIdempotent(d1, {
        requestId: "req_1",
        idempotencyScope: "anonymous_x402:anon",
        idempotencyKey: "idem_1",
        payloadHash: "payload_hash_1",
        actorType: "anonymous_x402",
        actorId: "anon",
        mode: "relay_signed",
        lane: "fast",
        metadata: {
          source: "unit",
          retries: 0,
        },
        nowIso: "2026-03-03T00:00:00.000Z",
      });
      expect(created.created).toBe(true);
      expect(created.row.requestId).toBe("req_1");

      const reused = await createExecutionRequestIdempotent(d1, {
        requestId: "req_1_duplicate",
        idempotencyScope: "anonymous_x402:anon",
        idempotencyKey: "idem_1",
        payloadHash: "payload_hash_1",
        actorType: "anonymous_x402",
        actorId: "anon",
        mode: "relay_signed",
        lane: "fast",
      });
      expect(reused.created).toBe(false);
      expect(reused.row.requestId).toBe("req_1");

      const byId = await getExecutionRequestById(d1, "req_1");
      expect(byId?.idempotencyKey).toBe("idem_1");
      const byIdempotency = await getExecutionRequestByIdempotency(
        d1,
        "anonymous_x402:anon",
        "idem_1",
      );
      expect(byIdempotency?.requestId).toBe("req_1");
    });
  });

  test("updates request status and appends ordered lifecycle events", async () => {
    await withExecutionRepo(async (_db, d1) => {
      await createExecutionRequestIdempotent(d1, {
        requestId: "req_2",
        idempotencyScope: "privy_user:user_1",
        idempotencyKey: "idem_2",
        payloadHash: "payload_hash_2",
        actorType: "privy_user",
        actorId: "user_1",
        mode: "privy_execute",
        lane: "protected",
      });

      const validated = await updateExecutionRequestStatus(d1, {
        requestId: "req_2",
        status: "validated",
        statusReason: null,
        nowIso: "2026-03-03T00:01:00.000Z",
      });
      expect(validated?.status).toBe("validated");
      expect(validated?.validatedAt).toBe("2026-03-03T00:01:00.000Z");

      await appendExecutionStatusEvent(d1, {
        requestId: "req_2",
        status: "received",
        createdAt: "2026-03-03T00:00:59.000Z",
      });
      await appendExecutionStatusEvent(d1, {
        requestId: "req_2",
        status: "validated",
        createdAt: "2026-03-03T00:01:00.000Z",
      });
      await appendExecutionStatusEvent(d1, {
        requestId: "req_2",
        status: "dispatched",
        createdAt: "2026-03-03T00:01:01.000Z",
      });

      const events = await listExecutionStatusEvents(d1, "req_2");
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(events.map((event) => event.status)).toEqual([
        "received",
        "validated",
        "dispatched",
      ]);
    });
  });

  test("terminalization helper prevents duplicate terminalization under concurrency", async () => {
    await withExecutionRepo(async (_db, d1) => {
      await createExecutionRequestIdempotent(d1, {
        requestId: "req_3",
        idempotencyScope: "anonymous_x402:bot_1",
        idempotencyKey: "idem_3",
        payloadHash: "payload_hash_3",
        actorType: "anonymous_x402",
        actorId: "bot_1",
        mode: "relay_signed",
        lane: "fast",
      });

      const results = await Promise.all(
        Array.from({ length: 8 }, (_value, index) =>
          terminalizeExecutionRequest(d1, {
            requestId: "req_3",
            status: "failed",
            statusReason: `err-${index}`,
            nowIso: `2026-03-03T00:02:0${index}.000Z`,
          }),
        ),
      );
      const appliedCount = results.filter((result) => result.applied).length;
      expect(appliedCount).toBe(1);

      const events = await listExecutionStatusEvents(d1, "req_3");
      const terminalEvents = events.filter(
        (event) => event.status === "failed",
      );
      expect(terminalEvents.length).toBe(1);

      const request = await getExecutionRequestById(d1, "req_3");
      expect(request?.status).toBe("failed");
      expect(request?.terminalAt).toBeString();
    });
  });

  test("creates/finalizes attempts and writes canonical receipt idempotently", async () => {
    await withExecutionRepo(async (_db, d1) => {
      await createExecutionRequestIdempotent(d1, {
        requestId: "req_4",
        idempotencyScope: "privy_user:user_4",
        idempotencyKey: "idem_4",
        payloadHash: "payload_hash_4",
        actorType: "privy_user",
        actorId: "user_4",
        mode: "privy_execute",
        lane: "protected",
      });

      const attempt = await createExecutionAttemptIdempotent(d1, {
        attemptId: "attempt_1",
        requestId: "req_4",
        attemptNo: 1,
        lane: "protected",
        provider: "jito",
        status: "dispatched",
        providerRequestId: "provider_1",
        providerResponse: { accepted: true },
        startedAt: "2026-03-03T00:03:00.000Z",
      });
      expect(attempt.created).toBe(true);
      expect(attempt.row.status).toBe("dispatched");

      const attemptDuplicate = await createExecutionAttemptIdempotent(d1, {
        attemptId: "attempt_1_dup",
        requestId: "req_4",
        attemptNo: 1,
        lane: "protected",
        provider: "jito",
        status: "dispatched",
      });
      expect(attemptDuplicate.created).toBe(false);
      expect(attemptDuplicate.row.attemptId).toBe("attempt_1");

      const finalizedAttempt = await finalizeExecutionAttempt(d1, {
        attemptId: "attempt_1",
        status: "landed",
        providerResponse: {
          signature: "sig_1",
        },
        completedAt: "2026-03-03T00:03:02.000Z",
      });
      expect(finalizedAttempt?.status).toBe("landed");
      expect(finalizedAttempt?.completedAt).toBe("2026-03-03T00:03:02.000Z");

      const attempts = await listExecutionAttempts(d1, "req_4");
      expect(attempts.length).toBe(1);
      expect(attempts[0]?.status).toBe("landed");

      const receipt = await upsertExecutionReceiptIdempotent(d1, {
        requestId: "req_4",
        receiptId: "receipt_1",
        finalizedStatus: "landed",
        lane: "protected",
        provider: "jito",
        signature: "sig_1",
        slot: 123,
        receipt: {
          route: "jito",
          signatures: ["sig_1"],
        },
        readyAt: "2026-03-03T00:03:03.000Z",
      });
      expect(receipt.created).toBe(true);
      expect(receipt.row.receiptId).toBe("receipt_1");

      const receiptDuplicate = await upsertExecutionReceiptIdempotent(d1, {
        requestId: "req_4",
        receiptId: "receipt_2",
        finalizedStatus: "landed",
        lane: "protected",
      });
      expect(receiptDuplicate.created).toBe(false);
      expect(receiptDuplicate.row.receiptId).toBe("receipt_1");
    });
  });

  test("builds latest-status projection for status endpoint reads", async () => {
    await withExecutionRepo(async (_db, d1) => {
      await createExecutionRequestIdempotent(d1, {
        requestId: "req_5",
        idempotencyScope: "api_key_actor:svc_1",
        idempotencyKey: "idem_5",
        payloadHash: "payload_hash_5",
        actorType: "api_key_actor",
        actorId: "svc_1",
        mode: "relay_signed",
        lane: "fast",
      });

      await appendExecutionStatusEvent(d1, {
        requestId: "req_5",
        status: "received",
        createdAt: "2026-03-03T00:04:00.000Z",
      });
      await appendExecutionStatusEvent(d1, {
        requestId: "req_5",
        status: "validated",
        createdAt: "2026-03-03T00:04:01.000Z",
      });

      await createExecutionAttemptIdempotent(d1, {
        attemptId: "attempt_5_1",
        requestId: "req_5",
        attemptNo: 1,
        lane: "fast",
        provider: "helius_sender",
        status: "dispatched",
        startedAt: "2026-03-03T00:04:02.000Z",
      });
      await upsertExecutionReceiptIdempotent(d1, {
        requestId: "req_5",
        receiptId: "receipt_5",
        finalizedStatus: "landed",
        lane: "fast",
        provider: "helius_sender",
        signature: "sig_5",
        readyAt: "2026-03-03T00:04:04.000Z",
      });

      const latest = await getExecutionLatestStatus(d1, "req_5");
      expect(latest).not.toBeNull();
      expect(latest?.request.requestId).toBe("req_5");
      expect(latest?.latestEvent?.status).toBe("validated");
      expect(latest?.latestAttempt?.attemptNo).toBe(1);
      expect(latest?.receipt?.receiptId).toBe("receipt_5");
    });
  });

  test("enforces relay immutability before attempt creation when provided", async () => {
    await withExecutionRepo(async (_db, d1) => {
      await createExecutionRequestIdempotent(d1, {
        requestId: "req_6",
        idempotencyScope: "anonymous_x402:bot_6",
        idempotencyKey: "idem_6",
        payloadHash: "payload_hash_6",
        actorType: "anonymous_x402",
        actorId: "bot_6",
        mode: "relay_signed",
        lane: "fast",
      });

      const relayPayload = buildRelaySignedPayload();
      const relaySnapshot = await createRelayImmutabilitySnapshot({
        signedTransactionBase64: relayPayload.relaySigned.signedTransaction,
      });
      expect(relaySnapshot).not.toBeNull();
      if (!relaySnapshot) return;

      const created = await createExecutionAttemptIdempotent(d1, {
        attemptId: "attempt_6_1",
        requestId: "req_6",
        attemptNo: 1,
        lane: "fast",
        provider: "helius_sender",
        status: "dispatched",
        relayImmutability: {
          expectedReceivedTxHash: relaySnapshot.receivedTxHash,
          signedTransactionBase64: relayPayload.relaySigned.signedTransaction,
        },
        startedAt: "2026-03-03T00:05:00.000Z",
      });
      expect(created.created).toBe(true);
      expect(
        created.row.providerResponse?.relayImmutability?.receivedTxHash,
      ).toBe(relaySnapshot.receivedTxHash);

      await expect(
        createExecutionAttemptIdempotent(d1, {
          attemptId: "attempt_6_2",
          requestId: "req_6",
          attemptNo: 2,
          lane: "fast",
          provider: "helius_sender",
          status: "dispatched",
          relayImmutability: {
            expectedReceivedTxHash: relaySnapshot.receivedTxHash,
            signedTransactionBase64: buildRelaySignedPayload({ lamports: 2 })
              .relaySigned.signedTransaction,
          },
          startedAt: "2026-03-03T00:05:01.000Z",
        }),
      ).rejects.toThrow("execution-attempt-policy-denied");
    });
  });
});
