# Agent Instructions

## Current Scope

- This repo is frontend-only.
- The retained app is the SvelteKit dashboard UI in `apps/portal`.
- The app uses read-only public market data plus the configured Trader Ralph
  edge API where available. Public read routes should use plain
  `/api/read/<routeKey>` APIs; auth-gated routes must be shown as gated rather
  than replaced with fake rows.
- Privy frontend auth is restored by explicit scope change and should stay
  limited to browser-side authentication for account-gated edge reads.
- Do not add or restore Cloudflare Worker, x402, database, payment, React/Next,
  or live Solana execution behavior without another explicit scope change.

## Hosting Org Mapping

- Vercel hosting org/team: `guivercelpro`.
- Cloudflare account/org, if a future scope change requires it: personal
  account owned by `gui.bibeau@solana.org`.
- Do not use the Solana Foundation Cloudflare org/account for this repo.

## Environment and Domains

- Production branch: `main`.
- Production domain: `trader-ralph.com` and `www.trader-ralph.com`.
- Lower environment: `dev` branch -> `dev.trader-ralph.com`.
- There is no frontend requirement for `api.trader-ralph.com` in the current
  repo shape.

## Promotion Guardrails

- Promotion flow is `feature/*` or `codex/*` -> PR preview -> `main`.
- `dev` remains available as an optional soak lane and is not a required
  promotion step.
- Vercel is the only expected hosting target for the current frontend-only app.
- Do not manually remap custom domains outside CI unless production is degraded
  and an emergency fix is required.

## Required Validation

- Run `bun run typecheck` and `bun run build` for code changes.
- For visible UI changes, run a browser smoke check at
  `http://localhost:3000/terminal`.

## Agentic Execution Checklist

- Keep changes scoped to `apps/portal`, frontend config, or docs unless the user
  explicitly expands the repo scope.
- Before pushing a branch, include any CI-impacting workflow or env changes in
  the same PR.
- Before merging each PR into `main`, confirm required checks are green.
- If the repo owner or operator explicitly authorizes merge in-thread, OpenAI
  or Codex review with no blocking findings can satisfy the final review gate
  without a separate human GitHub review.
