# WP3 — Legal baseline: /terms, /privacy, footer links

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #496, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

Two static legal pages (/terms, /privacy) in the marketing style, linked
from the shared SiteFooter and the home page's own footer. The COPY BELOW
IS FINAL for this WP — lay it out verbatim; do not rewrite, embellish, or
add legal language of your own. (Guillaume reviews the copy on the PR
preview; edits happen there, not by you.)

## Non-goals

- No terminal-side links or modals (that's ticket #497).
- No cookie banners, no consent tooling.
- No new dependencies; no OG images for these pages.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terms/+page.svelte
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/privacy/+page.svelte

Modify:
- /Users/guillaume/Github/serious-trader-ralph/packages/ui/src/components/SiteFooter.svelte
  — add two links to the `.links` nav, after the Terminal link:
  `<a href="/terms">Terms</a>` and `<a href="/privacy">Privacy</a>`.
  Change nothing else.
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/+page.svelte
  — the home page has its OWN footer (`<footer class="footer">`, ~line
  230). Inside it, add the same two links wherever its existing nav links
  live, matching the local markup/classes. Change nothing else in this
  file.

Delete: none

## Page pattern

Both pages follow the repo's marketing-page conventions: import
`{ SiteNav, SiteFooter }` from `@trader-ralph/ui` exactly as
`src/routes/news/+page.svelte` does (check its head/imports and copy the
skeleton: `<svelte:head>` with title + meta description, `<SiteNav />`,
a main content column, `<SiteFooter />`). Content column: max-width
~46rem, centered, headings + paragraphs styled with existing CSS tokens
(--ink, --muted, --line-soft). Svelte 5 runes if any script is needed
(none should be — these are static).

`<svelte:head>`: terms → title "Terms of Service — Trader Ralph",
privacy → title "Privacy Policy — Trader Ralph"; meta descriptions one
sentence each.

## Load-bearing payload — /terms copy (verbatim)

# Terms of Service

Last updated: July 6, 2026

## 1. What Trader Ralph is

Trader Ralph ("the Service") is a self-custodial trading interface. It
displays market data and lets you construct transactions — spot swaps and
perpetual futures orders — that you sign with your own wallet and that
execute on public Solana protocols (Phoenix, Jupiter). We do not take
custody of your funds, execute trades on your behalf, operate an exchange,
or act as a broker, dealer, or investment adviser.

## 2. Your wallet, your keys

Signing in creates an embedded self-custodial wallet operated by Privy.
You control it; we cannot move your funds, reverse your transactions, or
recover assets sent to the wrong address. On-chain transactions are final.

## 3. Eligibility

You must be of legal age in your jurisdiction and permitted under the laws
that apply to you to use self-custodial trading software. You are
responsible for your own tax and legal obligations. Wallets are screened
against the OFAC SDN list; access from sanctioned jurisdictions is
prohibited. Availability of specific features may be restricted by region.

## 4. Risk disclosure

Trading digital assets involves substantial risk of loss. Leveraged
perpetual futures can be liquidated: you can lose your entire margin, and
markets can move faster than you can react. Tokenized equities provide
synthetic price exposure only — they carry no shareholder rights, no
dividends, and no claim on any issuer. Prices, market data, and desk
commentary shown in the Service are informational, may be delayed or
wrong, and are not financial advice. Trade only what you can afford to
lose.

## 5. The protocols are not ours

Orders execute on third-party protocols and infrastructure (Solana,
Phoenix, Jupiter, RPC providers). We do not control them and are not
responsible for their availability, behavior, fees, or failures.

## 6. Acceptable use

Do not use the Service to break the law, evade sanctions, manipulate
markets, or probe, disrupt, or reverse-engineer the Service or the
protocols it connects to.

## 7. No warranties; limitation of liability

The Service is provided "as is", without warranties of any kind. To the
maximum extent permitted by law, we are not liable for trading losses,
lost profits, or any indirect, incidental, or consequential damages
arising from your use of the Service — including losses caused by data
errors, downtime, network failures, or protocol behavior.

## 8. Changes

We may update the Service and these terms. Continued use after an update
constitutes acceptance. Material changes will be reflected in the "Last
updated" date above.

## 9. Contact

Questions about these terms: gui.bibeau@solana.org.

## Load-bearing payload — /privacy copy (verbatim)

# Privacy Policy

Last updated: July 6, 2026

## What we collect

- **Email address** — used by Privy to authenticate you and create your
  embedded wallet. We see the email you sign in with.
- **Wallet address** — public by nature; used to display your balances and
  positions and to build your transactions.
- **Usage telemetry** — anonymous product events (orders submitted,
  markets viewed, errors) tied to session identifiers, stored in
  aggregate logs to improve the product.
- **Approximate location** — country/region inferred from your IP by our
  hosting provider at request time, recorded in telemetry. We do not
  store your IP address in our logs.

## What we do NOT collect

Private keys (they live in Privy's isolated infrastructure — we never see
them), government ID, payment cards, or bank details. We do not sell or
rent any of your data, and we do not use advertising trackers.

## Third parties we rely on

- **Privy** — authentication and embedded wallets (email, wallet keys).
- **Vercel** — hosting and request-time geolocation.
- **Solana RPC, Phoenix, Jupiter, market-data providers** — receive the
  public wallet addresses and transactions inherent to using them.

Each processes data under its own privacy policy.

## Retention and your choices

Telemetry is retained in rolling aggregate logs. You can stop using the
Service at any time; your wallet remains yours through Privy
independently of us. For data questions or deletion requests:
gui.bibeau@solana.org.

## Changes

Material changes will be reflected in the "Last updated" date above.

## Acceptance criteria

- /terms and /privacy render the copy above verbatim, styled consistently
  with the marketing pages (dark theme, readable measure, real heading
  hierarchy).
- SiteFooter on news/hub/slug/share pages and the home page footer show
  Terms + Privacy links; no other footer content changed.
- No dead links; pages return 200 in dev.
- Zero new `unused css selector` warnings.

## Validation (run all, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test
bun run build
```

Also grep the build output for `unused css selector` — must be 0
occurrences. Then start the dev server, `curl -sf -o /dev/null -w "%{http_code}"`
for /terms and /privacy (expect 200 each), and KILL the dev server.

## Report format

1. Summary of what changed, per file.
2. Full validation output (verbatim, no truncation).
3. Anything you could not do, skipped, or are unsure about — say so plainly.
4. NO claims of success without validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `status` / `diff` / `log` only. Never commit,
  push, stash, restore, reset, or clean.
- Stay inside the file lists above.
- The legal copy is verbatim — no rewording.
- All pitfalls in `.factory/PITFALLS.md` apply (packages/ui edit: no
  `$lib`/`$app`/`$env` imports there).
