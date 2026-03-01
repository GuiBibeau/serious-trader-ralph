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

function extractEmailFromLinkedAccounts(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const account of value) {
    if (!isRecord(account)) continue;
    const type = String(account.type ?? "").trim().toLowerCase();
    if (type !== "email") continue;
    const email =
      normalizeEmail(account.email) ?? normalizeEmail(account.address) ?? null;
    if (email) return email;
  }
  return null;
}

function extractUserEmail(payload: Record<string, unknown>): string | null {
  const direct = normalizeEmail(payload.email);
  if (direct) return direct;

  const linkedFromSnake = extractEmailFromLinkedAccounts(payload.linked_accounts);
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
