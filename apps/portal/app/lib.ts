// Shared utilities, types, and constants for the portal app.

// Hoisted regex — avoids re-creating RegExp per apiFetchJson call (Rule 7.9)
const BEARER_RE = /^bearer\s+/i;

export function apiBase(): string {
  return (process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "").replace(/\/+$/, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function apiFetchJson(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const base = apiBase();
  if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");

  const headers = new Headers(init?.headers);
  const token = accessToken.trim();
  headers.set(
    "authorization",
    BEARER_RE.test(token) ? token : `Bearer ${token}`,
  );
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const msg =
      isRecord(json) && typeof json.error === "string"
        ? String(json.error)
        : `http-${response.status}`;
    throw new Error(msg);
  }
  return json;
}

export function formatTick(ts: string | null): string {
  if (!ts) return "never";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "unknown";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// Button class constants
export const BTN =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 border text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-50 disabled:pointer-events-none";
export const BTN_PRIMARY = `${BTN} bg-ink text-surface border-transparent hover:brightness-95`;
export const BTN_SECONDARY = `${BTN} bg-surface text-ink border-border hover:bg-paper`;

// Shared types
export type Bot = {
  id: string;
  name: string;
  enabled: boolean;
  signerType: string;
  privyWalletId: string;
  walletAddress: string;
  lastTickAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
