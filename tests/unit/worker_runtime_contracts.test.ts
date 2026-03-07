import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseRuntimeDeploymentRecord,
  RUNTIME_PROTOCOL_SCHEMA_REGISTRY,
} from "../../apps/worker/src/runtime_contracts.js";

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

describe("worker runtime contract bridge", () => {
  test("worker imports the shared runtime protocol registry", () => {
    expect(Object.keys(RUNTIME_PROTOCOL_SCHEMA_REGISTRY)).toEqual([
      "deployment",
      "run",
      "ledgerSnapshot",
      "riskVerdict",
      "executionPlan",
      "reconciliationResult",
    ]);
  });

  test("worker can parse the canonical deployment fixture", () => {
    const deployment = parseRuntimeDeploymentRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.deployment.valid.v1.json",
      ),
    );

    expect(deployment.deploymentId).toBe("dep_runtime_sol_usdc_shadow");
    expect(deployment.mode).toBe("shadow");
  });
});
