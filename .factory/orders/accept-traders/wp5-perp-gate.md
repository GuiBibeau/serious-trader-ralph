# WP5 — Perp soft gate: request access at submit, ticket state preserved

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #498, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

Non-whitelisted wallets (`phoenixWhitelisted === false`) keep the FULL perp
experience — desk, ticket, books, liq math. Only when they press submit:
the ticket's submit button is replaced inline by "Perps are invite-only for
now" + a Request access action (one click → Discord webhook + telemetry,
persisted per wallet). Nothing the user typed is lost; no other UI hides.

## Non-goals

- `phoenixWhitelisted === null` (unknown / API hiccup) stays FAIL-OPEN:
  submit proceeds as today and the venue's own error surfaces. Only a
  definitive `false` soft-gates.
- No email-input UI — the request sends the wallet + Privy email if known.
- No changes to spot flows, FundsModal, AckModal, or the gate layer
  (`gates.ts` is geo policy; this is venue access — separate).
- No modal. This is an inline ticket state.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/access.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/access.test.ts

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte
  — ONLY the edits in payload 3 (legacy `$:` style file — match it).
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/TicketForm.svelte
  — props + submit-region branch + scoped CSS per payload 4 (runes file).

Delete: none

## Load-bearing payloads

1. `src/lib/terminal/access.ts` — mirror the structure of the adjacent
`ack.ts` (same StorageLike injection, same guards), with:
key `const ACCESS_KEY = "trader-ralph-terminal/perp-access/v1";`,
exports `hasRequestedPerpAccess(wallet, storage?)` and
`recordPerpAccessRequest(wallet, storage?)`. Format to biome's line width
(run `bunx biome check --write` on the file before validating).

2. `src/lib/terminal/access.test.ts` — same matrix as `ack.test.ts` with a
Map-backed fake StorageLike: null wallet, unknown wallet, record→has, two
wallets independent, corrupted JSON no-throw, non-array JSON.

3. `+page.svelte` edits:

a. Import (next to the `hasAcked, recordAck` import):
```ts
import {
  hasRequestedPerpAccess,
  recordPerpAccessRequest,
} from "$lib/terminal/access";
```

b. Near `let ackOpen = false;` add (legacy style):
```ts
// Perp soft gate (PRD #493 / #498): a definitive not-whitelisted answer
// swaps the ticket submit for an inline request-access state. Unknown
// (null) fails open — the venue's own error is the honest signal then.
let perpGateNotice = false;
let perpAccessBusy = false;
let perpAccessTick = 0;
$: perpAccessRequested =
  perpAccessTick >= 0 && hasRequestedPerpAccess($privyAuth.walletAddress);

async function requestPerpAccess(): Promise<void> {
  const wallet = $privyAuth.walletAddress;
  if (!wallet || perpAccessBusy) return;
  perpAccessBusy = true;
  try {
    const res = await fetch("/notify-discord", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `Perp access request: ${wallet} · ${$privyAuth.email ?? "no-email"}`,
      }),
    });
    if (!res.ok && res.status !== 204) throw new Error(`notify ${res.status}`);
    recordPerpAccessRequest(wallet);
    track("perp_access_requested", { wallet });
    perpAccessTick += 1;
  } catch {
    phoenixActionError = "Could not send the access request — try again.";
  } finally {
    perpAccessBusy = false;
  }
}
```
(`track` and `phoenixActionError` already exist in this file.)

c. In `onPerpSubmitClick()` (~line 869), insert as the FIRST line of the
function body, before the `canSubmitPerp` check:
```ts
    if (phoenixWhitelisted === false) {
      perpGateNotice = true;
      return;
    }
```

d. Reset the notice when the market/wallet context changes — add after the
function (same script block):
```ts
  // A new wallet or a whitelist flip clears the inline gate notice.
  $: if (phoenixWhitelisted !== false && perpGateNotice) perpGateNotice = false;
```

e. At the TicketForm mount (the one passing `canSubmit={canSubmitPerp}`,
~line 4785), add two props:
```svelte
    perpGate={{
      show: perpGateNotice && phoenixWhitelisted === false,
      requested: perpAccessRequested,
      busy: perpAccessBusy,
    }}
    onrequestaccess={() => void requestPerpAccess()}
```

4. `TicketForm.svelte` edits:

a. Props: add to the destructuring and type (match existing style):
```ts
    perpGate,
    onrequestaccess,
```
```ts
    perpGate: { show: boolean; requested: boolean; busy: boolean };
    onrequestaccess: () => void;
```

b. Submit region: the final `{:else}` branch currently renders the wide
primary submit button (the one with `disabled={!canSubmit || limitBlocked}`
and the two-stage armed comment). Wrap ONLY that branch's content:

```svelte
  {:else if perpGate.show}
    <div class="perp-gate" role="status">
      <p>Perps are invite-only for now. Spot trading is open.</p>
      {#if perpGate.requested}
        <button class="primary wide" type="button" disabled>
          Access requested — we'll be in touch
        </button>
      {:else}
        <button
          class="primary wide"
          type="button"
          disabled={perpGate.busy}
          onclick={onrequestaccess}
        >
          {#if perpGate.busy}<span class="spinner" aria-hidden="true"></span>{/if}
          {perpGate.busy ? "Requesting…" : "Request perp access"}
        </button>
      {/if}
    </div>
  {:else}
    <!-- (existing wide submit button branch, unchanged) -->
```

i.e. insert a new `{:else if perpGate.show}` branch BEFORE the existing
`{:else}`; do not modify the existing button.

c. Scoped CSS (token-only — pitfall 16):
```css
  .perp-gate {
    display: grid;
    gap: 0.4rem;
  }

  .perp-gate p {
    margin: 0;
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.4;
  }
```

## Acceptance criteria

- Whitelisted wallet: zero behavior change (all existing branches intact).
- `phoenixWhitelisted === false`: submit click swaps the button for the
  inline notice; every typed ticket value (size/leverage/TP/SL/limit)
  remains untouched; Request → busy → "Access requested" (persisted:
  reload keeps the requested state); Discord POST body contains wallet.
- `phoenixWhitelisted === null`: submit proceeds exactly as before.
- access.test.ts matrix passes; biome-formatted; zero new
  `unused css selector` warnings.

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
