import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  const raw = readFileSync(absolute, "utf8");
  return JSON.parse(raw) as unknown;
}

function validate(schemaPath: string, payloadPath: string): boolean {
  const schema = readJson(schemaPath);
  const payload = readJson(payloadPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  const ok = validateFn(payload);
  return Boolean(ok);
}

describe("execution contract v1 schemas", () => {
  test("submit request validates relay_signed and privy_execute fixtures", () => {
    const schema = "docs/execution/schemas/exec.submit.request.v1.schema.json";
    expect(
      validate(
        schema,
        "docs/execution/fixtures/submit.relay_signed.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        schema,
        "docs/execution/fixtures/submit.privy_execute.valid.v1.json",
      ),
    ).toBe(true);
  });

  test("submit request rejects invalid fixtures", () => {
    const schema = "docs/execution/schemas/exec.submit.request.v1.schema.json";
    expect(
      validate(
        schema,
        "docs/execution/fixtures/submit.invalid.mode-mismatch.v1.json",
      ),
    ).toBe(false);
    expect(
      validate(
        schema,
        "docs/execution/fixtures/submit.invalid.missing-lane.v1.json",
      ),
    ).toBe(false);
  });

  test("submit response fixture validates", () => {
    expect(
      validate(
        "docs/execution/schemas/exec.submit.response.v1.schema.json",
        "docs/execution/fixtures/submit.response.valid.v1.json",
      ),
    ).toBe(true);
  });

  test("status response fixture validates", () => {
    expect(
      validate(
        "docs/execution/schemas/exec.status.response.v1.schema.json",
        "docs/execution/fixtures/status.response.valid.v1.json",
      ),
    ).toBe(true);
  });

  test("receipt response fixtures validate (ready and not-ready)", () => {
    const schema =
      "docs/execution/schemas/exec.receipt.response.v1.schema.json";
    expect(
      validate(
        schema,
        "docs/execution/fixtures/receipt.response.ready.valid.v1.json",
      ),
    ).toBe(true);
    expect(
      validate(
        schema,
        "docs/execution/fixtures/receipt.response.not-ready.valid.v1.json",
      ),
    ).toBe(true);
  });

  test("error envelope fixture validates", () => {
    expect(
      validate(
        "docs/execution/schemas/error.envelope.v1.schema.json",
        "docs/execution/fixtures/error.envelope.valid.v1.json",
      ),
    ).toBe(true);
  });
});
