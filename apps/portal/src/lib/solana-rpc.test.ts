import { describe, expect, test } from "bun:test";
import { parseLamportsResponse, parseMintAccount } from "./solana-rpc";

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

describe("parseMintAccount", () => {
  // Build an 82-byte SPL mint image: u32 mintAuthorityOption @0,
  // 32-byte authority @4, u64 supply @36, u8 decimals @44,
  // u8 isInitialized @45, u32 freezeAuthorityOption @46, 32 bytes @50.
  function mintBase64(opts: {
    mintAuth: boolean;
    freezeAuth: boolean;
    decimals: number;
  }): string {
    const bytes = new Uint8Array(82);
    bytes[0] = opts.mintAuth ? 1 : 0;
    bytes[44] = opts.decimals;
    bytes[45] = 1; // initialized
    bytes[46] = opts.freezeAuth ? 1 : 0;
    return btoa(String.fromCharCode(...bytes));
  }

  test("revoked authorities decode as safe", () => {
    const safety = parseMintAccount(
      mintBase64({ mintAuth: false, freezeAuth: false, decimals: 6 }),
    );
    expect(safety.mintAuthorityRevoked).toBe(true);
    expect(safety.freezeAuthorityRevoked).toBe(true);
    expect(safety.decimals).toBe(6);
  });

  test("live authorities decode as unsafe", () => {
    const safety = parseMintAccount(
      mintBase64({ mintAuth: true, freezeAuth: true, decimals: 9 }),
    );
    expect(safety.mintAuthorityRevoked).toBe(false);
    expect(safety.freezeAuthorityRevoked).toBe(false);
    expect(safety.decimals).toBe(9);
  });

  test("truncated accounts throw instead of guessing", () => {
    expect(() => parseMintAccount(btoa("short"))).toThrow(
      "mint-account-too-short",
    );
  });
});
