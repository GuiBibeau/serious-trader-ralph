// Site-wide default: server-rendered (landing, spotlights, news are the
// distribution surface). The terminal route opts back into CSR via its own
// +layout.ts — the trading app stays byte-for-byte client-only.
export const ssr = true;
export const prerender = false;
