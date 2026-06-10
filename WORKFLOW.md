---
version: 4
tracker:
  kind: github
  repository: GuiBibeau/serious-trader-ralph
branching:
  branch_prefix: codex/
  branch_format: codex/<short-task-slug>
  default_pr_base: main
validation:
  default:
    - bun run typecheck
    - bun run build
proof_bundle:
  required:
    - summary_of_changes
    - validation_commands_and_results
    - local_url_for_ui_changes
    - browser_artifacts_for_ui_changes
    - risk_notes_and_follow_ups
approval:
  posture: high-trust repo-owned execution with human review before merge
secrets:
  never_commit:
    - .env*
    - wallet private keys
    - API tokens
---

# Trader Ralph Frontend Workflow

This repo is scoped to the `apps/portal` SvelteKit dashboard UI. Backend
services, Cloudflare Workers, x402 routes, runtime contracts, live execution
flows, and React/Next app surfaces are not valid targets unless the repo is
intentionally expanded again.

## Branching and PR Rules

- Use `codex/<short-task-slug>` for agent branches.
- Open PRs against `main` by default.
- Keep PRs scoped to the SvelteKit portal UI, read-only data wiring, styling, or
  frontend build configuration.
- Do not push directly to `dev` or `main`.

## Validation

Use the smallest relevant validation set and report exact commands.

Default validation:

```bash
bun run typecheck
bun run build
```

For visible UI changes, also run a local browser smoke check against
`http://localhost:3000/terminal`.

## UI Guardrails

- Keep the first screen focused on the terminal workspace, not a landing page.
- Preserve dense dashboard ergonomics: chart, order book, tickets, account
  state, macro context, prediction/perp modules, and status should remain easy
  to scan.
- Browser-visible data must be real read-only data or an explicit
  unavailable/auth-required state. Do not invent account, execution, or market
  rows.
- Read-only Trader Ralph edge data should use plain `/api/read/<routeKey>`
  APIs. Do not reintroduce x402 payment gates for dashboard read panels.
- Avoid adding UI/runtime libraries unless they replace meaningful complexity.
- Do not add live trading, auth, payment, database, or worker dependencies
  without an explicit repo-scope change.

## Proof Bundle

Every PR summary should include:

1. A short change summary.
2. Validation commands and results.
3. The local URL used for UI verification.
4. Browser screenshots, traces, or notes for UI-affecting changes.
5. Risks, follow-ups, and anything intentionally deferred.
