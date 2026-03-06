import {
  printHarnessStatus,
  startHarness,
  stopHarness,
} from "../harness/manager.js";
import { runHarnessProof } from "../harness/proof.js";

type HarnessCommand = "up" | "down" | "status" | "proof";

function parseCommand(argv: string[]): HarnessCommand {
  const command = argv[2] as HarnessCommand | undefined;
  if (
    command === "up" ||
    command === "down" ||
    command === "status" ||
    command === "proof"
  ) {
    return command;
  }
  throw new Error(
    "usage: bun run src/bin/harness.ts <up|down|status|proof> [--base-url <url>] [--output-dir <path>]",
  );
}

function parseProofOptions(argv: string[]): {
  baseUrl?: string;
  outputDir?: string;
} {
  let baseUrl: string | undefined;
  let outputDir: string | undefined;

  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (token === "--base-url") {
      const value = argv[index + 1];
      if (!value) throw new Error("--base-url requires a value");
      baseUrl = value;
      index += 1;
      continue;
    }
    if (token === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a value");
      outputDir = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown proof option: ${token}`);
  }

  return { baseUrl, outputDir };
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  if (command === "up") {
    await startHarness();
    return;
  }
  if (command === "down") {
    await stopHarness();
    return;
  }
  if (command === "proof") {
    await runHarnessProof(parseProofOptions(process.argv));
    return;
  }
  await printHarnessStatus();
}

void main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
