// Pure decision logic for the Discord funded-trader verification flow
// (/discord + /api/discord/*). Same convention as beta-cap.ts: the server
// endpoints import these helpers and the adjacent test exercises them in
// isolation — no env reads, no network, and no Date.now() inside any
// function (callers inject the clock so every branch is deterministic).
//
// node:crypto keeps this module server-side by construction: only
// lib/server/discord.ts and the /api/discord endpoints import it, never
// client code.

import { createHmac, timingSafeEqual } from "node:crypto";

// ── OAuth state: HMAC-signed, self-expiring ───────────────────────────
// The `state` round-trips through Discord's authorize page, so it must be
// tamper-proof: it carries which Privy user/wallet passed the funding
// check. base64url(JSON payload) + "." + base64url(HMAC-SHA256).

export type DiscordStatePayload = {
  privyUserId: string;
  wallet: string;
  /** Mint time, ms since epoch. */
  iat: number;
};

export const STATE_TTL_MS = 10 * 60 * 1000;
// Tolerance for a state that appears minted "in the future" — we mint and
// verify on our own servers, so anything beyond small skew is forgery.
const STATE_FUTURE_SKEW_MS = 60 * 1000;

export function signState(
  payload: DiscordStatePayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/**
 * Verify signature + shape + freshness. Returns the payload or null —
 * never throws, and the MAC comparison is constant-time.
 */
export function verifyState(
  state: string,
  secret: string,
  nowMs: number,
): DiscordStatePayload | null {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, mac] = parts;

  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  // Length check first: timingSafeEqual throws on mismatched lengths, and
  // leaking the MAC length reveals nothing (it is a public constant).
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const privyUserId = record.privyUserId;
  const wallet = record.wallet;
  const iat = record.iat;
  if (typeof privyUserId !== "string" || privyUserId.length === 0) return null;
  if (typeof wallet !== "string" || wallet.length === 0) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (nowMs - iat > STATE_TTL_MS) return null;
  if (iat - nowMs > STATE_FUTURE_SKEW_MS) return null;
  return { privyUserId, wallet, iat };
}

// ── Funding threshold ────────────────────────────────────────────────

export const DEFAULT_FUNDED_MIN_USD = 10;

export type FundingDecision = {
  funded: boolean;
  totalUsd: number;
};

/** `>=` on purpose: holding exactly the threshold counts as funded. */
export function fundingDecision(
  usdcUsd: number,
  solUsd: number,
  thresholdUsd: number,
): FundingDecision {
  const totalUsd = usdcUsd + solUsd;
  return { funded: totalUsd >= thresholdUsd, totalUsd };
}

/** Parse DISCORD_FUNDED_MIN_USD; anything non-positive or non-numeric falls back. */
export function parseFundedMinUsd(
  raw: string | undefined,
  fallback = DEFAULT_FUNDED_MIN_USD,
): number {
  const value = Number(String(raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// ── 1:1 link guard ───────────────────────────────────────────────────
// One wallet ↔ one Discord account. Storage keeps two records per link
// (keyed by wallet and by Discord id); the pair is only allowed when
// neither record points at a DIFFERENT counterpart. Records that match
// the current pair are fine — re-verifying is idempotent, and a partial
// write (one record present, the other lost) must not brick the user.

export type LinkRecord = {
  wallet: string;
  discordId: string;
};

export type LinkGuardDecision = "allow" | "already-linked";

export function linkGuardDecision(
  walletLink: LinkRecord | null,
  userLink: LinkRecord | null,
  wallet: string,
  discordId: string,
): LinkGuardDecision {
  if (walletLink && walletLink.discordId !== discordId) {
    return "already-linked";
  }
  if (userLink && userLink.wallet !== wallet) return "already-linked";
  return "allow";
}
