# WP3 — SidePanel.svelte + summon wiring (side-panel chat v1 UI)

You are implementing one scoped work package in the `serious-trader-ralph`
repo, working in the WORKTREE at
`/Users/guillaume/Github/serious-trader-ralph-chat` (branch codex/side-chat).
ALL paths below are inside that worktree — never touch
`/Users/guillaume/Github/serious-trader-ralph` (a sibling checkout).
Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

The visible half of PRD #563, under the seamlessness rule: a summon-only
right-dock chat panel — zero weight closed (lazy-mounted), no badge, no
pulse, no sparkle. Backtick summons it; one quiet text toggle lives in the
topbar; Esc closes. Signed-out users get a sign-in nudge, capped users get
honest limit states.

## Non-goals

- No new AI surfaces elsewhere; no changes to any existing panel.
- No streaming, no model picker, no ⌘K integration.
- Do NOT restyle anything existing; do NOT touch AiReadLine or its
  consumers.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/routes/terminal/components/SidePanel.svelte

Modify:
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/routes/terminal/+page.svelte — minimal wiring ONLY (payload below)
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/routes/terminal/components/Topbar.svelte — one quiet toggle (payload below)

Delete: none

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

`SidePanel.svelte` — NEW component, Svelte 5 runes ONLY (`$props()`,
`$state`, `$derived`, `{@render}`; no `export let`, no `$:`, no `<slot>`):

- Props: `{ buildContext: () => Record<string, unknown> }` (the page
  passes a closure over its live stores — the panel never imports page
  state).
- Reads/writes `chatState` from `$lib/chat` (WP2); send box calls
  `sendChatMessage(text, buildContext())`.
- Layout: fixed right dock, `width: 380px`, full height under the topbar
  (`position: sticky` column inside the page grid — see wiring below);
  internal scroll for messages; input pinned bottom. Mobile (<1100px):
  `position: fixed; inset: 0; top: var(--topbar-h, 3rem)` full sheet.
- States: `phase === "auth"` → centered quiet note "Sign in to talk to the
  desk." + the existing sign-in affordance pattern (link/button that
  triggers the page's auth modal via a `onrequestauth` callback prop —
  add `onRequestAuth: () => void` to props); `"limit"` → "Daily limit
  reached — resets at UTC midnight."; `"error"` → the error text verbatim;
  `"waiting"` → skeleton shimmer matching AiReadLine's rhythm (2 lines,
  2.2s) — copy the keyframes INTO this component's style block (do not
  import AiReadLine).
- Messages render as plain text (no markdown lib — verbatim text,
  `white-space: pre-wrap`). Assistant messages get a subtle 2px left
  border using `var(--pink)` if that token exists in the page's palette —
  check `packages/ui` tokens and use whatever token AiReadLine's border
  uses; NO fallback hex (pitfall 16).
- All colors/spacing via existing tokens; container queries if any
  internal row could compress (pitfall 15).
- a11y: panel has `role="complementary"` `aria-label="Desk chat"`; input
  labeled; toggle button `aria-expanded`.

`+page.svelte` wiring (MINIMAL — this file is 6900+ lines of legacy `$:`
style; match the file's existing idiom for the few lines you add, and add
at the established sections):
1. Import `chatState`, `toggleChat`, `closeChat` from `$lib/chat` and add
   a lazy component holder: SidePanel is loaded via
   `const SidePanelLazy = () => import("./components/SidePanel.svelte")` on
   first open (follow the page's existing lazy/dynamic patterns if one
   exists; otherwise a `{#if $chatState.open}{#await ...}` block with
   `svelte:component`-equivalent for the page's Svelte version).
2. Grid: when `$chatState.open` on desktop, the page's main grid gains a
   right column for the dock (`grid-template-columns: 1fr 380px` on the
   workspace wrapper via a `.chat-open` class on the existing wrapper —
   scoped style added alongside the wrapper's existing rules). Closed =
   zero DOM, zero CSS effect (class absent).
3. Keyboard: in the page's EXISTING keydown handler (find it — hotkeys
   B/S/M/L and `/` palette live there), add: backtick (`` ` ``) toggles
   chat (same guard the other hotkeys use for typing-in-inputs); Escape
   closes chat ONLY when chat is open and no modal is open (respect the
   handler's existing modal-priority order — read it first).
4. `buildContext` closure: assemble `DeskSnapshotInput` from the page's
   existing state (symbol, timeframe, positions, open orders, day PnL,
   equity, monitor rows, watchlist, headlines — all already in scope in
   the page; pass `nowMs: Date.now()`), call `buildDeskContext` from
   `$lib/chat-context`, pass to the panel.
5. `onRequestAuth`: call the page's existing auth-modal opener.

`Topbar.svelte` toggle — one quiet text button, right cluster, BEFORE the
account menu: label `desk`, `aria-expanded` bound, click calls a new
`onToggleChat: () => void` prop (wire from the page). Match the topbar's
existing button classes exactly — no new visual language, no icon, no
badge, no dot, no animation.

## Acceptance criteria

- Closed: DOM for the panel absent; page layout byte-identical (verify by
  eye + no CSS class applied); zero JS chunk for SidePanel loaded until
  first open (network tab).
- Backtick toggles (except while typing in inputs/textareas); Esc closes
  per modal-priority; toggle button reflects state via aria-expanded.
- Signed-out → auth nudge renders, no network call fires on send attempt.
- All validation green; `unused css selector` = 0 (scoped-CSS pitfall 4:
  every style you add must be used).
- Svelte 5 runes in SidePanel; the +page.svelte additions match ITS legacy
  idiom.

## Validation (run all from the WORKTREE root, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test && cd ../..
bun run build
```

Also grep the build output for `unused css selector` — must be 0 occurrences.

## Report format

1. Summary of what changed, per file.
2. Full validation output (verbatim, no truncation).
3. Exact keydown-handler location you modified and the guard you reused.
4. Anything you could not do, skipped, or are unsure about — say so plainly.
5. NO claims of success without the validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `git status` / `git diff` / `git log` only.
  Never commit, push, stash, restore, reset, or clean.
- Stay inside the file lists above. Worktree paths ONLY.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
