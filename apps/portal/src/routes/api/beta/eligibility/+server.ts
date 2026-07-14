// Beta-cap eligibility gate for Privy signup (dynamic user cap, default
// 150). Fail-open everywhere, matching the gates.ts convention: an
// unconfigured secret or a Privy API failure must never lock anyone out —
// Privy's own dashboard user cap is the hard backstop.
//
// Account-enumeration note: for the submitted email only, `allowed` lets a
// caller infer whether that email already has an account (only new users
// can be refused). Acknowledged and acceptable for the beta; the response
// never echoes existence directly.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { parseBetaCap, resolveBetaEligibility } from "$lib/beta-cap";
import { countUsers, findUserByEmail, isConfigured } from "$lib/server/privy";
import type { RequestHandler } from "./$types";

const MAX_EMAIL_LENGTH = 320;

export const POST: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  const email = readEmail(body);
  if (!email) return json({ error: "invalid-email" }, { status: 400 });

  const cap = parseBetaCap(env.BETA_USER_CAP);
  if (!isConfigured()) {
    return json(
      resolveBetaEligibility({
        configured: false,
        existing: null,
        count: null,
        cap,
      }),
    );
  }

  const existing = await findUserByEmail(email);
  // Only a confirmed-new user needs the count; the scan stops at the cap.
  const count = existing === false ? await countUsers(cap) : null;
  return json(
    resolveBetaEligibility({ configured: true, existing, count, cap }),
  );
};

function readEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  if (
    trimmed.length < 3 ||
    trimmed.length > MAX_EMAIL_LENGTH ||
    !trimmed.includes("@")
  ) {
    return null;
  }
  return trimmed;
}
