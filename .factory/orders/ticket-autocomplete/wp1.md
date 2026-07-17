# WP1 — Pure autocomplete lib: structure detection + ghost value derivation

You are implementing one scoped work package in the `serious-trader-ralph`
repo. Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

A pure, exhaustively-tested library that derives "ghost" suggestions for the
perp ticket from honest sources only: TP/SL prices from visible chart
structure (swing pivots, previous-day high/low), and size/leverage from the
user's own journal history. Every suggestion carries a provenance string a
human can verify against the chart. No DOM, no network, no Date.now() —
callers inject everything.

## Non-goals

- NO UI changes (that is WP2/WP3).
- NO LLM calls — v1 heuristics are deterministic structure math.
- NO changes to trade-math.ts, perp-ticket.ts, journal.ts, or any existing
  file. This WP creates two new files only.
- No spot-ticket support (perp only in Phase 1).

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/autocomplete.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/autocomplete.test.ts

Modify:
- (none)

Delete:
- (none)

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

The candle input type matches `MarketPoint` from
`$lib/phoenix-market-data` — import the type from there (type-only import,
it is client-safe):

```ts
import type { MarketPoint } from "$lib/phoenix-market-data";
import type { JournalEntry } from "$lib/journal";
```

Exact public API (signatures verbatim; implement privately as you see fit):

```ts
export type SwingPoint = { ts: number; price: number; kind: "high" | "low" };

/** N-bar fractal pivots: a bar whose low is strictly the lowest of the
 * `window` bars on each side is a swing low (mirror for highs). Returns
 * chronological order. Incomplete edges (fewer than `window` bars on a
 * side) are never pivots. */
export function detectSwings(
  candles: MarketPoint[],
  window: number,
): SwingPoint[];

export type GhostValue = {
  value: number;
  /** Human-verifiable one-liner, e.g. "0.3% below swing low 76.42" or
   * "prev-day low 75.10 − 0.3%". */
  provenance: string;
  /** Which rule produced it — telemetry dimension. */
  source: "swing" | "prev-day" | "r-multiple" | "journal";
};

/** Ghost stop for a prospective entry. Long: nearest swing low BELOW entry,
 * buffered `bufferPct` further below; short: mirrored above. Falls back to
 * previous-day low/high (same buffer) when no qualifying swing exists.
 * Returns null when neither source exists — never invent. */
export function ghostStop(
  candles: MarketPoint[],
  side: "buy" | "sell",
  entryPrice: number,
  opts: { window: number; bufferPct: number; prevDayHigh: number | null; prevDayLow: number | null },
): GhostValue | null;

/** Ghost take-profit. Primary: nearest opposing swing beyond entry (swing
 * high above for longs, swing low below for shorts). Fallback: `rMultiple`
 * × the stop distance when a stop value is provided. Null when neither
 * applies. */
export function ghostTakeProfit(
  candles: MarketPoint[],
  side: "buy" | "sell",
  entryPrice: number,
  stopPrice: number | null,
  opts: { window: number; rMultiple: number },
): GhostValue | null;

export type GhostSizing = {
  notionalUsd: number;
  leverage: number;
  provenance: string; // e.g. "median of your last 12 SOL-PERP trades"
  sampleSize: number;
};

/** Median notional + modal leverage from the user's own journal entries for
 * `symbol` (venue "phoenix" entries only). Requires >= minSample entries;
 * null below that — a ghost from 2 trades is noise, not history. */
export function ghostSizing(
  entries: JournalEntry[],
  symbol: string,
  minSample: number,
): GhostSizing | null;

export const GHOST_DEFAULTS = {
  swingWindow: 5,
  stopBufferPct: 0.3,
  tpRMultiple: 2,
  sizingMinSample: 5,
} as const;
```

Provenance strings: price values formatted with `fmtTriggerPrice` from
`$lib/terminal/trade-math` (existing export) so displayed ghosts match what
lands in the input.

## Acceptance criteria

- `detectSwings`: exact-output tests on hand-built candle arrays — a known
  5-bar pivot detected, edge bars excluded, ties (equal lows) NOT pivots
  (strictness), empty/short arrays → [].
- `ghostStop` long: picks the NEAREST swing low below entry (not the lowest
  overall); buffer applied; falls back to prev-day low when swings are all
  above entry; null when fallback also absent; short side fully mirrored.
- `ghostTakeProfit`: nearest opposing swing beyond entry; r-multiple
  fallback uses stop distance exactly (entry 100, stop 95, 2R → 110 long);
  null without swing and without stop.
- `ghostSizing`: median of odd/even counts exact; modal leverage tie breaks
  to the HIGHER frequency then LOWER leverage (deterministic); filters by
  symbol and venue "phoenix"; null under minSample.
- Every returned GhostValue has a non-empty provenance mentioning the real
  number it derived from.
- All tests pure: no network, no timers, no DOM, no Date.now().

## Validation (run all, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test
bun run build
```

Also grep the build output for `unused css selector` — must be 0 occurrences.

## Report format

1. Summary of what changed, per file.
2. Full validation output (verbatim, no truncation).
3. Anything you could not do, skipped, or are unsure about — say so plainly.
4. NO claims of success without the validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `git status` / `git diff` / `git log` only.
  Never commit, push, stash, restore, reset, or clean.
- Stay inside the file lists above.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
