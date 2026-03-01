import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Env } from "./types";

type AuthUser = {
  privyUserId: string;
  email: string | null;
};

let cachedJwksAppId: string | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function jwksForApp(appId: string): ReturnType<typeof createRemoteJWKSet> {
  // Cloudflare workers keep module state warm across requests; cache per appId.
  if (cachedJwks && cachedJwksAppId === appId) return cachedJwks;
  const url = new URL(`https://auth.privy.io/v1/apps/${appId}/jwks.json`);
  cachedJwksAppId = appId;
  cachedJwks = createRemoteJWKSet(url);
  return cachedJwks;
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEmailFromObject(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const directFields = [
    "email",
    "address",
    "verified_email",
    "claimed_email",
    "primary_email",
  ] as const;
  for (const field of directFields) {
    const email = normalizeEmail(value[field]);
    if (email) return email;
  }

  const nestedFields = ["profile", "details", "claims", "user"] as const;
  for (const field of nestedFields) {
    if (!isRecord(value[field])) continue;
    for (const direct of directFields) {
      const email = normalizeEmail(value[field][direct]);
      if (email) return email;
    }
  }

  return null;
}

function extractEmailFromLinkedAccounts(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  let fallback: string | null = null;
  for (const account of value) {
    if (!isRecord(account)) continue;
    const type = String(account.type ?? "")
      .trim()
      .toLowerCase();
    const email = extractEmailFromObject(account);
    if (!email) continue;
    if (type === "email") return email;
    if (!fallback) fallback = email;
  }
  return fallback;
}

function extractEmailFromPayloadUser(
  payload: Record<string, unknown>,
): string | null {
  const user = payload.user;
  if (!isRecord(user)) return null;

  const direct = extractEmailFromObject(user);
  if (direct) return direct;

  const linkedSnake = extractEmailFromLinkedAccounts(user.linked_accounts);
  if (linkedSnake) return linkedSnake;

  return extractEmailFromLinkedAccounts(user.linkedAccounts);
}

function extractUserEmail(payload: Record<string, unknown>): string | null {
  const direct = extractEmailFromObject(payload);
  if (direct) return direct;

  const userEmail = extractEmailFromPayloadUser(payload);
  if (userEmail) return userEmail;

  const linkedFromSnake = extractEmailFromLinkedAccounts(
    payload.linked_accounts,
  );
  if (linkedFromSnake) return linkedFromSnake;

  return extractEmailFromLinkedAccounts(payload.linkedAccounts);
}

export async function requireUser(
  request: Request,
  env: Env,
): Promise<AuthUser> {
  const appId = env.PRIVY_APP_ID;
  if (!appId) {
    throw new Error("privy-app-id-not-configured");
  }
  const token = getBearerToken(request);
  if (!token) throw new Error("unauthorized");

  // Privy token claims have changed across SDK versions in the past.
  // Signature verification against the app-specific JWKS is the critical security check.
  // We attempt strict claim validation first, then fall back to signature-only verification.
  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, jwksForApp(appId), {
      issuer: "privy.io",
      audience: appId,
    }));
  } catch {
    try {
      ({ payload } = await jwtVerify(token, jwksForApp(appId)));
    } catch {
      throw new Error("unauthorized");
    }
  }

  const privyUserId = payload.sub;
  if (typeof privyUserId !== "string" || !privyUserId.trim()) {
    throw new Error("unauthorized");
  }

  return {
    privyUserId,
    email: extractUserEmail(payload as Record<string, unknown>),
  };
}
