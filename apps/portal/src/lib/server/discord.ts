// Server-only Discord client for the funded-trader verification flow.
// Endpoint shapes verified against docs.discord.com/developers:
// - authorize: https://discord.com/oauth2/authorize with response_type=code,
//   client_id, scope ("identify guilds.join"), redirect_uri, state
// - token exchange: POST https://discord.com/api/oauth2/token,
//   application/x-www-form-urlencoded body + Basic client_id:client_secret
// - GET /users/@me with the user's Bearer token (identify scope)
// - PUT /guilds/{guild}/members/{user} — bot token, JSON { access_token }
//   from the guilds.join grant; 201 = added, 204 = already a member
// - PUT /guilds/{guild}/members/{user}/roles/{role} — bot token with
//   Manage Roles; 204 on success
//
// Same never-throw idiom as lib/server/privy.ts: every function fails soft
// (null / false / "unavailable") and callers decide policy.

import { get, put } from "@vercel/blob";
import { env } from "$env/dynamic/private";
import {
  type DiscordStatePayload,
  type LinkGuardDecision,
  type LinkRecord,
  linkGuardDecision,
  signState,
  verifyState,
} from "$lib/discord-verify";

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_SCOPES = "identify guilds.join";

type DiscordConfig = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
  roleId: string;
  stateSecret: string;
};

export function isConfigured(): boolean {
  return readConfig() !== null;
}

export function buildAuthorizeUrl(
  payload: DiscordStatePayload,
  redirectUri: string,
): string | null {
  const config = readConfig();
  if (!config) return null;
  const url = new URL(DISCORD_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", signState(payload, config.stateSecret));
  return url.toString();
}

export function verifyStateParam(
  state: string,
  nowMs: number,
): DiscordStatePayload | null {
  const config = readConfig();
  if (!config) return null;
  return verifyState(state, config.stateSecret, nowMs);
}

/** Exchange the authorization code for the user's access token. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<string | null> {
  const config = readConfig();
  if (!config) return null;
  try {
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64");
    const response = await fetch(DISCORD_TOKEN, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token?: unknown };
    return typeof data.access_token === "string" && data.access_token
      ? data.access_token
      : null;
  } catch {
    return null;
  }
}

export async function fetchDiscordUser(
  accessToken: string,
): Promise<{ id: string; username: string } | null> {
  try {
    const response = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      id?: unknown;
      username?: unknown;
    };
    if (typeof data.id !== "string" || !data.id) return null;
    return { id: data.id, username: String(data.username ?? "") };
  } catch {
    return null;
  }
}

/** Add the user to the guild. 201 = added, 204 = already a member. */
export async function joinGuild(
  discordUserId: string,
  userAccessToken: string,
): Promise<boolean> {
  const config = readConfig();
  if (!config) return false;
  try {
    const response = await fetch(
      `${DISCORD_API}/guilds/${config.guildId}/members/${discordUserId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bot ${config.botToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: userAccessToken }),
      },
    );
    return response.status === 201 || response.status === 204;
  } catch {
    return false;
  }
}

/** Grant the funded-trader role. Bot needs Manage Roles; 204 on success. */
export async function grantRole(discordUserId: string): Promise<boolean> {
  const config = readConfig();
  if (!config) return false;
  try {
    const response = await fetch(
      `${DISCORD_API}/guilds/${config.guildId}/members/${discordUserId}/roles/${config.roleId}`,
      {
        method: "PUT",
        headers: { authorization: `Bot ${config.botToken}` },
      },
    );
    return response.status === 204;
  } catch {
    return false;
  }
}

// ── 1:1 wallet ↔ Discord linkage (Vercel Blob) ───────────────────────
// Tiny JSON records at deterministic private paths. Fail-open by design:
// verification is gated on funding + email, not on our own storage — if
// Blob is down or unconfigured we proceed without the guard and report
// linkGuard "unavailable" rather than blocking a legitimate user.

function walletLinkPath(wallet: string): string {
  return `discord-links/wallet/${wallet}.json`;
}

function userLinkPath(discordId: string): string {
  return `discord-links/user/${discordId}.json`;
}

export async function checkLinkGuard(
  wallet: string,
  discordId: string,
): Promise<LinkGuardDecision | "unavailable"> {
  const [walletLink, userLink] = await Promise.all([
    readLink(walletLinkPath(wallet)),
    readLink(userLinkPath(discordId)),
  ]);
  if (walletLink === "error" || userLink === "error") return "unavailable";
  return linkGuardDecision(walletLink, userLink, wallet, discordId);
}

/** Persist both link records. Call only after the role grant succeeded. */
export async function writeLinks(
  wallet: string,
  discordId: string,
): Promise<boolean> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  const record = JSON.stringify({ wallet, discordId } satisfies LinkRecord);
  try {
    await Promise.all([
      put(walletLinkPath(wallet), record, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
      }),
      put(userLinkPath(discordId), record, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** null = no record; "error" = storage unavailable (distinct on purpose). */
async function readLink(
  pathname: string,
): Promise<LinkRecord | null | "error"> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return "error";
  try {
    const result = await get(pathname, { access: "private", token });
    if (result === null) return null; // no such blob — never linked
    if (result.statusCode !== 200 || !result.stream) return "error";
    const text = await new Response(result.stream).text();
    const data = JSON.parse(text) as { wallet?: unknown; discordId?: unknown };
    if (typeof data.wallet !== "string" || typeof data.discordId !== "string") {
      return "error";
    }
    return { wallet: data.wallet, discordId: data.discordId };
  } catch {
    return "error";
  }
}

function readConfig(): DiscordConfig | null {
  const clientId = clean(env.DISCORD_CLIENT_ID);
  const clientSecret = clean(env.DISCORD_CLIENT_SECRET);
  const botToken = clean(env.DISCORD_BOT_TOKEN);
  const guildId = clean(env.DISCORD_GUILD_ID);
  const roleId = clean(env.DISCORD_FUNDED_ROLE_ID);
  const stateSecret = clean(env.DISCORD_STATE_SECRET);
  if (
    !clientId ||
    !clientSecret ||
    !botToken ||
    !guildId ||
    !roleId ||
    !stateSecret
  ) {
    return null;
  }
  return { clientId, clientSecret, botToken, guildId, roleId, stateSecret };
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}
