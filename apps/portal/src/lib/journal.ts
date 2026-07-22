// Local-first trade journal. Every submitted order is appended with the
// deterministic facts the terminal already computed — no server, no sync.
// Numbers recorded here are what the user saw at submission, not fills.

// Legacy key name kept across the Harness rebrand — renaming would wipe
// every user's saved journal.
const STORAGE_KEY = "trader-ralph-terminal/journal/v1";
const MAX_ENTRIES = 400;

export type JournalMode = "live" | "paper" | "unknown";

export type JournalEntry = {
  ts: number;
  venue: "perp" | "spot";
  symbol: string;
  /** buy | sell | long | short | close | limit-buy | limit-sell | cancel */
  action: string;
  notionalUsd: number | null;
  price: number | null;
  leverage: number | null;
  mode: JournalMode;
  signature: string;
};

export function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<JournalEntry> &
        Record<string, unknown>;
      if (
        typeof candidate.ts !== "number" ||
        typeof candidate.symbol !== "string"
      ) {
        return [];
      }
      const mode: JournalMode =
        candidate.mode === "live" || candidate.mode === "paper"
          ? candidate.mode
          : "unknown";
      return [{ ...candidate, mode } as JournalEntry];
    });
  } catch {
    return [];
  }
}

export function recordTrade(entry: JournalEntry): JournalEntry[] {
  const entries = [...loadJournal(), entry].slice(-MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage unavailable — journal is best-effort
  }
  return entries;
}

export function clearJournal(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function entriesToday(
  entries: JournalEntry[],
  now: number,
): JournalEntry[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return entries.filter((entry) => entry.ts >= start.getTime());
}

export function journalToCsv(entries: JournalEntry[]): string {
  const header =
    "time_utc,venue,symbol,action,notional_usd,price,leverage,mode,signature";
  const rows = entries.map((entry) =>
    [
      new Date(entry.ts).toISOString(),
      entry.venue,
      entry.symbol,
      entry.action,
      entry.notionalUsd ?? "",
      entry.price ?? "",
      entry.leverage ?? "",
      entry.mode,
      entry.signature,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
