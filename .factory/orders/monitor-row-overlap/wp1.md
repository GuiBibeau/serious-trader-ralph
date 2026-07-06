# WP1 — Monitor panel: leverage chip must never overlap the MARK column

You are implementing one scoped work package in the `serious-trader-ralph`
repo. Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

In the terminal's Markets/monitor panel, at narrow panel widths the leverage
chip (`20x`, `60x`…) beside the market symbol overflows the symbol cell and
collides with the MARK price column (screenshot evidence: GOLD/COPPER/AMZN
rows). Fix: the symbol cell must contain its content — symbol text truncates
with an ellipsis under pressure, the chip never shrinks and never overlaps
the price — and the numeric columns give up the dead space they don't need.

## Non-goals

- Do NOT touch any other panel (Screener, Watch, Events, Spot) even if they
  look similar.
- Do NOT change fonts, colors, paddings, hover/active styles, sort logic,
  or any TypeScript.
- Do NOT introduce media/container queries — this fix is intrinsic sizing
  only.

## Files

Create: none

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/MonitorPanel.svelte
  — markup: wrap the symbol text node in a span; CSS: 4 small changes below.

Delete: none

Touch NOTHING outside this list. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

1. Markup (currently lines 84–87). Replace:

```svelte
        <span class="monitor-sym">
          {row.symbol}
          {#if row.lev}<i>{row.lev}x</i>{/if}
        </span>
```

with:

```svelte
        <span class="monitor-sym">
          <span class="sym-name">{row.symbol}</span>
          {#if row.lev}<i>{row.lev}x</i>{/if}
        </span>
```

2. CSS — in the `<style>` block of the same file:

a. In `.monitor-row`, replace the line
   `grid-template-columns: minmax(0, 1fr) 5.5rem 4.5rem 6rem;`
   with
   `grid-template-columns: minmax(0, 1fr) 5rem 3.6rem 5.2rem;`
   (widest real content: mark "63,853.50" ≈ 4.3rem, 24h "-1.14%" ≈ 2.9rem,
   volume "$7,308,420" ≈ 4.8rem — all still fit right-aligned.)

b. In `.monitor-sym`, add `min-width: 0;` (keep existing properties):
   `.monitor-sym { font-weight: 700; display: flex; gap: 0.35rem; align-items: baseline; min-width: 0; }`

c. Add a new rule directly below `.monitor-sym`:
   `.monitor-sym .sym-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`

d. In `.monitor-sym i`, add `flex-shrink: 0;` (keep existing properties).

## Acceptance criteria

- Symbol text ellipsizes under width pressure; the leverage chip stays fully
  visible and never renders over the MARK column at any panel width.
- At comfortable widths nothing visually changes except the numeric columns
  sitting slightly tighter (still right-aligned, nothing clipped).
- The sticky header row (`.monitor-head`, which shares `.monitor-row`'s
  grid) still aligns with the body columns.
- Zero new `unused css selector` warnings (the new `.sym-name` rule must
  match the new markup).

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
- Stay inside the file list above.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
