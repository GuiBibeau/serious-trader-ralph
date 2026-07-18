# Harness — Groomed Issues, The Cursor Path (63 days)

*Companion to `.factory/PLAN-63-days.md` (published as issue #528). Weeks 1–3
are fully groomed and dispatch-ready; Weeks 4–9 are stubs to be groomed when
their week approaches — grooming rots faster than plans. Design mocks live in
`docs/design/` (injected into the live DOM, palette-exact; prices and
y-positions in mocks are ILLUSTRATIVE — implement from the spec text, never
from mock pixel positions).*

*Every issue inherits: the honest-data rule (values derive from real
structure/history; provenance in data + telemetry only, hover-discoverable at
most, never rendered chrome) and the seamlessness rule (AI/UI inserts into
the trader's existing motion; if it announces itself, it failed). Every ship
runs the full factory pipeline; ≤ ~400 changed lines per WP or it splits.*

---

## WEEK 1 — CHARTS

### Day 1 — Structure levels overlay
**Size:** M · **Mock:** `docs/design/01-structure-levels.png` · **Labels:** `ready-for-agent`, `charts`

The chart quietly draws the market's structure: previous-day high/low
(dashed, `--faint`), session high/low, and swing pivots (dotted, fainter)
with micro-labels inside the right edge ("PDH 78.12", "swing 76.42") — 10px,
no background boxes, sitting just above their line. Toggleable from the
chart footer strip (one small "levels" toggle, default ON, persisted in
prefs).

- Pure lib: `.factory/orders/ticket-autocomplete/wp1.md` IS this math
  (detectSwings + prev-day extraction) — ship wp1 as this day's first half;
  the overlay renders its output via lightweight-charts price lines
  (`createPriceLine`), respecting the existing chart-lines.ts conventions.
- Levels recompute on timeframe/symbol switch and on candle updates
  (debounced; no per-tick churn).
- AC: PDH/PDL match the actual previous UTC day's high/low from the loaded
  candles; swings match wp1's `detectSwings(window=5)` exactly; lines
  survive zoom/pan; toggle hides all four line groups; 0 unused CSS; no
  levels rendered when candle history is insufficient (honest absence).
- Deps: none. **This is Day 1's dispatch.**

### Day 2 — Click-to-trade
**Size:** M · **Mock:** `docs/design/02-click-to-trade.png` · **Labels:** `charts`, `ticket`

Alt-click (or a one-shot armed mode via the footer "trade on chart" toggle)
at a price on the chart pre-fills the ticket: type=limit, limit price=the
clicked level, side inferred (click below mark → long, above → short —
overridable in the ticket as always). A subtle pill at the right edge
previews "77.20 · limit long" while hovering in armed mode.

- Nothing submits — this only fills the existing ticket stores
  (`tradeType`, `tradeLimitPrice`, `tradeSide`).
- AC: clicked price lands in the limit field formatted via the tick-size
  rules the field already uses; pill follows crosshair with zero lag
  (rAF-throttled); Escape leaves armed mode; plain click (not armed, no
  Alt) unchanged from today.
- Deps: none, but pairs naturally after Day 1.

### Days 3–4 — Drag TP/SL handles on the chart
**Size:** L (two-day beat) · **Mock:** `docs/design/03-drag-tpsl.png` · **Labels:** `charts`, `positions`

An open position renders entry (solid `--muted`), TP (solid `--up`), SL
(solid `--down`) lines with right-edge grab handles (24×14, surface bg, 1px
border in the line's color). Dragging a handle previews the new trigger
(line follows, price in the handle updates live); release opens the
EXISTING confirm path — the same `buildSetPositionTpSlIxs` flow the position
row uses — showing old→new. No new transaction code.

- AC: drag is 60fps (transform-only moves, no re-layout); release→confirm
  →sign updates on-chain trigger and the line settles at the confirmed
  price; cancel snaps the line back; handles never render without an open
  position; keyboard-inaccessible drag has a fallback (the existing position
  row edit remains the a11y path, noted in code comment).
- Day 3 = tease post (mock + architecture note), Day 4 = ship.
- Deps: Day 1's line-rendering plumbing.

### Day 5 — Drawing basics: horizontal ray + measure
**Size:** M · **Labels:** `charts`

Two tools in the chart footer: a horizontal ray (click to place at price,
drag to move, double-click to remove; persisted per symbol in prefs, max 12)
and a measure tool (drag between two points → floating readout "Δ $1.12 ·
+1.45% · 14 bars", `--surface` chip, disappears on release+2s).

- AC: rays survive reload (prefs), timeframe switches, and zoom; measure
  math exact against candle data; both tools no-op gracefully on empty
  charts; 0 unused CSS.

### Day 6 — Daily market recap image
**Size:** S · **Labels:** `og`, `distribution`

`/og/recap.png`: auto-generated daily card — top movers, SOL close, day
range, volume, UTC-stamped — same satori pipeline and honest-data 503
conventions as the existing OG cards. 15-min ISR. This is the post engine:
one URL to screenshot/attach every quiet day.

- AC: renders from live catalog only (503 on feed failure, no stale fake);
  visual family matches `og/home.png`; date stamp is the current UTC day.

### Day 7 — Recap thread (post only, no ship)

---

## WEEK 2 — ERGONOMICS

### Day 8 — Hotkey trading mode
**Size:** S · **Mock:** `docs/design/07-armed-hotkeys.png` · **Labels:** `ticket`

Existing B/S/M/L hotkeys gain an explicit ARMED state: a small amber chip
inside the ticket's tab row (per mock — overlaid right end, nothing pulses).
Armed mode is opt-in (prefs), off by default; when off, behavior is exactly
today's. Escape disarms. The chip is the ONLY new pixel.

- AC: chip visible iff armed; hotkeys unchanged when disarmed; state
  persisted; screen-reader label on the chip.

### Day 9 — One-click reverse
**Size:** S · **Labels:** `positions`

Position row gains "Reverse": closes the position and opens the opposite
side at the same notional in ONE signing ceremony (both instruction sets in
one tx, same simulation gate). Confirm sheet shows exactly what happens
(close X → open Y).

- AC: reduce-only close + fresh open composed atomically; disabled (with
  honest tooltip) when margin wouldn't support the flip; ledger/journal
  records both legs.

### Day 10 — Order templates
**Size:** S · **Mock:** `docs/design/08-order-templates.png` · **Labels:** `ticket`

"Save as template" from the current ticket (name prompt, max 6) + a chip row
under the size chips (exact `.pct-chip` styling per mock, flow-inserted
spanning both grid columns). Tap = fill size/leverage/TP%/SL% — never
submits. Stored in prefs.

- AC: chips reflow honestly (no occlusion of the Type row); template
  applies via the same store paths chips use; delete via long-press/context
  affordance consistent with the app.

### Day 11 — Risk-first sizing polish
**Size:** S · **Labels:** `ticket`

The existing "from stop →" mode gets first-class treatment: risk input
remembers last value, ghost-suggests the user's median risk (once Week 3
lands), and the derived size preview moves inline next to the input instead
of the est. block only. No new math — presentation + persistence on the
existing `riskNotional` path.

### Day 12 — Session stats bar
**Size:** S · **Mock:** `docs/design/09-session-stats.png` · **Labels:** `terminal`

Three cells appended to the market rail (exact `.tk-stat` clones per mock):
DAY P&L (up/down colored), WIN (x/y from today's journal entries), FEES
(from receipts data where available; renders "--" until Week 4's receipts
land — honest placeholder, no invented fees).

- AC: computed from journal + positions only; UTC day boundary; cells
  hidden entirely when journal is empty (no zero-noise).

### Day 13 — Funding countdown + break-even button
**Size:** S · **Labels:** `terminal`, `positions`

(a) Market rail funding cell gains "in 2h 14m" countdown (already know the
8h schedule) + est. cost to hold current position through it (position
notional × rate; "--" without a position). (b) Position row gains "BE":
one-tap move of SL to entry via the existing TP/SL edit path, disabled until
unrealized ≥ +0.5R.

### Day 14 — Fill sounds + streak flame (+ recap)
**Size:** S · **Labels:** `polish`

Two subtle sounds (fill, TP/SL hit) — Emil-grade: short, quiet, default ON
with one mute toggle in settings, `prefers-reduced-motion` users default
OFF. Streak flame: consecutive green days (journal-derived) as a small 🔥n
next to DAY P&L, only when n ≥ 2.

---

## WEEK 3 — THE TAB MOMENT

### Day 15 — Ghost TP/SL
**Size:** M · **Mock:** `docs/design/04-ghost-tpsl.png` (THE contract demo) · **Labels:** `ai`, `ticket`, `ready-for-agent`

Order: `.factory/orders/ticket-autocomplete/wp2.md` (written, no-chrome
contract applied). Empty TP/SL fields show faint ghost values from Week 1's
structure lib; Tab accepts; typing/Escape dismisses; provenance = hover
`title` + telemetry ONLY. The mock is normative for weight: two faint
values, zero other pixels.

### Day 16 — Ghost size/leverage
**Size:** S · **Mock:** `docs/design/05-ghost-size.png` · **Labels:** `ai`, `ticket`, `ready-for-agent`

Order: `.factory/orders/ticket-autocomplete/wp3.md` (written). "$25 @ 5x"
from the user's own journal (≥5 trades on the symbol, median/mode); Tab
fills both stores.

### Day 17 — Chart-hover ghost ticket
**Size:** M · **Mock:** `docs/design/06-hover-ghost-ticket.png` · **Labels:** `ai`, `charts`

Hovering a price level (armed via the same footer toggle as click-to-trade)
assembles a phantom mini-ticket card (surface bg, radius-0 per app, three
rows: side+entry / SL·TP from structure / size from history). Tab or click
materializes it into the real ticket. Ghost family styling; disappears on
mouse-leave; never renders without structure+history sources (honest
absence).

### Day 18 — Explain-this-move
**Size:** S · **Labels:** `ai`

One quiet button in the chart header ("explain") → the existing DeepSeek
desk narrator explains the last session's move from computed facts, streamed
into a dismissible surface-chip. No panel, no branding; the response opens
where the question was asked.

### Day 19 — News→position tagging
**Size:** S · **Labels:** `ai`, `news`

Wire headlines that reference an open position's asset get a subtle left
border in `--accent` and sort first. Matching is symbol/asset-id based
(deterministic), not LLM.

### Day 20 — Ghost tuning from telemetry
**Size:** S · **Labels:** `ai`, `internal`

Internal-only: accept/reject rates per ghost source from the events blob;
adjust GHOST_DEFAULTS if data says so (documented change, not vibes).

### Day 21 — Recap + first public accept-rate numbers (post only)

---

## WEEKS 4–9 — STUBS (groom when the week approaches)

- **W4 Honesty:** trade receipts (22–23) · funding heatmap (24) · journal
  CSV (25) · AI post-trade critique (26) · exit-liquidity meter (27)
- **W5 Side Panel:** panel shell (29) · model routing (30) · free/Pro
  tiering — DeepSeek/Fable (31) · NL ticket edits (32) · ⌘K position
  commands (33) · depth-aware slippage (34)
- **W6 Sharing:** PnL cards v2 (36) · milestone cards (37) ·
  share-to-Discord (38) · shareable chart states (39) · Discord digest
  (40) · trailing stop (41)
- **W7 Permission Rails:** rules v1 (43) · money-PAUSE + ledger (44) ·
  observe mode (45) · copilot mode (46) · ladder entries (47) ·
  model-ranked ghosts (48)
- **W8 Agent Mode:** the flip (50–52) · session auto (53) · paper mode
  (54) · leaderboard (55)
- **W9 Finish the Funnel:** gasless wizard screen 2 (57–59) · starter
  ticket screen 3 (60) · keyless data API (61) · embeddable widget (62)

## Flex bench / deferred / cut — see `.factory/PLAN-63-days.md`
