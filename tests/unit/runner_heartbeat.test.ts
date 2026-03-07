import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRunnerHeartbeat,
  resolveRunnerHeartbeatPath,
  writeRunnerHeartbeat,
} from "../../src/runner/heartbeat";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeRunnerHeartbeat persists repo-local runner state", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-heartbeat-"));
  temporaryRoots.push(root);

  const heartbeat = writeRunnerHeartbeat(root, {
    status: "running",
    concurrency: 2,
    activeRuns: 1,
    note: "Processing issue #239.",
  });

  expect(resolveRunnerHeartbeatPath(root)).toBe(
    join(root, ".harness", "runner-heartbeat.json"),
  );
  expect(heartbeat.updatedAt.length).toBeGreaterThan(0);
  expect(readRunnerHeartbeat(root)).toEqual(heartbeat);
});
