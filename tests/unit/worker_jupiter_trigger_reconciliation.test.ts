import { describe, expect, test } from "bun:test";
import type { JupiterTrackedTriggerOrder } from "../../apps/worker/src/execution/jupiter_trigger";
import { summarizeJupiterTriggerOrder } from "../../apps/worker/src/execution/jupiter_trigger";
import { buildTerminalJupiterTriggerReceipt } from "../../apps/worker/src/execution/jupiter_trigger_reconciliation";
import type { ExecutionLatestStatusRecord } from "../../apps/worker/src/execution/repository";

function createLatest(): ExecutionLatestStatusRecord {
  return {
    request: {
      requestId: "req_123",
      schemaVersion: "v1",
      idempotencyScope: "scope",
      idempotencyKey: "key",
      payloadHash: "hash",
      actorType: "privy_user",
      actorId: "user_123",
      mode: "privy_execute",
      lane: "safe",
      status: "failed",
      statusReason: "conditional-order-cancelled",
      metadata: null,
      receivedAt: "2026-03-13T00:00:00.000Z",
      validatedAt: "2026-03-13T00:00:01.000Z",
      terminalAt: "2026-03-13T00:00:02.000Z",
      createdAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:02.000Z",
    },
    latestEvent: null,
    latestAttempt: {
      attemptId: "attempt_123",
      requestId: "req_123",
      attemptNo: 1,
      lane: "safe",
      provider: "jupiter",
      status: "failed",
      providerRequestId: "prov_123",
      providerResponse: null,
      errorCode: "order-cancelled",
      errorMessage: "Conditional spot order was cancelled.",
      startedAt: "2026-03-13T00:00:00.000Z",
      completedAt: "2026-03-13T00:00:02.000Z",
      createdAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:02.000Z",
    },
    receipt: null,
  };
}

function createTrackedOrder(): JupiterTrackedTriggerOrder {
  return {
    maker: "11111111111111111111111111111111",
    order: "order_123",
    instrumentId: "SOL/USDC",
    side: "buy",
    orderType: "limit",
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: "So11111111111111111111111111111111111111112",
    makingAmount: "100000000",
    takingAmount: "1000000000",
  };
}

describe("worker Jupiter trigger reconciliation receipts", () => {
  test("uses terminal cancelled status when the Jupiter snapshot is stale", () => {
    const summary = summarizeJupiterTriggerOrder({
      order: "order_123",
      status: "Cancelled",
      closeTx: "sig_cancel",
    });

    const receipt = buildTerminalJupiterTriggerReceipt({
      latest: createLatest(),
      trackedOrder: createTrackedOrder(),
      orderRecord: {
        order: "order_123",
        status: "Open",
      },
      summary,
    });

    const triggerOrder = receipt.receipt.triggerOrder as Record<
      string,
      unknown
    >;
    expect(triggerOrder.status).toBe("Cancelled");
    expect(receipt.receipt.lifecycle).toMatchObject({
      orderState: "cancelled",
    });
  });
});
