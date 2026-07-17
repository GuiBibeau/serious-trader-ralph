# WP3 — Ghost size/leverage from the user's own history

You are implementing one scoped work package in the `serious-trader-ralph`
repo. Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

An empty SIZE field shows the user's own pattern as a ghost — "$25 @ 5x —
median of your last 12 SOL-PERP trades" — derived from the localStorage
journal via WP1's `ghostSizing`. Tab accepts BOTH notional and leverage in
one gesture. Users with fewer than 5 journal entries for the symbol see
nothing (a ghost from 2 trades is noise). Same telemetry contract as WP2.

## Non-goals

- NO TP/SL ghost changes (WP2 owns those; this WP builds on the same
  dismissed-flag pattern, it must not modify WP2's logic).
- NO leverage `<select>` ghost styling gymnastics — the ghost renders in
  the SIZE field area only ("$25 @ 5x" as one ghost); accepting sets both
  stores. NO visible provenance/caption — hover `title` at most, matching
  WP2's no-chrome contract.
- NO journal.ts changes; read-only consumption via `loadJournal()`.

## Files

Create:
- (none)

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/TicketForm.svelte — ghost overlay for the SIZE block (~lines 160-224), no visible captions, Tab/Escape handling mirroring WP2's contract exactly
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/perp-ticket.ts — `ghostSize` derived from injected journal entries + current symbol (entries injected the same way WP2 injects candles — the page feeds them; the store never touches localStorage itself), dismissed flag resetting on symbol change
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte — minimal wiring only: feed journal entries into the ticket store on mount and after each `recordTrade` call site

Delete:
- (none)

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

- Accepting the size ghost sets `tradeAmount` (string, same "$"-notation
  path the % chips use) AND `tradeLeverage` (number) in one action, then
  emits ONE `track("ghost_accepted", { field: "size", source: "journal", symbol })`.
- Ghost only in `sizingMode === "usd"` (risk mode has its own sizing logic —
  no ghost there in v1).
- `GHOST_DEFAULTS.sizingMinSample` (5) is the floor; the provenance string
  (hover title + telemetry only, never rendered text) states the real
  sample size.
- Telemetry event names/fields identical to WP2 (`ghost_shown` /
  `ghost_accepted` / `ghost_dismissed`, `field: "size"`).

## Acceptance criteria

- With a journal seeded with >= 5 phoenix entries for the active symbol, an
  empty size field shows the ghost; Tab fills size AND flips the leverage
  select to the modal value; ticket preview updates as if typed manually.
- With 4 or fewer entries: no ghost, no telemetry.
- Symbol switch recomputes (different symbol's history) and clears the
  dismissed flag.
- Risk mode (`from stop →`): no size ghost renders.
- Store-level unit tests in perp-ticket.test.ts (seeded entries → derived
  ghost; below-floor → null; dismissal lifecycle).
- 0 `unused css selector` in the build output.

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
