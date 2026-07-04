import { describe, expect, test } from "bun:test";
import {
  aiErr,
  humanizeBalanceError,
  humanizePrivyError,
  shortAddress,
  shortEmail,
  walletStatusText,
} from "./account-format";

describe("shortAddress", () => {
  test("empty/null → --", () => {
    expect(shortAddress(null)).toBe("--");
    expect(shortAddress("  ")).toBe("--");
  });

  test("short addresses pass through", () => {
    expect(shortAddress("abc123")).toBe("abc123");
  });

  test("long addresses truncate 6...4", () => {
    expect(shortAddress("3jU1fEpb6KJSkML59eYhAF32ZrdrazA9cen9BZxnNEzu")).toBe(
      "3jU1fE...NEzu",
    );
  });
});

describe("shortEmail", () => {
  test("short emails pass through", () => {
    expect(shortEmail("gui@solana.org")).toBe("gui@solana.org");
  });

  test("long local part truncates with ellipsis, domain kept", () => {
    expect(shortEmail("gui.bibeau.the.trader@solana.org")).toBe(
      "gui.bibea…@solana.org",
    );
  });

  test("long string without @ hard-truncates at 19 + ellipsis", () => {
    const raw = "x".repeat(30);
    expect(shortEmail(raw)).toBe(`${"x".repeat(19)}…`);
  });
});

describe("walletStatusText", () => {
  test("all four states", () => {
    expect(walletStatusText("ready")).toBe("Wallet ready");
    expect(walletStatusText("creating")).toBe("Creating wallet…");
    expect(walletStatusText("error")).toBe("Wallet error");
    expect(walletStatusText("missing")).toBe("No wallet");
  });
});

describe("humanizePrivyError", () => {
  test("known code table", () => {
    expect(humanizePrivyError("email-required")).toBe(
      "Enter a valid email address.",
    );
    expect(humanizePrivyError("privy-login-failed")).toBe(
      "That code didn't work. Request a new one and retry.",
    );
  });

  test("unknown kebab-case codes get tidied", () => {
    expect(humanizePrivyError("some-new-code")).toBe("Some new code");
  });

  test("non-kebab messages pass through verbatim", () => {
    expect(humanizePrivyError("Something Went Wrong!")).toBe(
      "Something Went Wrong!",
    );
  });

  test("empty → empty string", () => {
    expect(humanizePrivyError(null)).toBe("");
    expect(humanizePrivyError("  ")).toBe("");
  });
});

describe("humanizeBalanceError", () => {
  test("401/403/forbidden → blocked guidance", () => {
    expect(humanizeBalanceError("solana-rpc-http-403")).toContain("blocked");
    expect(humanizeBalanceError("Forbidden by policy")).toContain("blocked");
  });

  test("429 → rate-limit guidance", () => {
    expect(humanizeBalanceError("solana-rpc-http-429")).toContain(
      "rate-limited",
    );
  });

  test("other http codes → generic RPC guidance", () => {
    expect(humanizeBalanceError("solana-rpc-http-500")).toContain(
      "PUBLIC_SOLANA_RPC_URL",
    );
  });

  test("unrecognized strings pass through", () => {
    expect(humanizeBalanceError("weird")).toBe("weird");
  });
});

describe("aiErr", () => {
  test("proxy-unavailable gets dev copy", () => {
    expect(aiErr(new Error("ai-proxy-unavailable"))).toBe(
      "AI offline (dev proxy only)",
    );
  });

  test("other errors pass message through; non-Errors coerce", () => {
    expect(aiErr(new Error("boom"))).toBe("boom");
    expect(aiErr("nope")).toBe("ai-error");
  });
});
