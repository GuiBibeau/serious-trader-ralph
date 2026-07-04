import { describe, expect, test } from "bun:test";
import { parseLamportsResponse } from "./solana-rpc";

describe("parseLamportsResponse", () => {
  test("http failure → coded error with status", () => {
    expect(() => parseLamportsResponse(null, false, 429)).toThrow(
      "solana-rpc-http-429",
    );
  });

  test("non-record payload → invalid-response", () => {
    expect(() => parseLamportsResponse(null, true, 200)).toThrow(
      "solana-rpc-invalid-response",
    );
    expect(() => parseLamportsResponse("x", true, 200)).toThrow(
      "solana-rpc-invalid-response",
    );
  });

  test("rpc error object surfaces its message", () => {
    expect(() =>
      parseLamportsResponse({ error: { message: "boom" } }, true, 200),
    ).toThrow("boom");
    expect(() => parseLamportsResponse({ error: {} }, true, 200)).toThrow(
      "solana-rpc-error",
    );
  });

  test("numeric value truncates and floors at 0", () => {
    expect(
      parseLamportsResponse({ result: { value: 1234.9 } }, true, 200),
    ).toBe("1234");
    expect(parseLamportsResponse({ result: { value: -5 } }, true, 200)).toBe(
      "0",
    );
  });

  test("digit-string value passes through; non-digits rejected", () => {
    expect(
      parseLamportsResponse({ result: { value: "98765" } }, true, 200),
    ).toBe("98765");
    expect(() =>
      parseLamportsResponse({ result: { value: "12x" } }, true, 200),
    ).toThrow("solana-balance-missing");
  });

  test("missing value → balance-missing", () => {
    expect(() => parseLamportsResponse({ result: {} }, true, 200)).toThrow(
      "solana-balance-missing",
    );
  });
});
