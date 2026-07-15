import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  type DiscordStatePayload,
  fundingDecision,
  linkGuardDecision,
  parseFundedMinUsd,
  STATE_TTL_MS,
  signState,
  verifyState,
} from "./discord-verify";

const SECRET = "test-secret";
const NOW = 1_750_000_000_000;

function payload(
  overrides: Partial<DiscordStatePayload> = {},
): DiscordStatePayload {
  return {
    privyUserId: "did:privy:abc123",
    wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    iat: NOW,
    ...overrides,
  };
}

describe("signState / verifyState", () => {
  test("round-trips a payload", () => {
    const state = signState(payload(), SECRET);
    expect(verifyState(state, SECRET, NOW)).toEqual(payload());
  });

  test("is deterministic for identical inputs", () => {
    expect(signState(payload(), SECRET)).toBe(signState(payload(), SECRET));
  });

  test("rejects a tampered payload", () => {
    const state = signState(payload(), SECRET);
    const [, mac] = state.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify(
        payload({ wallet: "AttackerWallet1111111111111111111111111111" }),
      ),
    ).toString("base64url");
    expect(verifyState(`${forgedBody}.${mac}`, SECRET, NOW)).toBeNull();
  });

  test("rejects a tampered mac", () => {
    const state = signState(payload(), SECRET);
    const [body, mac] = state.split(".");
    const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
    expect(verifyState(`${body}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  test("rejects the wrong secret", () => {
    const state = signState(payload(), SECRET);
    expect(verifyState(state, "other-secret", NOW)).toBeNull();
  });

  test("rejects a mac of the wrong length", () => {
    const [body] = signState(payload(), SECRET).split(".");
    expect(verifyState(`${body}.AAAA`, SECRET, NOW)).toBeNull();
  });

  test("accepts a state right at the 10-minute boundary", () => {
    const state = signState(payload(), SECRET);
    expect(verifyState(state, SECRET, NOW + STATE_TTL_MS)).not.toBeNull();
  });

  test("rejects an expired state", () => {
    const state = signState(payload(), SECRET);
    expect(verifyState(state, SECRET, NOW + STATE_TTL_MS + 1)).toBeNull();
  });

  test("rejects a state minted too far in the future", () => {
    const state = signState(payload({ iat: NOW + 5 * 60 * 1000 }), SECRET);
    expect(verifyState(state, SECRET, NOW)).toBeNull();
  });

  test("accepts small clock skew on iat", () => {
    const state = signState(payload({ iat: NOW + 30_000 }), SECRET);
    expect(verifyState(state, SECRET, NOW)).not.toBeNull();
  });

  test.each([
    "",
    "no-dot",
    ".",
    "a.",
    ".b",
    "a.b.c",
  ])("rejects malformed state %j", (state) => {
    expect(verifyState(state, SECRET, NOW)).toBeNull();
  });

  test("rejects a signed payload that is not an object", () => {
    const body = Buffer.from(JSON.stringify("hello")).toString("base64url");
    const mac = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyState(`${body}.${mac}`, SECRET, NOW)).toBeNull();
  });

  test.each([
    [{ wallet: "w", iat: NOW }], // missing privyUserId
    [{ privyUserId: "u", iat: NOW }], // missing wallet
    [{ privyUserId: "u", wallet: "w" }], // missing iat
    [{ privyUserId: "", wallet: "w", iat: NOW }],
    [{ privyUserId: "u", wallet: "", iat: NOW }],
    [{ privyUserId: "u", wallet: "w", iat: "now" }],
    [{ privyUserId: 7, wallet: "w", iat: NOW }],
  ])("rejects a signed payload with bad fields %j", (bad) => {
    const body = Buffer.from(JSON.stringify(bad)).toString("base64url");
    const mac = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyState(`${body}.${mac}`, SECRET, NOW)).toBeNull();
  });
});

describe("fundingDecision", () => {
  test("below threshold is not funded", () => {
    expect(fundingDecision(4, 5.99, 10)).toEqual({
      funded: false,
      totalUsd: 9.99,
    });
  });

  test("exactly at threshold is funded", () => {
    expect(fundingDecision(6, 4, 10)).toEqual({ funded: true, totalUsd: 10 });
  });

  test("above threshold is funded", () => {
    expect(fundingDecision(100, 0, 10)).toEqual({
      funded: true,
      totalUsd: 100,
    });
  });

  test("zero balances are not funded", () => {
    expect(fundingDecision(0, 0, 10)).toEqual({ funded: false, totalUsd: 0 });
  });

  test("either asset alone can cross the threshold", () => {
    expect(fundingDecision(0, 12, 10).funded).toBe(true);
    expect(fundingDecision(12, 0, 10).funded).toBe(true);
  });
});

describe("parseFundedMinUsd", () => {
  test("defaults when unset", () => {
    expect(parseFundedMinUsd(undefined)).toBe(10);
  });

  test("parses a plain number", () => {
    expect(parseFundedMinUsd("25")).toBe(25);
  });

  test("parses a decimal", () => {
    expect(parseFundedMinUsd("10.5")).toBe(10.5);
  });

  test.each([
    "",
    "abc",
    "-5",
    "0",
    "NaN",
    "Infinity",
  ])("falls back on invalid %j", (raw) => {
    expect(parseFundedMinUsd(raw)).toBe(10);
  });

  test("honors a custom fallback", () => {
    expect(parseFundedMinUsd(undefined, 42)).toBe(42);
  });
});

describe("linkGuardDecision", () => {
  const WALLET = "walletA";
  const DISCORD = "111";

  test("no existing links → allow", () => {
    expect(linkGuardDecision(null, null, WALLET, DISCORD)).toBe("allow");
  });

  test("both links match the current pair → allow (idempotent re-verify)", () => {
    const link = { wallet: WALLET, discordId: DISCORD };
    expect(linkGuardDecision(link, link, WALLET, DISCORD)).toBe("allow");
  });

  test("wallet already linked to a different discord user → refuse", () => {
    expect(
      linkGuardDecision(
        { wallet: WALLET, discordId: "999" },
        null,
        WALLET,
        DISCORD,
      ),
    ).toBe("already-linked");
  });

  test("discord user already linked to a different wallet → refuse", () => {
    expect(
      linkGuardDecision(
        null,
        { wallet: "walletB", discordId: DISCORD },
        WALLET,
        DISCORD,
      ),
    ).toBe("already-linked");
  });

  test("partial write recovery: only the wallet record exists and matches → allow", () => {
    expect(
      linkGuardDecision(
        { wallet: WALLET, discordId: DISCORD },
        null,
        WALLET,
        DISCORD,
      ),
    ).toBe("allow");
  });

  test("partial write recovery: only the user record exists and matches → allow", () => {
    expect(
      linkGuardDecision(
        null,
        { wallet: WALLET, discordId: DISCORD },
        WALLET,
        DISCORD,
      ),
    ).toBe("allow");
  });

  test("both records exist and both point elsewhere → refuse", () => {
    expect(
      linkGuardDecision(
        { wallet: WALLET, discordId: "999" },
        { wallet: "walletB", discordId: DISCORD },
        WALLET,
        DISCORD,
      ),
    ).toBe("already-linked");
  });
});
