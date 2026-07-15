// Server-only Privy REST client for the beta user cap. Endpoint shapes
// verified against docs.privy.io/api-reference (users/get-by-email-address,
// users/get-all): Basic auth `app_id:app_secret` plus a `privy-app-id`
// header. Every function fails soft — callers receive null on any failure
// and decide policy (the eligibility endpoint fails open).

import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

const PRIVY_API = "https://api.privy.io/v1";
const COUNT_TTL_MS = 60_000;
// ~150 users is 2 pages at limit=100; the guard only exists so a
// pathological cursor loop can never spin forever.
const MAX_COUNT_PAGES = 20;

// Module-level 60s cache (same idiom as /api/desk/[slug]). Reuse is
// asymmetric on purpose: an at-cap result (count >= the cap being asked
// about) only gets MORE true as users sign up, so it holds for the TTL.
// A below-cap result is the dangerous one to reuse — serving a stale
// under-cap count would keep admitting signups after the last seat fills —
// so anything short of the requested cap always triggers a fresh scan.
let countCache: { count: number; at: number } | null = null;

type PrivyCredentials = { appId: string; appSecret: string };

export function isConfigured(): boolean {
  return readCredentials() !== null;
}

/** true/false = Privy answered; null = not configured or API failure. */
export async function findUserByEmail(email: string): Promise<boolean | null> {
  const creds = readCredentials();
  if (!creds) return null;
  try {
    const response = await fetch(`${PRIVY_API}/users/email/address`, {
      method: "POST",
      headers: {
        ...privyHeaders(creds),
        "content-type": "application/json",
      },
      body: JSON.stringify({ address: email }),
    });
    // Privy returns 404 when no user exists for the address.
    if (response.status === 404) return false;
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: unknown };
    return typeof data.id === "string" && data.id.length > 0 ? true : null;
  } catch {
    return null;
  }
}

/**
 * Count users via GET /v1/users, following next_cursor pages but stopping
 * as soon as the count reaches `max` — exact totals beyond the cap are
 * never needed. null = not configured or API failure.
 */
export async function countUsers(max: number): Promise<number | null> {
  const creds = readCredentials();
  if (!creds) return null;

  // Only serve the cache when the counted value already reached the cap
  // being asked about — a count of 200 proves "at least 200 exist", which
  // answers any max <= 200 regardless of how deep that scan went.
  const cached = countCache;
  if (cached && Date.now() - cached.at < COUNT_TTL_MS && cached.count >= max) {
    return cached.count;
  }

  try {
    let count = 0;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COUNT_PAGES; page += 1) {
      const url = new URL(`${PRIVY_API}/users`);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, { headers: privyHeaders(creds) });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        data?: unknown[];
        next_cursor?: unknown;
      };
      if (!Array.isArray(data.data)) return null;
      count += data.data.length;
      cursor =
        typeof data.next_cursor === "string" && data.next_cursor.length > 0
          ? data.next_cursor
          : null;
      if (count >= max || !cursor) break;
    }
    countCache = { count, at: Date.now() };
    return count;
  } catch {
    return null;
  }
}

export type PrivyUserProfile = {
  id: string;
  email: string | null;
  solanaWallet: string | null;
};

/**
 * Fetch a user by Privy DID via GET /v1/users/{user_id} (verified against
 * docs.privy.io/api-reference/users/get: Basic auth + privy-app-id header)
 * and extract the email + embedded Solana wallet from linked_accounts.
 * null = not configured or API failure.
 */
export async function getUserById(
  userId: string,
): Promise<PrivyUserProfile | null> {
  const creds = readCredentials();
  if (!creds) return null;
  try {
    const response = await fetch(
      `${PRIVY_API}/users/${encodeURIComponent(userId)}`,
      { headers: privyHeaders(creds) },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      id?: unknown;
      linked_accounts?: unknown;
    };
    const id = typeof data.id === "string" && data.id ? data.id : null;
    if (!id) return null;

    let email: string | null = null;
    let solanaWallet: string | null = null;
    const accounts = Array.isArray(data.linked_accounts)
      ? data.linked_accounts
      : [];
    for (const account of accounts) {
      if (typeof account !== "object" || account === null) continue;
      const record = account as Record<string, unknown>;
      const type = String(record.type ?? "").toLowerCase();
      const address = String(record.address ?? "").trim();
      if (!address) continue;
      if (!email && type === "email") email = address;
      const chainType = String(record.chain_type ?? "").toLowerCase();
      if (!solanaWallet && type === "wallet" && chainType === "solana") {
        solanaWallet = address;
      }
    }
    return { id, email, solanaWallet };
  } catch {
    return null;
  }
}

// ── Access-token verification ─────────────────────────────────────────
// Privy access tokens are ES256 JWTs with iss "privy.io", aud = app id and
// sub = the user's DID (docs.privy.io authentication/access-tokens). The
// app's public keys are served as a JWKS at
// https://auth.privy.io/api/v1/apps/{appId}/jwks.json (P-256, kid-keyed) —
// verified live. Signatures check out against those keys via WebCrypto
// (JWS ES256 signatures are raw r||s, which is exactly what WebCrypto's
// ECDSA verify expects).

const JWKS_TTL_MS = 10 * 60_000;
type PrivyJwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: PrivyJwk[]; at: number } | null = null;

/** Verify a Privy access token. Returns the user's DID (sub) or null. */
export async function verifyPrivyAccessToken(
  token: string,
): Promise<string | null> {
  const creds = readCredentials();
  if (!creds) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(
      Buffer.from(headerB64, "base64url").toString("utf8"),
    ) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "ES256") return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown };
    if (payload.iss !== "privy.io") return null;
    const audOk = Array.isArray(payload.aud)
      ? payload.aud.includes(creds.appId)
      : payload.aud === creds.appId;
    if (!audOk) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      return null;
    }
    if (typeof payload.sub !== "string" || !payload.sub) return null;

    const keys = await fetchJwks(creds.appId);
    if (!keys || keys.length === 0) return null;
    // Prefer the kid match; fall back to trying every key so a rotation
    // between our cache refreshes cannot reject a valid token.
    const kid = typeof header.kid === "string" ? header.kid : null;
    const candidates = kid
      ? [
          ...keys.filter((key) => key.kid === kid),
          ...keys.filter((key) => key.kid !== kid),
        ]
      : keys;

    const signature = Buffer.from(signatureB64, "base64url");
    const message = Buffer.from(`${headerB64}.${payloadB64}`);
    for (const jwk of candidates) {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        message,
      );
      if (valid) return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchJwks(appId: string): Promise<PrivyJwk[] | null> {
  const cached = jwksCache;
  if (cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  try {
    const response = await fetch(
      `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`,
    );
    if (!response.ok) return cached ? cached.keys : null;
    const data = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(data.keys)
      ? (data.keys.filter(
          (key) => typeof key === "object" && key !== null,
        ) as PrivyJwk[])
      : [];
    if (keys.length === 0) return cached ? cached.keys : null;
    jwksCache = { keys, at: Date.now() };
    return keys;
  } catch {
    return cached ? cached.keys : null; // stale-on-error
  }
}

function readCredentials(): PrivyCredentials | null {
  // Same app-id names the client reads (privy-auth.ts readPrivyConfig);
  // PUBLIC_-prefixed vars live in the public env, the rest in private.
  const appId = cleanEnv(
    publicEnv.PUBLIC_PRIVY_APP_ID ??
      privateEnv.VITE_PRIVY_APP_ID ??
      privateEnv.NEXT_PUBLIC_PRIVY_APP_ID,
  );
  const appSecret = cleanEnv(privateEnv.PRIVY_APP_SECRET);
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function privyHeaders(creds: PrivyCredentials): Record<string, string> {
  const basic = Buffer.from(`${creds.appId}:${creds.appSecret}`).toString(
    "base64",
  );
  return {
    authorization: `Basic ${basic}`,
    "privy-app-id": creds.appId,
  };
}

function cleanEnv(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n$/, "");
}
