import { expect, test } from "bun:test";
import {
  resolveHarnessPaths,
  resolvePreferredPorts,
  resolveWorktreeId,
} from "../../src/harness/manager";

test("resolveWorktreeId is deterministic and path-safe", () => {
  const root = "/tmp/trader-ralph/worktree-a";
  const id = resolveWorktreeId(root);

  expect(id).toStartWith("worktree-a-");
  expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  expect(resolveWorktreeId(root)).toBe(id);
});

test("resolveHarnessPaths scopes state to the current worktree", () => {
  const root = "/tmp/trader-ralph/worktree-a";
  const paths = resolveHarnessPaths(root);

  expect(paths.harnessDir).toContain(".tmp/harness/");
  expect(paths.workerStateDir).toContain(paths.harnessDir);
  expect(paths.stateFile).toContain(paths.harnessDir);
  expect(paths.logsDir).toContain(paths.harnessDir);
});

test("resolvePreferredPorts is deterministic and lane-separated", () => {
  const first = resolvePreferredPorts("/tmp/trader-ralph/worktree-a");
  const second = resolvePreferredPorts("/tmp/trader-ralph/worktree-b");

  expect(first.portalPort).toBeGreaterThanOrEqual(3000);
  expect(first.portalPort).toBeLessThan(3400);
  expect(first.workerPort).toBeGreaterThanOrEqual(8800);
  expect(first.workerPort).toBeLessThan(9200);
  expect(first).not.toEqual(second);
  expect(resolvePreferredPorts("/tmp/trader-ralph/worktree-a")).toEqual(first);
});
