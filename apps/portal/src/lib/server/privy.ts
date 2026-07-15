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
