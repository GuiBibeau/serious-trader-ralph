import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function validate(schemaPath: string, payloadPath: string): boolean {
  const schema = readJson(schemaPath);
  const payload = readJson(payloadPath);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const validateFn = ajv.compile(schema);
  return Boolean(validateFn(payload));
}

describe("runtime protocol schema fixtures", () => {
  test("all valid fixtures conform to the checked-in schemas", () => {
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.deployment.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.deployment.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.run.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.run.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.ledger_snapshot.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.ledger_snapshot.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.risk_verdict.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.risk_verdict.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.execution_plan.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.execution_plan.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        "docs/runtime-contracts/schemas/runtime.reconciliation_result.v1.schema.json",
        "docs/runtime-contracts/fixtures/runtime.reconciliation_result.valid.v1.json",
      ),
    ).toBe(true);
  });

  test("manifest lists every runtime schema file", () => {
    const manifest = readJson(
      "docs/runtime-contracts/schema-manifest.v1.json",
    ) as {
      schemas: Array<{ schemaFile: string }>;
    };

    expect(manifest.schemas.map((entry) => entry.schemaFile)).toEqual([
      "docs/runtime-contracts/schemas/runtime.deployment.v1.schema.json",
      "docs/runtime-contracts/schemas/runtime.run.v1.schema.json",
      "docs/runtime-contracts/schemas/runtime.ledger_snapshot.v1.schema.json",
      "docs/runtime-contracts/schemas/runtime.risk_verdict.v1.schema.json",
      "docs/runtime-contracts/schemas/runtime.execution_plan.v1.schema.json",
      "docs/runtime-contracts/schemas/runtime.reconciliation_result.v1.schema.json",
    ]);
  });
});
