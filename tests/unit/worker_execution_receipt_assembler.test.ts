import { describe, expect, test } from "bun:test";
import {
  assembleCanonicalExecutionReceiptV1,
  canonicalExecutionReceiptStorageKey,
} from "../../apps/worker/src/execution/receipt_assembler";

describe("execution receipt assembler", () => {
  test("builds canonical receipt from request, attempts, and terminal receipt row", () => {
    const receipt = assembleCanonicalExecutionReceiptV1({
      request: {
        requestId: "execreq_1",
        schemaVersion: "v1",
        idempotencyScope: "anonymous_x402:anon",
        idempotencyKey: "idem_1",
        payloadHash: "hash_1",
        actorType: "anonymous_x402",
        actorId: null,
        mode: "relay_signed",
        lane: "fast",
        status: "landed",
        statusReason: null,
        metadata: null,
        receivedAt: "2026-03-03T00:00:00.000Z",
        validatedAt: "2026-03-03T00:00:01.000Z",
        terminalAt: "2026-03-03T00:00:03.000Z",
        createdAt: "2026-03-03T00:00:00.000Z",
        updatedAt: "2026-03-03T00:00:03.000Z",
      },
      receipt: {
        requestId: "execreq_1",
        receiptId: "exec_abc123",
        schemaVersion: "v1",
        finalizedStatus: "landed",
        lane: "fast",
        provider: "helius_sender",
        signature: "sig_1",
        slot: 123,
        errorCode: null,
        errorMessage: null,
        receipt: null,
        readyAt: "2026-03-03T00:00:04.000Z",
        createdAt: "2026-03-03T00:00:04.000Z",
        updatedAt: "2026-03-03T00:00:04.000Z",
      },
      attempts: [
        {
          attemptId: "attempt_1",
          requestId: "execreq_1",
          attemptNo: 1,
          lane: "fast",
          provider: "helius_sender",
          status: "dispatched",
          providerRequestId: "prov_1",
          providerResponse: null,
          errorCode: null,
          errorMessage: null,
          startedAt: "2026-03-03T00:00:02.000Z",
          completedAt: "2026-03-03T00:00:03.000Z",
          createdAt: "2026-03-03T00:00:02.000Z",
          updatedAt: "2026-03-03T00:00:03.000Z",
        },
      ],
      immutability: {
        hashAlgorithm: "sha256",
        receivedTxHash: "sha256:abc",
      },
    });

    expect(receipt.schemaVersion).toBe("v1");
    expect(receipt.receiptId).toBe("exec_abc123");
    expect(receipt.requestId).toBe("execreq_1");
    expect(receipt.outcome.status).toBe("finalized");
    expect(receipt.trace.dispatchedAt).toBe("2026-03-03T00:00:02.000Z");
    expect(receipt.trace.landedAt).toBe("2026-03-03T00:00:04.000Z");
    expect(receipt.attempts.length).toBe(1);
    expect(receipt.immutability?.hashAlgorithm).toBe("sha256");
  });

  test("derives stable storage key by request id", () => {
    expect(canonicalExecutionReceiptStorageKey("execreq_abc")).toBe(
      "exec/v1/receipts/request_id=execreq_abc.json",
    );
  });
});
