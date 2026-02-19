import { describe, expect, test } from "bun:test";
import {
  evaluateStartGate,
  normalizeValidationConfig,
} from "../../apps/worker/src/strategy_validation/engine";

describe("worker start gate", () => {
  test("blocks when no passed validation exists", () => {
    const validation = normalizeValidationConfig({
      enabled: true,
      gateMode: "hard",
      overrideAllowed: true,
    });

    const gate = evaluateStartGate({
      validation,
      strategyHash: "hash-a",
      latest: null,
      nowMs: Date.parse("2026-02-13T12:00:00.000Z"),
    });

    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("strategy-not-validated");
    expect(gate.overrideAllowed).toBe(true);
  });

  test("passes when latest validation passed and is fresh", () => {
    const nowMs = Date.parse("2026-02-13T12:00:00.000Z");
    const validation = normalizeValidationConfig({
      enabled: true,
      gateMode: "hard",
      overrideAllowed: false,
    });

    const gate = evaluateStartGate({
      validation,
      strategyHash: "hash-b",
      latest: {
        status: "passed",
        completedAt: "2026-02-13T02:00:00.000Z",
        createdAt: "2026-02-13T01:59:00.000Z",
      },
      nowMs,
    });

    expect(gate.ok).toBe(true);
    expect(gate.reason).toBeUndefined();
    expect(gate.overrideAllowed).toBe(false);
  });

  test("blocks stale validations older than 24h", () => {
    const validation = normalizeValidationConfig({
      enabled: true,
      gateMode: "hard",
      overrideAllowed: true,
    });

    const gate = evaluateStartGate({
      validation,
      strategyHash: "hash-c",
      latest: {
        status: "passed",
        completedAt: "2026-02-12T10:00:00.000Z",
        createdAt: "2026-02-12T10:00:00.000Z",
      },
      nowMs: Date.parse("2026-02-13T12:30:00.000Z"),
    });

    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("strategy-validation-stale");
  });

  test("soft gate mode never hard-blocks", () => {
    const validation = normalizeValidationConfig({
      enabled: true,
      gateMode: "soft",
    });

    const gate = evaluateStartGate({
      validation,
      strategyHash: "hash-d",
      latest: null,
      nowMs: Date.parse("2026-02-13T12:00:00.000Z"),
    });

    expect(gate.ok).toBe(true);
  });
});
