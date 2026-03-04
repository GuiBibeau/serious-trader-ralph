import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import {
  buildExecutionErrorEnvelope,
  executionErrorStatus,
  normalizeExecutionErrorCode,
} from "../../apps/worker/src/execution/error_taxonomy";

function loadErrorSchema(): unknown {
  const absolute = resolve(
    import.meta.dir,
    "..",
    "..",
    "docs/execution/schemas/error.envelope.v1.schema.json",
  );
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

describe("execution error taxonomy", () => {
  test("normalizes adapter and runtime failures into canonical codes", () => {
    expect(
      normalizeExecutionErrorCode({
        error: { code: "expired-blockhash" },
      }),
    ).toBe("expired-blockhash");

    expect(
      normalizeExecutionErrorCode({
        error: new Error("insufficient-token-balance"),
      }),
    ).toBe("insufficient-balance");

    expect(
      normalizeExecutionErrorCode({
        statusHint: "error",
        error: "unexpected provider response",
      }),
    ).toBe("submission-failed");

    expect(executionErrorStatus("venue-timeout")).toBe(504);
  });

  test("builds schema-valid uniform error envelope", () => {
    const schema = loadErrorSchema();
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const payload = buildExecutionErrorEnvelope({
      code: "policy-denied",
      details: {
        reason: "lane-not-available-for-relay-signed",
      },
      requestId: null,
    });
    expect(validate(payload)).toBe(true);
  });
});
