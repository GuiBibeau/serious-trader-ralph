# WP2 — Client chat lib: store, desk-context serializer, transport

You are implementing one scoped work package in the `serious-trader-ralph`
repo, working in the WORKTREE at
`/Users/guillaume/Github/serious-trader-ralph-chat` (branch codex/side-chat).
ALL paths below are inside that worktree — never touch
`/Users/guillaume/Github/serious-trader-ralph` (a sibling checkout).
Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

The client half under the UI (PRD #563): a chat store (Svelte store,
same idiom as `$lib/ai.ts`'s state handling), a PURE desk-context
serializer with caps, and the fetch transport to `POST /api/chat`
(Privy token + edge token attached). WP3 builds the panel on these.

## Non-goals

- No Svelte components, no hotkeys, no page wiring (WP3).
- Do NOT modify `$lib/ai.ts` or any existing store/consumer.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/lib/chat.ts
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/lib/chat-context.ts
- /Users/guillaume/Github/serious-trader-ralph-chat/apps/portal/src/lib/chat-context.test.ts

Modify: none
Delete: none

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

`chat-context.ts` — PURE, unit-tested. Read `$lib/chat-core.ts` (WP1,
already on this branch) for the ChatMessage type; import types from it,
never duplicate.

```ts
export type DeskSnapshotInput = {
  symbol: string; timeframe: string;
  positions: unknown[]; openOrders: unknown[];
  dayPnlUsd: number | null; equityUsd: number | null;
  monitorRows: unknown[];   // top perp market rows as displayed
  watchlist: string[];
  headlines: { title: string; source: string; ageMin: number }[];
  nowMs: number;
};
/** Serialize the desk snapshot for the endpoint. Caps (exact): positions 20,
 * openOrders 20, monitorRows 12, watchlist 30, headlines 8, total JSON
 * length 10_000 chars — when over, drop monitorRows→headlines→openOrders
 * (in that order) wholesale and set "truncated": true in the output object.
 * Numbers pass through VERBATIM (no rounding — the grounding validator
 * compares digit-for-digit). */
export function buildDeskContext(input: DeskSnapshotInput): Record<string, unknown>;
```

`chat.ts` — the store + transport (thin; testing lives in the pure module):

```ts
import { writable, type Writable } from "svelte/store";
import type { ChatMessage } from "./chat-core";

export type ChatState = {
  open: boolean;
  phase: "idle" | "waiting" | "error" | "limit" | "auth";
  messages: ChatMessage[];       // user/assistant turns only
  error: string | null;
};
export const chatState: Writable<ChatState>; // initial: closed/idle/[]/null
export function toggleChat(): void;
export function closeChat(): void;

/** POST /api/chat. Attaches Authorization from getPrivyAccessToken()
 * ($lib/privy-auth — read its contract) and edgeToken when available.
 * State machine: push user msg → phase "waiting" → on {reply} push
 * assistant msg + phase "idle"; on {reply:null} phase stays "idle" and a
 * literal assistant message "I can't ground that answer in the data I
 * have." is pushed; 401 → phase "auth"; 429 → phase "limit"; network/500 →
 * phase "error" with error text. NEVER retries automatically. */
export function sendChatMessage(text: string, context: Record<string, unknown>): Promise<void>;
```

localStorage: persist ONLY `open` under the NEW key `harness.chat.v1`
(read lazily, guard `typeof localStorage === "undefined"` for SSR). Never
touch existing keys.

## Acceptance criteria

- chat-context tests: every cap boundary (21st position dropped, 13th
  monitor row dropped), the drop order under total-length pressure, the
  `truncated` flag, numbers verbatim (e.g. 4123.4567 survives untouched),
  deterministic output for fixed input (exact JSON assertion at least once).
- chat.ts compiles strict (no any/non-null); store transitions covered by
  the state machine above (a small test with mocked fetch is welcome IF it
  stays pure/deterministic — no timers, no real network; otherwise leave
  transport untested per anti-flake).
- No new deps.

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
3. Anything you could not do, skipped, or are unsure about — say so plainly.
4. NO claims of success without the validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `git status` / `git diff` / `git log` only.
  Never commit, push, stash, restore, reset, or clean.
- Stay inside the file lists above. Worktree paths ONLY.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
