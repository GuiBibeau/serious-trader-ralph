// Local-first trade journal. Every submitted order is appended with the
// deterministic facts the terminal already computed — no server, no sync.
// Numbers recorded here are what the user saw at submission, not fills.

const STORAGE_KEY = "trader-ralph-terminal/journal/v1";
const MAX_ENTRIES = 400;

export type JournalEntry = {
  ts: number;
  venue: "perp" | "spot";
  symbol: string;
  /** buy | sell | long | short | close | limit-buy | limit-sell | cancel */
  action: string;
  notionalUsd: number | null;
  price: number | null;
  leverage: number | null;
  signature: string;
};

export function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (entry): entry is JournalEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as JournalEntry).ts === "number" &&
        typeof (entry as JournalEntry).symbol === "string",
    );
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
    "time_utc,venue,symbol,action,notional_usd,price,leverage,signature";
  const rows = entries.map((entry) =>
    [
      new Date(entry.ts).toISOString(),
      entry.venue,
      entry.symbol,
      entry.action,
      entry.notionalUsd ?? "",
      entry.price ?? "",
      entry.leverage ?? "",
      entry.signature,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
