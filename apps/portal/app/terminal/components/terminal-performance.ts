"use client";

import { useEffect, useRef, useState } from "react";

export type TerminalRenderSnapshot = {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  renderPerSec: number;
};

export type TerminalRenderBudget = {
  maxAvgFrameMs: number;
  maxP95FrameMs: number;
  maxRenderPerSec: number;
};

export const DEFAULT_TERMINAL_RENDER_BUDGET: TerminalRenderBudget = {
  maxAvgFrameMs: 22,
  maxP95FrameMs: 32,
  maxRenderPerSec: 80,
};

export type TerminalRenderBudgetResult = {
  ok: boolean;
  level: "good" | "warn" | "bad";
  violations: string[];
};

function percentile(values: readonly number[], p: number): number {
  if (values.length < 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

export function evaluateTerminalRenderBudget(
  snapshot: TerminalRenderSnapshot,
  budget: TerminalRenderBudget = DEFAULT_TERMINAL_RENDER_BUDGET,
): TerminalRenderBudgetResult {
  const violations: string[] = [];
  if (snapshot.avgFrameMs > budget.maxAvgFrameMs) {
    violations.push("avg-frame-ms");
  }
  if (snapshot.p95FrameMs > budget.maxP95FrameMs) {
    violations.push("p95-frame-ms");
  }
  if (snapshot.renderPerSec > budget.maxRenderPerSec) {
    violations.push("render-rate");
  }

  const ok = violations.length < 1;
  const level: TerminalRenderBudgetResult["level"] = ok
    ? "good"
    : violations.length === 1
      ? "warn"
      : "bad";

  return {
    ok,
    level,
    violations,
  };
}

export function useTerminalRenderPerformance(sampleWindowMs = 4000): {
  snapshot: TerminalRenderSnapshot | null;
  budget: TerminalRenderBudgetResult | null;
} {
  const [snapshot, setSnapshot] = useState<TerminalRenderSnapshot | null>(null);
  const [budget, setBudget] = useState<TerminalRenderBudgetResult | null>(null);
  const frameDurationsRef = useRef<number[]>([]);
  const lastFrameTsRef = useRef<number | null>(null);
  const windowStartTsRef = useRef<number | null>(null);
  const renderCountRef = useRef(0);

  renderCountRef.current += 1;

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    const tick = (now: number): void => {
      if (cancelled) return;

      if (windowStartTsRef.current === null) {
        windowStartTsRef.current = now;
      }
      if (lastFrameTsRef.current !== null) {
        const delta = now - lastFrameTsRef.current;
        if (Number.isFinite(delta) && delta >= 0) {
          frameDurationsRef.current.push(delta);
        }
      }
      lastFrameTsRef.current = now;

      const elapsed = now - (windowStartTsRef.current ?? now);
      if (elapsed >= sampleWindowMs) {
        const samples = frameDurationsRef.current;
        const avgFrameMs =
          samples.length < 1
            ? 0
            : samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const p95FrameMs = percentile(samples, 95);
        const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
        const renderPerSec =
          elapsed > 0 ? (renderCountRef.current * 1000) / elapsed : 0;
        const nextSnapshot: TerminalRenderSnapshot = {
          fps,
          avgFrameMs,
          p95FrameMs,
          renderPerSec,
        };
        setSnapshot(nextSnapshot);
        setBudget(evaluateTerminalRenderBudget(nextSnapshot));
        frameDurationsRef.current = [];
        renderCountRef.current = 0;
        windowStartTsRef.current = now;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      frameDurationsRef.current = [];
      lastFrameTsRef.current = null;
      windowStartTsRef.current = null;
      renderCountRef.current = 0;
    };
  }, [sampleWindowMs]);

  return {
    snapshot,
    budget,
  };
}
