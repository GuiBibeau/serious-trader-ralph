import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Env } from "./types";

type AuthUser = {
  privyUserId: string;
};

let cachedJwksAppId: string | null = null;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\\s+/i, "").trim();
}

function jwksForApp(appId: string): ReturnType<typeof createRemoteJWKSet> {
  // Cloudflare workers keep module state warm across requests; cache per appId.
  if (cachedJwks && cachedJwksAppId === appId) return cachedJwks;
  const url = new URL(`https://auth.privy.io/v1/apps/${appId}/jwks.json`);
  cachedJwksAppId = appId;
  cachedJwks = createRemoteJWKSet(url);
  return cachedJwks;
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

  const { payload } = await jwtVerify(token, jwksForApp(appId), {
    issuer: "privy.io",
    audience: appId,
  });

  const privyUserId = payload.sub;
  if (typeof privyUserId !== "string" || !privyUserId.trim()) {
    throw new Error("unauthorized");
  }

  return { privyUserId };
}
