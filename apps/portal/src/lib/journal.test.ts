import { beforeEach, describe, expect, test } from "bun:test";
import { type JournalEntry, journalToCsv, loadJournal } from "./journal";

const STORAGE_KEY = "trader-ralph-terminal/journal/v1";
const storage = new Map<string, string>();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem(key: string): string | null {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        storage.set(key, value);
      },
      removeItem(key: string): void {
        storage.delete(key);
      },
    },
  },
});

function entry(mode: JournalEntry["mode"]): JournalEntry {
  return {
    ts: Date.UTC(2026, 6, 21, 12, 34, 56),
    venue: "perp",
    symbol: "SOL",
    action: "long",
    notionalUsd: 250,
    price: 172.5,
    leverage: 5,
    signature: "abc123",
    mode,
  };
}

beforeEach(() => {
  storage.clear();
});

describe("loadJournal", () => {
  test("normalizes a legacy entry without a mode to unknown while preserving its facts", () => {
    const legacy = { ...entry("live"), mode: undefined, legacyNote: "kept" };
    storage.set(STORAGE_KEY, JSON.stringify([legacy]));

    expect(loadJournal()).toEqual([
      {
        ...legacy,
        mode: "unknown",
      },
    ]);
  });

  test("preserves valid live and paper modes and normalizes invalid modes", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify([
        entry("live"),
        { ...entry("paper"), signature: "paper-order-1" },
        { ...entry("live"), mode: "demo" },
      ]),
    );

    expect(loadJournal().map(({ mode }) => mode)).toEqual([
      "live",
      "paper",
      "unknown",
    ]);
  });
});

describe("journalToCsv", () => {
  test("includes the account mode column and values", () => {
    expect(journalToCsv([entry("paper")])).toBe(
      "time_utc,venue,symbol,action,notional_usd,price,leverage,mode,signature\n" +
        "2026-07-21T12:34:56.000Z,perp,SOL,long,250,172.5,5,paper,abc123",
    );
  });
});
