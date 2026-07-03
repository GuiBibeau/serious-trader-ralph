// Shared (client-safe) slug rules for spotlight routes. The param matcher and
// the server data layer must agree on these, so they live outside lib/server.

/** Slugs that can never be assets (route collisions). */
export const RESERVED_SLUGS = new Set([
  "terminal",
  "login",
  "news",
  "app",
  "api",
  "og",
  "settings",
  "checkout",
  "onboarding",
  "tokensxyz",
  "deepseek",
  "jupiter",
  "yahoo",
  "gdelt",
  "notify-discord",
  "token",
  "equities",
  "pre-ipo",
  "crypto",
  "assets",
  "share",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "favicon.ico",
]);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isAssetSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && !RESERVED_SLUGS.has(value);
}
