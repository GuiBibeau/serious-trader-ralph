import { describe, expect, test } from "bun:test";
import {
  type ExecutionInspectorSnapshot,
  normalizeInspectorError,
  parseReceiptPayload,
  parseStatusPayload,
} from "../../apps/portal/app/terminal/components/execution-inspector-drawer";

describe("portal terminal execution inspector parsers", () => {
  test("parses status payload with events and attempts", () => {
    const parsed = parseStatusPayload({
      ok: true,
      requestId: "execreq_123",
      status: {
        state: "dispatched",
        terminal: false,
        mode: "privy_execute",
        lane: "safe",
        actorType: "privy_user",
      },
      events: [
        { state: "validated", at: "2026-03-04T00:00:00.000Z" },
        {
          state: "dispatched",
          at: "2026-03-04T00:00:02.000Z",
          provider: "jito",
          attempt: 1,
          note: "submitted",
        },
      ],
      attempts: [
        {
          attempt: 1,
          provider: "jito",
          state: "dispatched",
          at: "2026-03-04T00:00:02.000Z",
        },
      ],
    });
    expect(parsed.requestId).toBe("execreq_123");
    expect(parsed.status.state).toBe("dispatched");
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[1]?.provider).toBe("jito");
    expect(parsed.attempts[0]?.attempt).toBe(1);
  });

  test("parses ready and non-ready receipt payloads", () => {
    const notReady = parseReceiptPayload({
      ok: true,
      requestId: "execreq_123",
      ready: false,
    });
    expect(notReady.ready).toBe(false);
    expect(notReady.receiptId).toBeNull();

    const ready = parseReceiptPayload({
      ok: true,
      requestId: "execreq_123",
      ready: true,
      receipt: {
        receiptId: "execrcpt_123",
        provider: "jito",
        generatedAt: "2026-03-04T00:00:03.000Z",
        outcome: {
          status: "finalized",
          signature: "sig_123",
          errorCode: null,
          errorMessage: null,
        },
      },
    });
    expect(ready.ready).toBe(true);
    expect(ready.receiptId).toBe("execrcpt_123");
    expect(ready.provider).toBe("jito");
    expect(ready.outcomeStatus).toBe("finalized");
    expect(ready.signature).toBe("sig_123");
  });

  test("normalizes inspector errors from receipt or terminal status", () => {
    const withReceiptError: ExecutionInspectorSnapshot = {
      requestId: "execreq_1",
      status: {
        state: "failed",
        terminal: true,
        mode: "privy_execute",
        lane: "safe",
        actorType: "privy_user",
        receivedAt: null,
        updatedAt: null,
        terminalAt: null,
      },
      events: [],
      attempts: [],
      receipt: {
        ready: true,
        receiptId: "execrcpt_1",
        provider: "jito",
        generatedAt: null,
        outcomeStatus: "failed",
        signature: null,
        errorCode: "submission-failed",
        errorMessage: "timeout",
        raw: {},
      },
    };
    expect(normalizeInspectorError(withReceiptError)).toBe(
      "submission-failed: timeout",
    );

    const statusOnly: ExecutionInspectorSnapshot = {
      ...withReceiptError,
      receipt: {
        ready: false,
        receiptId: null,
        provider: null,
        generatedAt: null,
        outcomeStatus: null,
        signature: null,
        errorCode: null,
        errorMessage: null,
        raw: null,
      },
    };
    expect(normalizeInspectorError(statusOnly)).toBe("execution-failed");
  });
});
