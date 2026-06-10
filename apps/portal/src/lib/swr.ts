// Tiny stale-while-revalidate cache (localStorage).
//
// Used for slow / contextual widget data (macro panels, news, markets list,
// AI desk reads) so the terminal paints last-known values instantly on reload,
// then hydrates with a fresh fetch. NEVER used for the live order book or for
// prices presented as current — those carry their own freshness/stale state.

type Stamped<T> = { v: T; t: number };

export function swrWrite<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ v: value, t: Date.now() } satisfies Stamped<T>),
    );
  } catch {
    // storage unavailable / quota — caching is best-effort
  }
}

// Returns the cached value only if it's within `maxAgeMs`; otherwise null so
// the caller shows a skeleton instead of misleadingly old data.
export function swrRead<T>(key: string, maxAgeMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stamped<T>;
    if (!parsed || typeof parsed.t !== "number") return null;
    if (Date.now() - parsed.t > maxAgeMs) return null;
    return parsed.v;
  } catch {
    return null;
  }
}
