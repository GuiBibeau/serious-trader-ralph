import { describe, expect, test } from "bun:test";
import {
  classifyStaleness,
  computeTimeSkewMs,
} from "../../apps/portal/app/terminal/components/terminal-status-bar";

describe("portal terminal status bar helpers", () => {
  test("classifies freshness from timestamps", () => {
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      expect(classifyStaleness(now - 1_000, 5_000)).toBe("fresh");
      expect(classifyStaleness(now - 6_000, 5_000)).toBe("stale");
      expect(classifyStaleness(null, 5_000)).toBe("missing");
    } finally {
      Date.now = originalNow;
    }
  });

  test("computes server/client clock skew", () => {
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const serverIso = new Date(now - 2_500).toISOString();
      expect(computeTimeSkewMs(serverIso)).toBeCloseTo(2_500, -2);
      expect(computeTimeSkewMs("not-a-date")).toBeNull();
      expect(computeTimeSkewMs(null)).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });
});
