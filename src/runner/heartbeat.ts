import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type RunnerHeartbeat = {
  status: string;
  updatedAt: string;
  concurrency: number;
  activeRuns: number;
  note: string;
};

export function resolveRunnerHeartbeatPath(root: string): string {
  return join(resolve(root), ".harness", "runner-heartbeat.json");
}

export function writeRunnerHeartbeat(
  root: string,
  heartbeat: Omit<RunnerHeartbeat, "updatedAt"> & { updatedAt?: string },
): RunnerHeartbeat {
  const normalized: RunnerHeartbeat = {
    ...heartbeat,
    updatedAt: heartbeat.updatedAt ?? new Date().toISOString(),
  };
  const filePath = resolveRunnerHeartbeatPath(root);
  mkdirSync(join(resolve(root), ".harness"), { recursive: true });
  writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function readRunnerHeartbeat(root: string): RunnerHeartbeat {
  return JSON.parse(
    readFileSync(resolveRunnerHeartbeatPath(root), "utf8"),
  ) as RunnerHeartbeat;
}
