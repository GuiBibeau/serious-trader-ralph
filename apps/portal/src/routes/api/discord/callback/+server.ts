// Discord OAuth callback: verify the signed state, re-check funding
// server-side (the state could be minted and the funds moved before the
// user finishes the OAuth dance — the re-check is cheap), enforce the 1:1
// wallet ↔ Discord linkage, then join the guild and grant the role. This
// is a browser navigation, so every outcome redirects back to /discord
// with a status — no JSON dead-ends.

import { redirect } from "@sveltejs/kit";
import * as discord from "$lib/server/discord";
import { checkFunding } from "$lib/server/funding-check";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) redirect(302, "/discord?status=error");
  if (!discord.isConfigured()) redirect(302, "/discord?status=error");

  const payload = discord.verifyStateParam(state, Date.now());
  if (!payload) redirect(302, "/discord?status=expired");

  const funding = await checkFunding(payload.wallet);
  // Unknown (null) maps to error, not not-funded: a failed read must never
  // be reported to the user as "you don't hold enough".
  if (funding === null) redirect(302, "/discord?status=error");
  if (!funding.funded) redirect(302, "/discord?status=not-funded");

  const redirectUri = `${url.origin}/api/discord/callback`;
  const accessToken = await discord.exchangeCode(code, redirectUri);
  if (!accessToken) redirect(302, "/discord?status=error");

  const discordUser = await discord.fetchDiscordUser(accessToken);
  if (!discordUser) redirect(302, "/discord?status=error");

  // Fast pre-check. Still load-bearing for the user-side record: the
  // reservation below only guards the wallet-side path, so a Discord
  // account already linked to a DIFFERENT wallet is caught here.
  const guard = await discord.checkLinkGuard(payload.wallet, discordUser.id);
  if (guard === "already-linked") {
    redirect(302, "/discord?status=already-linked");
  }
  // guard "unavailable" proceeds: verification is gated on funding + email,
  // not on our own storage being up (see lib/server/discord.ts).

  // Atomic wallet-side reservation BEFORE anything is granted. The
  // pre-check above is check-then-act; without this, two concurrent
  // callbacks for the same wallet (different Discord accounts) both pass
  // the guard and both get the role.
  const reservation = await discord.reserveWalletLink(
    payload.wallet,
    discordUser.id,
  );
  if (reservation === "already-linked") {
    redirect(302, "/discord?status=already-linked");
  }
  // "unavailable" proceeds — same fail-open convention as the guard.

  const joined = await discord.joinGuild(discordUser.id, accessToken);
  if (!joined) {
    // Compensation, not a transaction: a failed grant must not burn the
    // wallet's one link. If this delete fails too, nothing is bricked —
    // re-verifying the same wallet+Discord pair reserves idempotently.
    if (reservation === "reserved") {
      await discord.releaseWalletLink(payload.wallet);
    }
    redirect(302, "/discord?status=error");
  }
  const granted = await discord.grantRole(discordUser.id);
  if (!granted) {
    if (reservation === "reserved") {
      await discord.releaseWalletLink(payload.wallet);
    }
    redirect(302, "/discord?status=error");
  }

  // Role landed: persist the user-side record (the wallet-side one was
  // already written by the reservation). If the reservation was skipped by
  // the outage fail-open, best-effort re-attempt the wallet-side record now
  // — the CAS is idempotent, so this can't clobber a concurrent winner.
  if (reservation === "unavailable") {
    await discord.reserveWalletLink(payload.wallet, discordUser.id);
  }
  await discord.writeUserLink(payload.wallet, discordUser.id);
  redirect(302, "/discord?status=success");
};
