import { describe, expect, test } from "bun:test";
import {
  assertExecutionStatusTransition,
  canTransitionExecutionStatus,
  isTerminalExecutionStatus,
} from "../../apps/worker/src/execution/lifecycle";

describe("execution lifecycle state machine", () => {
  test("accepts canonical forward transitions", () => {
    expect(canTransitionExecutionStatus("received", "validated")).toBe(true);
    expect(canTransitionExecutionStatus("validated", "queued")).toBe(true);
    expect(canTransitionExecutionStatus("queued", "dispatched")).toBe(true);
    expect(canTransitionExecutionStatus("dispatched", "landed")).toBe(true);
    expect(canTransitionExecutionStatus("landed", "finalized")).toBe(true);
    expect(canTransitionExecutionStatus("landed", "failed")).toBe(true);
    expect(canTransitionExecutionStatus("landed", "expired")).toBe(true);
  });

  test("rejects illegal transitions", () => {
    expect(canTransitionExecutionStatus("received", "queued")).toBe(false);
    expect(canTransitionExecutionStatus("validated", "received")).toBe(false);
    expect(canTransitionExecutionStatus("queued", "landed")).toBe(false);
    expect(canTransitionExecutionStatus("failed", "validated")).toBe(false);
    expect(() =>
      assertExecutionStatusTransition({
        fromStatus: "received",
        toStatus: "queued",
      }),
    ).toThrow(/illegal-execution-status-transition/);
  });

  test("marks terminal statuses correctly", () => {
    expect(isTerminalExecutionStatus("landed")).toBe(true);
    expect(isTerminalExecutionStatus("finalized")).toBe(true);
    expect(isTerminalExecutionStatus("failed")).toBe(true);
    expect(isTerminalExecutionStatus("expired")).toBe(true);
    expect(isTerminalExecutionStatus("rejected")).toBe(true);
    expect(isTerminalExecutionStatus("queued")).toBe(false);
    expect(isTerminalExecutionStatus("dispatched")).toBe(false);
  });
});
