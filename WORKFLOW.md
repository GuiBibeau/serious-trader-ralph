---
version: 1
tracker:
  kind: github
  repository: GuiBibeau/serious-trader-ralph
  ready_labels:
    - harness
    - agent-ready
  exclude_labels:
    - blocked
    - agent-running
    - human-review
branching:
  branch_prefix: codex/
  branch_format: codex/issue-<number>-<slug>
  default_pr_base: main
validation:
  default:
    - bun run lint
    - bun run typecheck
  docs_only:
    - bun run lint
proof_bundle:
  required:
    - summary_of_changes
    - validation_commands_and_results
    - preview_or_local_urls
    - browser_artifacts_for_ui_changes
    - benchmark_delta_for_performance_sensitive_changes
    - risk_notes_and_follow_ups
approval:
  posture: high-trust repo-owned execution with mandatory human review before merge
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

This file is the repo-owned contract for future issue runners and for humans
working the harness backlog manually. It defines how work is selected, how code
is validated, and what evidence must be attached before a PR is ready for
review.

## Eligible Work

Take an issue only when all of the following are true:

- It is in `GuiBibeau/serious-trader-ralph`.
- It includes both `harness` and `agent-ready`.
- It does not include `blocked`, `agent-running`, or `human-review`.

When a run starts, add `agent-running`. When the PR is ready for review, remove
`agent-running` and add `human-review`.

## Branching and PR Rules

- Branch names must follow `codex/issue-<number>-<slug>`.
- Include `Fixes #<issue-number>` in the PR body when the work should close the
  issue on merge.
- Open PRs against `main` by default.
- `dev` remains available as an optional soak lane, but it is not a promotion
  gate.
- Do not push directly to `dev` or `main`.

## Validation Requirements

Always run the smallest relevant validation set and report the exact commands in
the PR summary.

Default validation:

```bash
bun run lint
bun run typecheck
```

Use a narrower set only when the issue is documentation-only or when a more
focused test suite is clearly sufficient. Examples:

- docs-only: `bun run lint`
- worker changes: add `bun run test:unit` and the most relevant integration
  suite
- portal or terminal changes: add `bun run test:e2e` and browser proof once the
  proof harness exists
- deployment or environment changes: include the relevant smoke checks and any
  branch-specific verification notes

## Proof Bundle Requirements

Every PR must include a proof bundle in its summary comment or description. The
bundle must include:

1. A short change summary.
2. The exact validation commands run and whether they passed.
3. The preview URL or local harness URLs used for verification.
4. Browser screenshots, traces, or videos for UI-affecting changes.
5. Benchmark deltas for performance-sensitive changes.
6. Risk notes, follow-ups, and anything intentionally deferred.

If a proof item is not applicable, say so explicitly instead of omitting it.

## Approval Posture

- This repo is operated in a high-trust mode for engineering execution.
- Human review is still mandatory before merge.
- Stop at `human-review`; do not auto-merge unless the repo policy changes in a
  later issue.
- Prefer reversible changes and call out any deployment or rollout risk in the
  PR summary.

## Secret Boundaries

- Never commit `.env` files, `.dev.vars`, private keys, tokens, or customer
  data.
- Use GitHub Actions secrets, Cloudflare secrets, and Vercel environment
  variables for deployment-time configuration.
- Local verification may read from approved local secret stores, but those
  values must never be copied into tracked files, issue comments, PR comments,
  or logs.

## Repository-Specific Guardrails

- The public API boundary is the Cloudflare Worker in `apps/worker`.
- Existing x402 and execution endpoint contracts must remain stable unless the
  issue explicitly calls for a contract change.
- Prefer issue-by-issue PRs with focused scope and explicit dependency handling.
- When deploy behavior changes, include CI and environment changes in the same
  PR so the lane configuration does not drift.
