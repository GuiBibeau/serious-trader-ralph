#!/usr/bin/env node
import {
  formatRunnerSummaries,
  runRunnerOnce,
  startRunner,
} from "../runner/service.js";

type RunnerCommand = "once" | "start";

function parseCommand(argv: string[]): RunnerCommand {
  const command = (argv[2] ?? "once").trim();
  if (command === "once" || command === "start") {
    return command;
  }
  throw new Error(
    "usage: bun run src/bin/runner.ts <once|start> [--concurrency <n>] [--poll-interval-ms <ms>]",
  );
}

function parseNumberFlag(
  argv: string[],
  flag: "--concurrency" | "--poll-interval-ms",
): number | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be numeric`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  const concurrency = parseNumberFlag(process.argv, "--concurrency");
  const pollIntervalMs = parseNumberFlag(process.argv, "--poll-interval-ms");
  if (command === "start") {
    await startRunner({ concurrency, pollIntervalMs });
    return;
  }
  const results = await runRunnerOnce({ concurrency, pollIntervalMs });
  console.log(formatRunnerSummaries(results));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
