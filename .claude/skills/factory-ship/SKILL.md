---
name: factory-ship
description: Ship the current branch — validate, open a PR with a proof bundle, then either gate straight to production (auto lane) or post the preview URL and wait for Guillaume's approval (approval lane). Use when accepted work packages are committed and ready to release.
---

# factory-ship — validate → PR → [approval] → gate → verify prod

Ships the current `codex/<slug>` branch and reports the outcome honestly.
Never declare success before the deployment status is verified.

## Lanes — pick one first

- **auto** — docs, retro, factory-internal changes: gate immediately after
  the PR opens.
- **approval** (default for feature/UI work, mandatory for PRD #493-era
  feature tickets): open the PR, post the **preview URL** to Guillaume,
  and STOP. Only run the gate after an explicit "approve #N". Mark the PR
  body "DO NOT MERGE — awaiting Guillaume's preview QA".

## 1. Validate (all green before any push)

```bash
cd /Users/guillaume/Github/serious-trader-ralph
bun run typecheck && bun run lint && bun run test
(cd apps/portal && bun test)
bun run build 2>&1 | tee /tmp/ship-build.log
grep -ci "unused css selector" /tmp/ship-build.log   # must print 0
```

## 2. PR

Push the branch and open a PR against `main` with the WORKFLOW.md proof
bundle: change summary, validation commands + results, local URL used for
UI verification, browser artifacts (screenshots) for UI changes, risk
notes / deferred items. Reference the ticket (`Closes #N`).

## 3. Preview URL (approval lane)

```bash
scripts/factory/preview.sh <pr-number>
```

Post PR link + preview URL + concrete QA notes ("what to check") to
Guillaume. Wait. Do not gate.

## 4. Gate (after approval, or immediately in the auto lane)

```bash
scripts/factory/gate.sh <pr-number> [<pr-number>...]
```

Run in background. Multiple approved PRs can be passed at once — the
script serializes them and refreshes each subsequent branch onto the new
main between merges.

Gate outcomes:
- `CHECK FAILURE` → fix on the branch, push, rerun the gate.
- `BLOCKED` + green checks → branch behind main (script handles this for
  queued PRs; for a single PR, merge origin/main in and push) OR an
  **unresolved review conversation** — the codex bot reviews most PRs and
  its P2s are usually right: fix, reply, resolve via GraphQL
  `resolveReviewThread`, and the still-polling gate picks it up.
- Timeout → it is a timeout; report it as one. Never infer success.
- Local branch delete may fail (worktrees hold `main`) — remote delete is
  what matters; confirm with `gh pr view N --json state,mergeCommit`.

## 5. Report

Merge commit sha · main CI result · production deployment result — exactly
as observed. If any step failed or was skipped, say so plainly.
