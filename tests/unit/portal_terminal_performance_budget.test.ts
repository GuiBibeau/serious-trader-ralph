import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TERMINAL_RENDER_BUDGET,
  evaluateTerminalRenderBudget,
} from "../../apps/portal/app/terminal/components/terminal-performance";

describe("portal terminal performance budget", () => {
  test("passes snapshot inside budget", () => {
    const result = evaluateTerminalRenderBudget({
      fps: 58,
      avgFrameMs: 17.2,
      p95FrameMs: 24,
      renderPerSec: 42,
    });
    expect(result.ok).toBe(true);
    expect(result.level).toBe("good");
    expect(result.violations.length).toBe(0);
  });

  test("flags single-budget warning and multi-budget failure", () => {
    const warn = evaluateTerminalRenderBudget({
      fps: 40,
      avgFrameMs: DEFAULT_TERMINAL_RENDER_BUDGET.maxAvgFrameMs + 1,
      p95FrameMs: 28,
      renderPerSec: 30,
    });
    expect(warn.ok).toBe(false);
    expect(warn.level).toBe("warn");
    expect(warn.violations).toContain("avg-frame-ms");

    const bad = evaluateTerminalRenderBudget({
      fps: 22,
      avgFrameMs: DEFAULT_TERMINAL_RENDER_BUDGET.maxAvgFrameMs + 6,
      p95FrameMs: DEFAULT_TERMINAL_RENDER_BUDGET.maxP95FrameMs + 10,
      renderPerSec: DEFAULT_TERMINAL_RENDER_BUDGET.maxRenderPerSec + 15,
    });
    expect(bad.ok).toBe(false);
    expect(bad.level).toBe("bad");
    expect(bad.violations.length).toBeGreaterThanOrEqual(2);
  });
});
