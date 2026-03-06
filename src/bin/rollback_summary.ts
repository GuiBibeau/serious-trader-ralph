import { writeFileSync } from "node:fs";
import {
  buildRollbackSummary,
  resolveRollbackTarget,
} from "../ops/rollback.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function requireArg(flag: string): string {
  const value = readArg(flag);
  if (!value) {
    throw new Error(`missing-arg:${flag}`);
  }
  return value;
}

const output = requireArg("--output");
const portalUrl = requireArg("--portal-url");
const apiUrl = requireArg("--api-url");
const status = requireArg("--status") as "success" | "failed" | "dry-run";
const reason = requireArg("--reason");

const target = resolveRollbackTarget({
  requestedSha: readArg("--target-sha"),
  previousMainSha: readArg("--previous-main-sha"),
});

writeFileSync(
  output,
  `${buildRollbackSummary({
    targetSha: target.targetSha,
    source: target.source,
    portalUrl,
    apiUrl,
    status,
    reason,
  })}\n`,
);
