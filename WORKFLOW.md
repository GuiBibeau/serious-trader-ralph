---
version: 2
tracker:
  kind: github
  repository: GuiBibeau/serious-trader-ralph
branching:
  branch_prefix: codex/
  branch_format: codex/<short-task-slug>
  default_pr_base: main
validation:
  default:
    - bun run lint
    - bun run typecheck
  terminal:
    - bun run test:e2e
  worker:
    - bun run test:unit
proof_bundle:
  required:
    - summary_of_changes
    - validation_commands_and_results
    - preview_or_local_urls_for_ui_changes
    - browser_artifacts_for_ui_changes
    - risk_notes_and_follow_ups
approval:
  posture: high-trust repo-owned execution with human review before merge
secrets:
  never_commit:
    - .env*
    - apps/worker/.dev.vars
    - wallet private keys
    - API tokens
  approved_sources:
    - GitHub Actions secrets
    - Cloudflare Wrangler secrets
    - Vercel environment variables
---

# Trader Ralph Execution Contract

This file is the repo-owned contract for humans and agents working on the
terminal and Worker APIs.

## Scope

The repo is now focused on:

- The terminal UI in `apps/portal`.
- The Cloudflare Worker in `apps/worker`.
- Shared TypeScript contracts under `src/runtime` and `src/loops` that are
  still consumed by the Worker.
- Execution, market-information, discovery, and agent-registry documentation.

The removed root CLI, harness runner, proof routes, Rust sidecar, and
strategy-desk UI are not valid workflow targets.

## Branching and PR Rules

- Use `codex/<short-task-slug>` for agent branches.
- Open PRs against `main` by default.
- Keep PRs scoped to the terminal, Worker API, docs, tests, or deploy workflow
  touched by the task.
- Do not push directly to `dev` or `main`.

## Validation Requirements

Always run the smallest relevant validation set and report the exact commands.

Default validation:

```bash
bun run lint
bun run typecheck
```

Use targeted additions when appropriate:

- terminal UI changes: add `bun run test:e2e` and a browser smoke check.
- Worker execution or market-data changes: add `bun run test:unit` and the
  narrowest relevant integration suite.
- docs-only changes: `bun run lint` is usually enough.
- deployment or environment changes: include the relevant Vercel, Cloudflare,
  or GitHub Actions smoke check.

## Proof Bundle Requirements

Every PR summary should include:

1. A short change summary.
2. The exact validation commands run and whether they passed.
3. The preview URL or local URL used for UI verification.
4. Browser screenshots, traces, or videos for UI-affecting changes.
5. Risk notes, follow-ups, and anything intentionally deferred.

If a proof item is not applicable, say so explicitly.

## Approval Posture

- Human GitHub review is preferred before merge.
- An explicitly authorized agent merge may proceed only when review feedback has
  no blocking findings and required checks are green.
- Merging a PR does not authorize real-money trading behavior by itself.
- Any live execution rollout requires separate operator approval, allowlist
  posture, kill controls, and rollback notes.

## Secret Boundaries

- Never commit `.env` files, `.dev.vars`, private keys, tokens, or customer
  data.
- Use GitHub Actions secrets, Cloudflare secrets, and Vercel environment
  variables for deployment-time configuration.
- Local verification may read approved local secret stores, but those values
  must never be copied into tracked files, issue comments, PR comments, or logs.

## Repository-Specific Guardrails

- The public API boundary is the Cloudflare Worker in `apps/worker`.
- Existing x402 and execution endpoint contracts must remain stable unless the
  issue explicitly calls for a contract change.
- Keep terminal changes ergonomic and dense; do not reintroduce admin proof or
  strategy-lab screens into the primary UI.
- When deploy behavior changes, include CI and environment changes in the same
  PR so lane configuration does not drift.
