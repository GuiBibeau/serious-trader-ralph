// Start Discord funded-trader verification: prove the caller is a Privy
// user (email confirmed) with a funded wallet, then hand back the Discord
// authorize URL carrying an HMAC-signed state. Honest failure states:
// 503 = we could not know (unconfigured / upstream down), 403 = we know
// and the answer is no (with the real reason and numbers).

import { json } from "@sveltejs/kit";
import * as discord from "$lib/server/discord";
import { checkFunding } from "$lib/server/funding-check";
import { getUserById, verifyPrivyAccessToken } from "$lib/server/privy";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, setHeaders, url }) => {
  setHeaders({ "cache-control": "no-store" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ reason: "invalid-body" }, { status: 400 });
  }
  const privyToken =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).privyToken
      : null;
  if (typeof privyToken !== "string" || !privyToken) {
    return json({ reason: "invalid-body" }, { status: 400 });
  }

  if (!discord.isConfigured()) {
    return json({ reason: "unconfigured" }, { status: 503 });
  }

  const privyUserId = await verifyPrivyAccessToken(privyToken);
  if (!privyUserId) return json({ reason: "invalid-token" }, { status: 401 });

  const user = await getUserById(privyUserId);
  if (!user) return json({ reason: "privy-unavailable" }, { status: 503 });
  if (!user.email) return json({ reason: "email-required" }, { status: 403 });
  if (!user.solanaWallet) {
    return json({ reason: "wallet-required" }, { status: 403 });
  }

  const funding = await checkFunding(user.solanaWallet);
  // null = we could not read the balance or price — that is "unknown",
  // never "unfunded", so it is a 503, not a refusal.
  if (funding === null) {
    return json({ reason: "funding-unknown" }, { status: 503 });
  }
  if (!funding.funded) {
    return json(
      { reason: "not-funded", totalUsd: funding.totalUsd },
      { status: 403 },
    );
  }

  const authorizeUrl = discord.buildAuthorizeUrl(
    { privyUserId, wallet: user.solanaWallet, iat: Date.now() },
    `${url.origin}/api/discord/callback`,
  );
  if (!authorizeUrl) return json({ reason: "unconfigured" }, { status: 503 });
  return json({ url: authorizeUrl });
};
