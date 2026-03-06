import { describe, expect, test } from "bun:test";
import {
  buildRollbackSummary,
  resolveRollbackTarget,
} from "../../src/ops/rollback";

describe("ops rollback helpers", () => {
  test("prefers an explicit rollback sha", () => {
    expect(
      resolveRollbackTarget({
        requestedSha: "abc123",
        previousMainSha: "def456",
      }),
    ).toEqual({
      targetSha: "abc123",
      source: "input",
    });
  });

  test("falls back to previous main sha", () => {
    expect(
      resolveRollbackTarget({
        requestedSha: "",
        previousMainSha: "def456",
      }),
    ).toEqual({
      targetSha: "def456",
      source: "previous-main",
    });
  });

  test("throws when no rollback target is available", () => {
    expect(() =>
      resolveRollbackTarget({
        requestedSha: "",
        previousMainSha: "",
      }),
    ).toThrow("rollback-target-missing");
  });

  test("builds rollback summary markdown", () => {
    const summary = buildRollbackSummary({
      targetSha: "def456",
      source: "previous-main",
      portalUrl: "https://trader-ralph.com",
      apiUrl: "https://api.trader-ralph.com",
      status: "success",
      reason: "post-deploy smoke failure",
    });

    expect(summary).toContain("## Production Rollback");
    expect(summary).toContain("- status: success");
    expect(summary).toContain("- targetSha: def456");
  });
});
