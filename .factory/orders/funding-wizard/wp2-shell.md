# WP2 — Funding wizard shell: full-screen modal, 3-step spine, strip integration

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #512, PRD #510). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

The funding wizard's shell: a full-screen guided modal over the terminal
(desk visible behind a scrim), a three-step spine whose active step derives
from real account state, and two-way integration with the welcome strip
(strip click opens the wizard; wizard is the strip's expanded form). Step
BODIES are minimal-but-useful in this WP — each step shows its real title,
one line of copy, and wires to an EXISTING action (funds modal / desk).
Later tickets (W3-W5) replace the bodies; the shell, navigation, animation,
and state plumbing you build here are final.

## Non-goals

- No Ultra/gasless usage (W4). No QR/receive internals (W3). No starter
  ticket (W5).
- No changes to FundsModal, AckModal, or ticket components.
- Do not remove or restyle the welcome strip beyond adding the open
  affordance described below.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/FundingWizard.svelte

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/welcome.ts
  — append two functions (payload 2).
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/welcome.test.ts
  — extend the matrix for them.
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/WelcomeStrip.svelte
  — payload 3 (open affordance).
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte
  — ONLY the edits in payload 4 (legacy `$:` file — match its style).

Delete: none

## Design constraints (binding)

- Animation: transform + opacity ONLY. Overlay fades in 220ms; the dialog
  enters translateY(12px)→0 + opacity 0→1, 260ms
  `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out). Step changes
  crossfade + 8px slide, 240ms, same curve. Everything inside
  `@media (prefers-reduced-motion: reduce)` drops to none. NEVER
  scale(0). No keyframes for interruptible things — CSS transitions.
- Focus: trap Tab/Shift+Tab inside the dialog and recover focus if it
  escapes (copy the trapTab pattern from AckModal.svelte verbatim,
  adapted). Escape and scrim-click close. role="dialog" aria-modal="true"
  aria-label="Funding wizard".
- Scrim: `rgba(0, 0, 0, 0.55)` + `backdrop-filter: blur(2px)` — the desk
  must remain recognizable behind it.
- Token-only CSS (pitfall 16). No new fonts, no new colors.

## Load-bearing payloads

1. `FundingWizard.svelte` — runes. Props:

```ts
let {
  address,
  funded,
  collateralized,
  traded,
  onopenfunds,
  onclose,
}: {
  address: string;
  funded: boolean;
  collateralized: boolean;
  traded: boolean;
  onopenfunds: () => void;
  onclose: () => void;
} = $props();

// Active step derives from real state — never stored:
const step = $derived(!funded ? 1 : !collateralized ? 2 : 3);
```

Layout: fixed inset-0 wrapper (z-index above the terminal chrome — check
what AuthModal/AckModal use and go one step above only if required);
scrim div; centered dialog `min(40rem, 92vw)` wide, max-height 86vh,
panel styling per the terminal modal conventions (var(--surface), 1px
var(--line) border).

Dialog structure:
- Header: kicker `GET FUNDED`, title `Three steps to your first trade`,
  close × (aria-label="Close wizard").
- Step indicator: three segments (`1 Receive`, `2 Activate`, `3 Trade`)
  — completed = var(--up) check, active = var(--accent) underline,
  upcoming = var(--faint).
- Body (crossfade region), per step:
  - Step 1 — title `Send funds to your wallet`; copy
    `USDC or SOL on Solana. Your address:` + address in mono with a Copy
    button (navigator.clipboard.writeText, "Copied" state 1.5s); hint
    `Sends of $10+ unlock gasless setup. This screen will advance on its
    own when funds arrive.`
  - Step 2 — title `Make it tradable`; copy `Move USDC into your Phoenix
    margin account — rent ~0.04 SOL, explained before you sign.`; primary
    button `Open funding` → onopenfunds() (the existing modal, for now).
  - Step 3 — title `You're set`; copy `Funded and ready. Start small.`;
    primary button `Go to the desk` → onclose().
- Footer: `step {step} of 3` in var(--faint) mono.

2. Append to `welcome.ts` (mirror existing style; biome-format):
`hasAutoOpenedWizard(wallet, storage?)` / `recordWizardAutoOpened(wallet,
storage?)` on key `trader-ralph-terminal/wizard-auto/v1`. Extend
`welcome.test.ts` with the same matrix as the dismissal pair.

3. `WelcomeStrip.svelte` — the strip becomes the wizard's re-entry point:
add prop `onopen: () => void;`. Wrap the three step spans region in a
button-like affordance: give the container a click/keyboard path — an
explicit `<button class="strip-open" onclick={onopen}>` wrapping the steps
(reset button styling: transparent, inherit, text-align left, cursor
pointer, flex 1, same internal flex layout as before). The existing
"2. Fund it" `step-action` button must now call `onopen` INSTEAD of
`onfund` (the wizard owns funding guidance; keep the `onfund` prop wired
in the page but it may become unused — if so REMOVE the prop entirely
from both component and page mount to avoid dead API). Dismiss ×
unchanged and must not trigger onopen (stopPropagation).

4. `+page.svelte` edits:

a. Import next to WelcomeStrip's import:
```ts
import FundingWizard from "./components/FundingWizard.svelte";
```
and extend the welcome.ts import with
`hasAutoOpenedWizard, recordWizardAutoOpened`.

b. Near the welcome-strip state block, add:
```ts
let wizardOpen = false;
$: welcomeCollateralized = phoenixTotalCollateral > 0;
// Auto-open once per wallet for fresh authed accounts that still need
// onboarding — afterwards the strip is the re-entry point.
$: if (
  showWelcomeStrip &&
  !wizardOpen &&
  $privyAuth.walletAddress &&
  !hasAutoOpenedWizard($privyAuth.walletAddress)
) {
  recordWizardAutoOpened($privyAuth.walletAddress);
  wizardOpen = true;
}
```

c. WelcomeStrip mount: add `onopen={() => (wizardOpen = true)}` (and drop
`onfund` if payload 3 removed it).

d. Mount the wizard next to the AckModal mount:
```svelte
{#if wizardOpen}
  <FundingWizard
    address={`${($privyAuth.walletAddress ?? "").slice(0, 4)}…${($privyAuth.walletAddress ?? "").slice(-4)}`}
    funded={welcomeFunded}
    collateralized={welcomeCollateralized}
    traded={welcomeTraded}
    onopenfunds={() => {
      wizardOpen = false;
      openFunds();
    }}
    onclose={() => (wizardOpen = false)}
  />
{/if}
```
(Verify `openFunds` is the funds-modal opener's real name; reuse the
actual one.)

Note: step 1 needs the FULL address for receiving funds, not the
shortened one — pass `address={$privyAuth.walletAddress ?? ""}` instead
if step 1's copy button is to be useful. Use the full address; the
component may shorten for DISPLAY but must copy the full value.

## Acceptance criteria

- Fresh authed wallet: wizard auto-opens exactly once (reload → doesn't
  re-open; strip click re-opens). Signed-out: never.
- Active step tracks real state: no funds → 1; funds but no Phoenix
  collateral → 2; collateral → 3. No stored step.
- Copy button copies the FULL wallet address.
- Escape, scrim, and × all close; focus cannot Tab out while open;
  reduced-motion kills all transitions.
- Strip dismiss still works and never opens the wizard.
- Zero visible change for fully-onboarded wallets (no strip → no wizard
  auto-open).
- welcome.test.ts extended matrix passes; token-only CSS; zero new
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
