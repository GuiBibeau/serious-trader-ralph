# Agent Instructions

## Hosting Org Mapping

- Vercel hosting org/team: `guivercelpro`
- Cloudflare account/org: personal account owned by `gui.bibeau@solana.org`
- Do **not** use the Solana Foundation Cloudflare org/account for this repo.

## Environment and Domains

- Production branch: `main`
- Production domain: `trader-ralph.com` (and `www.trader-ralph.com`)
- Lower environments:
  - `dev` branch -> `dev.trader-ralph.com`
  - `staging` branch -> `staging.trader-ralph.com`

## Deployment Automation Guardrails

- Promotion flow is strict: `feature/*` or `codex/*` -> `dev` -> `staging` -> `main`.
- Cloudflare worker deploys are branch-based and automatic:
  - `dev` push -> `ralph-edge-dev`
  - `staging` push -> `ralph-edge-staging`
  - `main` push -> `ralph-edge`
- Vercel portal deploys are branch-based and automatic:
  - `dev` push -> deploy preview + enforce alias `dev.trader-ralph.com`
  - `staging` push -> deploy preview + enforce alias `staging.trader-ralph.com`
  - `main` push -> deploy production + enforce aliases `trader-ralph.com`, `www.trader-ralph.com`, `api.trader-ralph.com`
- Vercel build env routing is injected in CI per branch to prevent drift:
  - `dev` -> `NEXT_PUBLIC_EDGE_API_BASE=https://dev.api.trader-ralph.com`, `NEXT_PUBLIC_SITE_URL=https://dev.trader-ralph.com`
  - `staging` -> `NEXT_PUBLIC_EDGE_API_BASE=https://staging.api.trader-ralph.com`, `NEXT_PUBLIC_SITE_URL=https://staging.trader-ralph.com`
  - `main` -> `NEXT_PUBLIC_EDGE_API_BASE=https://api.trader-ralph.com`, `NEXT_PUBLIC_SITE_URL=https://trader-ralph.com`

## Required CI Secrets (GitHub Actions)

- Cloudflare:
  - `CLOUDFLARE_API_TOKEN`
- Vercel:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- Store Vercel secrets in each GitHub Environment used by workflows: `dev`, `staging`, and `production`.

## Agentic Execution Checklist

- Before pushing a branch, make sure CI-impacting workflow and env changes are included in the same PR.
- Before merging each lane PR (`feature -> dev`, `dev -> staging`, `staging -> main`), confirm required checks are green.
- Do not manually remap `dev`/`staging` custom domains outside CI unless production is degraded and an emergency fix is required.
