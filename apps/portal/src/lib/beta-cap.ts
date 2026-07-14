// Beta user-cap decision logic (PRD: dynamic 150-user beta cap on Privy
// login). Pure and shared: the server eligibility endpoint imports it and
// the adjacent test exercises it in isolation. Policy: existing users
// always get in; every failure mode fails OPEN with an explicit reason —
// a new user is only refused when Privy confirmably reports the cap
// reached. Privy's own dashboard user cap is the hard backstop.

export const DEFAULT_BETA_USER_CAP = 150;

export type BetaEligibilityReason =
  | "unconfigured"
  | "existing"
  | "unavailable"
  | "beta-full"
  | "open";

export type BetaEligibility = {
  allowed: boolean;
  reason: BetaEligibilityReason;
};

export type BetaEligibilityInput = {
  /** Server has both a Privy app id and app secret. */
  configured: boolean;
  /** Privy lookup for this email: found / not found, null on API failure. */
  existing: boolean | null;
  /** Privy user count (scan stops at the cap), null on API failure. */
  count: number | null;
  cap: number;
};

export function resolveBetaEligibility(
  input: BetaEligibilityInput,
): BetaEligibility {
  if (!input.configured) return { allowed: true, reason: "unconfigured" };
  if (input.existing === true) return { allowed: true, reason: "existing" };
  if (input.existing === null) return { allowed: true, reason: "unavailable" };
  if (input.count === null) return { allowed: true, reason: "unavailable" };
  if (input.count >= input.cap) return { allowed: false, reason: "beta-full" };
  return { allowed: true, reason: "open" };
}

/** BETA_USER_CAP env parser: non-negative integer or the 150 default. */
export function parseBetaCap(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_BETA_USER_CAP;
}
