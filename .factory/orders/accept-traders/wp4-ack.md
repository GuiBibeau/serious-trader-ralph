# WP4 — First-trade acknowledgment modal

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #497, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

One-time risk acknowledgment before a wallet's FIRST trading order: a
modal with a plain-language risk summary and "I agree to the Terms"
(linking /terms, which is live). Persisted per wallet; accepted wallets
never see it again. No ack → no order submission.

## Non-goals

- FundsModal flows (deposit/withdraw/convert) are NOT gated — this covers
  trading orders only (perp orders, spot swaps, spot limit orders).
- No copy changes to /terms; no geo/gate-layer involvement.
- Do not restyle existing modals; match AuthModal's overlay conventions.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/ack.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/ack.test.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/AckModal.svelte

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte
  — ONLY the five precise edits in payload 4. This file is 5,000+ lines of
  legacy `$:` Svelte: match its style, change nothing beyond the anchors.

Delete: none

## Load-bearing payloads

1. `src/lib/terminal/ack.ts`:

```ts
// First-trade risk acknowledgment (PRD #493 / #497). One ack per wallet,
// stored locally like the Phoenix referral onboarding key. storage is
// injectable so tests never touch the real localStorage.

const ACK_KEY = "trader-ralph-terminal/trade-ack/v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readAcked(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(ACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasAcked(wallet: string | null, storage?: StorageLike): boolean {
  if (!wallet) return false;
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return false;
  return readAcked(store).includes(wallet);
}

export function recordAck(wallet: string | null, storage?: StorageLike): void {
  if (!wallet) return;
  const store = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    const acked = new Set(readAcked(store));
    acked.add(wallet);
    store.setItem(ACK_KEY, JSON.stringify([...acked]));
  } catch {
    /* storage unavailable: ack lasts the session via caller state */
  }
}
```

2. `src/lib/terminal/ack.test.ts` — bun test with a Map-backed fake
StorageLike. Cover: null wallet → hasAcked false + recordAck no-throw;
unknown wallet false; record→has true; two wallets independent; corrupted
JSON in storage → false (no throw); non-array JSON → false.

3. `AckModal.svelte` — Svelte 5 runes. Props:
`{ onagree, onclose }: { onagree: () => void; onclose: () => void }`.
Overlay + dialog styled like the repo's existing terminal modals (check
AuthModal.svelte for the overlay/panel class conventions and reuse the
same look — dark panel, 1px var(--line) border, compact type). Content,
verbatim:

- Title: `Before your first trade`
- Body list (4 items):
  - `Trading digital assets involves substantial risk of loss. Leveraged positions can be liquidated — you can lose your entire margin.`
  - `Tokenized equities are synthetic price exposure only: no shareholder rights, no dividends.`
  - `Your wallet is self-custodial. Transactions are final; nobody can reverse them or recover misdirected funds.`
  - `Prices and desk commentary are informational, not financial advice.`
- Footer: link `Read the full Terms of Service` → `/terms` (target="_blank"
  rel="noreferrer"), then buttons: secondary `Not now` (onclose), primary
  `I agree to the Terms` (onagree).
- Escape key and overlay click call onclose. The dialog has
  role="dialog" aria-modal="true" aria-label="Trade risk acknowledgment".

4. `+page.svelte` — five edits, exact anchors:

a. Imports block (next to `import AuthModal from "./components/AuthModal.svelte";`):

```ts
import AckModal from "./components/AckModal.svelte";
import { hasAcked, recordAck } from "$lib/terminal/ack";
```

b. Near `let authOpen = false;` (line ~309), add state + helper in the
page's legacy style:

```ts
let ackOpen = false;
let pendingAckAction: (() => void) | null = null;

// Gate a trading submit behind the one-time risk ack (PRD #493). The
// pending action runs only after "I agree" — closing the modal drops it.
function requireTradeAck(action: () => void): void {
  if (hasAcked($privyAuth.walletAddress)) {
    action();
    return;
  }
  pendingAckAction = action;
  ackOpen = true;
}

function onAckAgree(): void {
  recordAck($privyAuth.walletAddress);
  track("ack_accepted", {});
  ackOpen = false;
  const action = pendingAckAction;
  pendingAckAction = null;
  action?.();
}
```

(`track` is already imported in this file.)

c. In `onPerpSubmitClick()` (~line 844), replace the line
`    void submitPhoenixOrder();`
with
`    requireTradeAck(() => void submitPhoenixOrder());`

d. In `onSpotLimitSubmitClick()`, replace
`    void submitSpotLimitOrder();`
with
`    requireTradeAck(() => void submitSpotLimitOrder());`

e. Spot market swap — TWO call sites:
- In `onSpotTicketKeydown` (~line 888), replace
  `    else void executeSpotSwap();`
  with
  `    else requireTradeAck(() => void executeSpotSwap());`
- The SpotTicketForm mount (~line 4727), replace
  `    onswap={executeSpotSwap}`
  with
  `    onswap={() => requireTradeAck(() => void executeSpotSwap())}`

f. Mount the modal next to the AuthModal mount (~line 4620):

```svelte
{#if ackOpen}
  <AckModal onagree={onAckAgree} onclose={() => { ackOpen = false; pendingAckAction = null; }} />
{/if}
```

Note the FundsModal's `onswap={performSwap}` (~line 4706) is NOT touched.

## Acceptance criteria

- Fresh wallet: any of the three trading submits opens the modal instead
  of submitting; "I agree" records the ack, fires `ack_accepted`, and runs
  exactly the intercepted action; "Not now"/Escape/overlay closes and
  drops it (no submission).
- Acked wallet (including after reload): submits proceed with zero extra UI.
- FundsModal deposit/withdraw/convert untouched by the gate.
- ack.test.ts matrix passes; token-only CSS (no hex fallbacks — pitfall 16).
- Zero new `unused css selector` warnings.

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
4. NO claims of success without validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `status` / `diff` / `log` only. Never commit,
  push, stash, restore, reset, or clean.
- Stay inside the file lists above; in +page.svelte touch only the anchors.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
