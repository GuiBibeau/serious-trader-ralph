# WP2 — Ghost TP/SL in the ticket: render, Tab-accept, telemetry

You are implementing one scoped work package in the `serious-trader-ralph`
repo. Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

When the TAKE PROFIT or STOP LOSS input is EMPTY, a ghost suggestion (from
WP1's `ghostStop`/`ghostTakeProfit`, computed against the live candle data
and current est. entry) renders inside the field in muted styling — nothing else. Tab accepts the focused field's ghost (fills the
store value); typing or Escape dismisses it for that field until the ticket
side/symbol changes. Every shown/accepted/dismissed ghost emits telemetry.
The feature is invisible when no honest suggestion exists.

## Non-goals

- NO size/leverage ghosts (WP3). NO chart-hover ghost ticket (later WP).
- NO changes to submit paths, order building, or trade-math.
- NO spot ticket changes.
- Do not restyle existing ticket elements beyond adding the ghost overlays.
- NO explanatory chrome of any kind — no captions, hints, or labels about
  the ghosts. The seamlessness rule: if it announces itself, it fails.

## Files

Create:
- (none)

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/TicketForm.svelte — ghost rendering in TP (~lines 258-284) and SL (~lines 286-318) blocks, Tab/Escape handling on those two inputs, scoped styles (token colors only — ghost text `var(--faint)`; no new hexes)
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/perp-ticket.ts — derived ghost state: `ghostTp`/`ghostSl` deriveds computed from candles + entry + side using WP1 functions with `GHOST_DEFAULTS`, plus per-field dismissed flags that reset when side or symbol changes. Study how existing deriveds receive market context; candles/prevDay values must be INJECTED via an existing pattern (a setter the page already calls, or a new small writable the page feeds) — do not import phoenix-market-data fetchers into the store.
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte — ONLY the minimal wiring: feed current candles/prevDayHigh/prevDayLow into the ticket store when chart data updates (find where candle data lands after fetch), and pass anything TicketForm needs that it does not already have. No other page changes.

Delete:
- (none)

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

Interaction contract (implement exactly):
- Ghost renders ONLY when: field value is empty AND a ghost exists AND the
  field's dismissed flag is false. Rendered as an absolutely-positioned
  overlay inside the input's wrapper showing the formatted value (use
  `fmtTriggerPrice`), never as the input's real value or placeholder
  attribute swap-tricks that break autofill.
- Focused field + Tab: `event.preventDefault()`, write the ghost value into
  the store (same code path as the % chips use), emit accept telemetry.
  Tab on a field with no visible ghost = normal browser Tab (no preventDefault).
- Escape while a ghost is visible in the focused field: dismiss that field's
  ghost (flag), emit dismiss telemetry, do NOT let the event bubble to the
  page's global Escape handling (stopPropagation) for this case only.
- First keystroke that makes the field non-empty hides the ghost (no flag,
  no telemetry — typing over a suggestion is normal, not a dismissal).
- NO visible provenance text, NO "tab to accept" caption, NO hint line —
  the ghost value is the entire UI. Provenance lands ONLY as the ghost
  overlay element's native `title` attribute (hover-discoverable) and in
  telemetry. The ticket must not gain a single line of explanatory chrome.

Telemetry (import `track` from `$lib/telemetry`):
```ts
track("ghost_shown", { field: "tp" | "sl", source, symbol });    // once per ghost value per field (not per render)
track("ghost_accepted", { field, source, symbol });
track("ghost_dismissed", { field, source, symbol });
```

Reactivity note: TicketForm.svelte and perp-ticket.ts are Svelte-store based
(legacy-compatible); match the file's existing idiom exactly — check whether
TicketForm uses runes or `$store` syntax before writing.

## Acceptance criteria

- Empty TP and SL fields show ghosts within one frame of candle data being
  present; fields with user values never show ghosts.
- Tab in the SL field fills exactly the ghost value (string formatted via
  the same path the chips use) and the ticket preview (est. liquidation,
  at-stop-loss row) updates identically to a manual entry.
- With `sizingMode === "risk"`, accepting the SL ghost updates the
  size-from-stop preview (no special code — assert it works through the
  existing derivation).
- Escape dismisses only the focused field's ghost; the trade modal does NOT
  close on that Escape press; a second Escape (no ghost visible) behaves as
  before.
- Side flip (long↔short) recomputes ghosts and clears dismissed flags.
- No ghost renders when candles are absent (fresh load, feed failure) — the
  ticket looks exactly as it does today.
- `bun run build` output contains 0 `unused css selector` occurrences.
- Unit tests: extend perp-ticket.test.ts for the ghost deriveds + dismissed
  flag lifecycle (pure store-level, no DOM).

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
