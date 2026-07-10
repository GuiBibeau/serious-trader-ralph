# WP3 — Wizard step 1: real receive screen with live auto-advance

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #513, PRD #510). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

Replace the wizard's step-1 placeholder with the real receive screen: a QR
code of the wallet address, tighter balance polling while the wizard sits
on step 1, and a funds-detected beat — a brief celebratory pulse when the
balance flips, then the existing state-derived step advance (W2's `step`
derivation already flips 1→2 when `funded` becomes true; you are adding
the polish around it, not new navigation).

## Non-goals

- No Ultra/gasless execution (W4). No starter ticket (W5).
- No changes to FundsModal, the strip, or step 2/3 bodies.
- No new dependencies — the `qrcode` package is already in the portal
  (FundsModal lazy-imports it).

## Files

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/FundingWizard.svelte
  — step-1 body + QR + funds-detected beat (payload 1).
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte
  — ONLY payload 2 (fast-poll while wizard open on step 1).

Create/Delete: none

## Load-bearing payloads

1. `FundingWizard.svelte` changes (runes file):

a. QR: lazy-import exactly like FundsModal (keep `qrcode` out of the
entry chunk):
```ts
let qrSvg = $state<string | null>(null);
$effect(() => {
  if (!address) return;
  let cancelled = false;
  void import("qrcode").then(async ({ default: QRCode }) => {
    const svg = await QRCode.toString(address, {
      type: "svg",
      margin: 0,
      color: { dark: "#e8e8ef", light: "#00000000" },
    });
    if (!cancelled) qrSvg = svg;
  });
  return () => {
    cancelled = true;
  };
});
```
Match FundsModal's actual QRCode.toString options if they differ — check
that file first and mirror its colors/options verbatim; the payload above
yields to the existing convention on conflict.

b. Step-1 body becomes: QR block (10rem square, centered,
`{@html qrSvg}` inside a bordered tile; while `qrSvg` is null show an
empty tile with `aria-hidden` skeleton) + the existing address row with
COPY + the existing hint line. Keep all existing copy.

c. Funds-detected beat: track the previous `funded` value; when it flips
false→true while the wizard is open, set `fundsJustArrived = true` for
1400ms. While true, render a `.funds-beat` row replacing the hint line:
`✓ Funds received` (var(--up), 0.8rem) with a one-time scale pulse:

```css
.funds-beat {
  color: var(--up);
  animation: funds-pulse 480ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes funds-pulse {
  0% { transform: scale(0.94); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .funds-beat { animation: none; }
}
```
The step indicator advances on its own via the `step` derivation — do NOT
delay or fake it; the beat overlaps the transition (implement the flip
detection with `$effect` watching `funded`).

2. `+page.svelte` — faster funds detection while the user watches step 1.
Near the wizard state block, add (legacy `$:` style):

```ts
// While the wizard is open and the wallet is unfunded, poll balances
// every 5s so "this screen will advance on its own" is actually prompt —
// the ambient 30s cadence stays for everything else.
let wizardPollTimer: ReturnType<typeof setInterval> | null = null;
$: {
  const wantFast = wizardOpen && !welcomeFunded && Boolean(walletBalanceAddress);
  if (wantFast && wizardPollTimer === null) {
    wizardPollTimer = setInterval(() => {
      if (walletBalanceAddress) {
        void refreshWalletBalance(walletBalanceAddress, { quiet: true });
      }
    }, 5_000);
  } else if (!wantFast && wizardPollTimer !== null) {
    clearInterval(wizardPollTimer);
    wizardPollTimer = null;
  }
}
```
Also clear the timer in the page's existing onDestroy/cleanup return
(find where the `timers` array is cleared and add
`if (wizardPollTimer !== null) window.clearInterval(wizardPollTimer);`).

## Acceptance criteria

- Step 1 shows a scannable QR of the FULL address; QR chunk stays lazy
  (verify `qrcode` is not in the entry bundle — same as before this WP).
- Funding the wallet while on step 1: balance flip detected within ~5s,
  "✓ Funds received" pulse renders, step indicator advances to 2 via the
  existing derivation; reduced-motion gets no animation.
- Closing the wizard (or funding completing) stops the fast poll timer —
  no leaked intervals (verify via the reactive teardown).
- Zero change for onboarded wallets or signed-out visitors.
- Token-only CSS except the QR svg colors (mirroring FundsModal's
  existing QR convention); zero new `unused css selector` warnings.

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
