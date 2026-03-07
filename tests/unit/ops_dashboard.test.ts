import { describe, expect, test } from "bun:test";
import {
  buildOpsDashboardMarkdown,
  normalizeRunnerHealth,
  parsePreviewCommentBody,
  summarizePreviewHealth,
} from "../../src/ops/dashboard";

describe("ops dashboard helpers", () => {
  test("parses PR preview comment body", () => {
    const parsed = parsePreviewCommentBody(`<!-- harness-proof-bundle -->
## Harness Proof Bundle

### Summary
<!-- proof:summary:start -->
- PR: #999
- Branch: \`codex/issue-999-example\`
<!-- proof:summary:end -->

### Preview
<!-- proof:preview:start -->
<!-- pr-preview -->
- Portal: https://preview.example.com
- Worker: https://worker.example.workers.dev
- Worker name: \`ralph-edge-pr-999\`
- Preview metadata artifact: \`pr-preview-999\`
<!-- proof:preview:end -->
`);

    expect(parsed).toEqual({
      portalUrl: "https://preview.example.com",
      workerUrl: "https://worker.example.workers.dev",
      workerName: "ralph-edge-pr-999",
    });
  });

  test("normalizes missing runner health to not-configured", () => {
    expect(normalizeRunnerHealth(null)).toEqual({
      status: "not-configured",
      updatedAt: null,
      concurrency: null,
      activeRuns: null,
      note: "Runner heartbeat file not found yet.",
    });
  });

  test("builds markdown with execution, preview, and runner sections", () => {
    const markdown = buildOpsDashboardMarkdown({
      generatedAt: "2026-03-06T00:00:00.000Z",
      execution: {
        metrics: {
          failRate: 0.01,
          expiryRate: 0,
          dispatch: { p95Ms: 120 },
          finalization: { p95Ms: 640 },
        },
        alerts: [{ id: "fail-rate", state: "ok" }],
      },
      canary: {
        config: { enabled: true },
        state: { disabled: false, disabledReason: null },
        latestRuns: [{ status: "success", reconciliationStatus: "passed" }],
      },
      controls: {
        execution: {
          enabled: true,
          disabledReason: null,
          lanes: { fast: true, protected: true, safe: true },
        },
        canary: {
          enabled: true,
          disabledReason: null,
        },
      },
      previews: [
        {
          prNumber: 247,
          portalUrl: "https://preview.example.com",
          workerUrl: "https://worker.example.workers.dev",
          workerName: "ralph-edge-pr-247",
          portalOk: true,
          workerOk: false,
        },
      ],
      runner: {
        status: "ok",
        updatedAt: "2026-03-06T00:05:00.000Z",
        concurrency: 2,
        activeRuns: 1,
        note: null,
      },
    });

    expect(markdown).toContain("# Ops Dashboard");
    expect(markdown).toContain("## Execution");
    expect(markdown).toContain("## Preview Health");
    expect(markdown).toContain("PR #247: portal=ok, worker=down");
    expect(markdown).toContain("## Runner Health");
  });

  test("summarizes preview health counts", () => {
    expect(
      summarizePreviewHealth([
        {
          prNumber: 1,
          portalUrl: "https://a.example.com",
          workerUrl: "https://a-worker.example.com",
          workerName: null,
          portalOk: true,
          workerOk: true,
        },
        {
          prNumber: 2,
          portalUrl: "https://b.example.com",
          workerUrl: "https://b-worker.example.com",
          workerName: null,
          portalOk: true,
          workerOk: false,
        },
      ]),
    ).toEqual({
      total: 2,
      healthy: 1,
      failing: 1,
    });
  });
});
