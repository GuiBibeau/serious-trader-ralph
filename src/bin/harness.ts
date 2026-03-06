import {
  printHarnessStatus,
  startHarness,
  stopHarness,
} from "../harness/manager.js";

type HarnessCommand = "up" | "down" | "status";

function parseCommand(argv: string[]): HarnessCommand {
  const command = argv[2] as HarnessCommand | undefined;
  if (command === "up" || command === "down" || command === "status") {
    return command;
  }
  throw new Error("usage: bun run src/bin/harness.ts <up|down|status>");
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
  await printHarnessStatus();
}

void main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
