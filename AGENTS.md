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

## Design System (packages/ui)

- `@trader-ralph/ui` is a bun-workspace package consumed source-direct: the
  `"svelte"` export condition points at `src/index.ts` and there is no build
  step. Portal's `vite.config.ts` sets `ssr: { noExternal: ["@trader-ralph/ui"] }`
  so the `.svelte` files are compiled by the app's Vite/Svelte pipeline.
- Entry-point invariant: server-side code (`apps/portal/src/lib/server/`,
  `routes/og/`) imports ONLY `@trader-ralph/ui/tokens` or
  `@trader-ralph/ui/format` (pure TS, no `.svelte`). The component barrel
  `@trader-ralph/ui` and `tokens.css` are client/SSR-component territory.
- Palette single source of truth: `packages/ui/src/tokens/colors.ts` (TS,
  canonical) mirrored by hand in `packages/ui/src/tokens.css`; `colors.test.ts`
  is the drift guard (`bun run --cwd packages/ui test`).
- Palette hexes outside packages/ui: only the terminal's lightweight-charts
  theme (`apps/portal/src/routes/terminal/+page.svelte`), which must pass
  concrete strings to the charting library and mirrors `colors.ts` by hand
  (its `--chart-bg` is consumed via the imported `colors.chartBg` value), plus
  `static/brand` assets with baked accent/ink hexes. Every other surface uses
  tokens.
- Neo-brutalist layer: `--shadow-hard` / `--shadow-hard-sm` tokens and
  `--radius: 0`. Hard shadows and press mechanics (Button hover/active
  translate, 3px offset shadow; TabNav 3px underline) are marketing-surface
  only. The terminal stays flat and dense with its own hard-coded metrics
  (its radii are squared in place; circles stay 50%).
- Two formatter dialects by design: `@trader-ralph/ui/format` renders "—"
  for null (marketing/OG); `apps/portal/src/lib/utils.ts` renders "--"
  (terminal). Different null/digit semantics — do not merge them.
- Scoped-style pitfall: when extracting or moving a component, move the
  `<style>` block with the markup. The build emits `unused css selector`
  warnings when a selector loses its markup and must stay at 0 — but it does
  NOT warn about markup classes that lost their styles, so check that
  direction manually.

## Hosting Org Mapping

- Vercel hosting org/team: `guivercelpro`.
- Cloudflare account/org, if a future scope change requires it: personal
  account owned by `gui.bibeau@solana.org`.
- Do not use the Solana Foundation Cloudflare org/account for this repo.

## Environment and Domains

- Production branch: `main`.
- Production domain: `traderralph.com`; `trader-ralph.com` and
  `www.trader-ralph.com` redirect to it.
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

- Run `bun run typecheck` and `bun run build` for code changes. Root
  `bun run typecheck` chains `packages/ui` then `apps/portal`; root
  `bun run test` runs typecheck plus the `packages/ui` drift test.
- For visible UI changes, run a browser smoke check at
  `http://localhost:3000/terminal`.

## Agentic Execution Checklist

- Keep changes scoped to `apps/portal`, `packages/ui`, frontend config, or docs
  unless the user explicitly expands the repo scope.
- Before pushing a branch, include any CI-impacting workflow or env changes in
  the same PR.
- Before merging each PR into `main`, confirm required checks are green.
- If the repo owner or operator explicitly authorizes merge in-thread, OpenAI
  or Codex review with no blocking findings can satisfy the final review gate
  without a separate human GitHub review.

## Factory

- This repo runs a factory loop orchestrated by Claude: PRDs become work
  orders under `.factory/orders/`, dispatched to delegate models. See
  `CLAUDE.md` (operating manual) and `.factory/README.md`.
- If you were invoked with a work order: the order's file lists, validation
  commands, and `.factory/PITFALLS.md` are binding. Git is read-only for
  delegates — never commit, push, stash, reset, or clean.
