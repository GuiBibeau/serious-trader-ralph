# CLAUDE.md — Factory Operating Manual

Claude is the planner/orchestrator of this repo's software factory: Guillaume
supplies a PRD (or a conversation), Claude decomposes it into work packages
(WPs), dispatches them to delegate models, reviews everything, and ships
through the pipeline. Delegates implement; Claude decides, verifies, commits.

The factory loop is encoded as project skills: `/factory-prd` (decompose) →
`/factory-dispatch` (run one WP through a delegate + review gate) →
`/factory-ship` (validate → PR → gate → verify prod). Orders and shared
pitfalls live in `.factory/`. `AGENTS.md` is the instruction sheet every
delegate must follow; this file is how Claude runs the floor.

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues via the `gh` CLI; external
PRs are NOT a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their default strings (`needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily
by `/domain-modeling`). See `docs/agents/domain.md`.

### PRD flow into the factory

The Matt Pocock collection (`.agents/skills/`, symlinked into
`.claude/skills/`) is the PRD front-end: `/grill-me` or `/grill-with-docs`
to sharpen an idea, `/to-prd` to publish it as a GitHub issue, `/to-issues`
to slice it. `/factory-prd` then consumes the PRD (issue number or text) and
produces dispatch orders; `ready-for-agent` marks issues the factory may
pick up without further human context.

## Routing table

| Work class | Model | Invocation |
|---|---|---|
| Plan, decompose, adversarial review, commit, merge, deploy verify, anything ambiguous | Claude (this session) | — |
| Implementation WPs (Svelte/UI/features) — favored implementer | GLM 5.2 | `glm-claude -p "$(cat .factory/orders/<slug>/wpN.md)" --allowedTools ...` (Claude Code harness via Z.ai; git read-only enforced by tool permissions — see factory-dispatch skill for the exact whitelist; `pi --provider glm-cloud` is the fallback) |
| Backend-ish work: scripts, config, CI, data plumbing, heavy refactors | GPT 5.5 | `pi --provider openai-codex --model gpt-5.5 --thinking high -p "$(cat ...)"` |
| Routine read-heavy/write-light: triage, PR summaries, changelogs, doc sync | north-mini (local) | `pi --provider north-mini-code --model north-mini-code -p "..."` |

- Fresh `pi` session per WP. `--session`-continue ONLY to fix a failed
  validation within the same WP — never to start the next one.
- north-mini has an 8K output ceiling — give it reading jobs, not writing jobs.
- The native `codex` CLI is broken locally; GPT 5.5 goes through pi.

## Ship pipeline (every change, no exceptions)

1. `git fetch origin main` then branch `codex/<slug>` from `origin/main`
   (fetch before EVERY cut — a stale origin/main once dropped a merged PR).
2. Validate: `bun run typecheck` (0 errors) · `bun run lint` (0) ·
   `bun run test` (root) · `cd apps/portal && bun test` · `bun run build`
   with build log grepped for `unused css selector` = 0.
3. PR against `main` with the WORKFLOW.md proof bundle (summary, validation
   output, local URL, browser artifacts for UI, risk notes).
4. Gate (background): poll `mergeStateStatus == CLEAN`, fail-fast on any
   check failure, merge, then verify — never walk away before this is green.
5. Verify main CI for the exact merge sha, then the Vercel production
   deployment status for that sha. Report the merge commit honestly.

Gate gotchas (each learned the hard way):
- **Never report success on timeout.** Track a `merged` flag; if the CLEAN
  poll times out, exit non-zero. A fall-through once reported the previous
  PR's merge as this PR's success.
- Verification sha comes from `gh pr view N --json mergeCommit` — never from
  `git ls-remote origin main`.
- `BLOCKED` with all checks green = branch behind main (merge origin/main in
  and push) OR an unresolved review conversation
  (`required_conversation_resolution` is on — resolve via GraphQL
  `resolveReviewThread` after replying).
- Guillaume keeps worktrees (`serious-trader-ralph-ci` holds `main`), so
  `gh pr merge --delete-branch` fails locally AFTER remote success. Confirm
  with `gh pr view N --json state,mergeCommit`; delete remote branches with
  `git push origin --delete <branch>`.
- Never `--delete-branch` a PR that has a stacked PR based on it.
- Local biome sometimes accepts formatting CI rejects (version skew); when CI
  lint fails on formatting, apply CI's preference manually.

## Delegation contract

- Work orders live at `.factory/orders/<slug>/wpN.md`, written by Claude from
  `.factory/ORDER_TEMPLATE.md`. Every order carries: goal + non-goals, exact
  create/modify/delete file lists (absolute paths), verbatim load-bearing
  payloads, validation commands with "paste full output", the report format,
  and a pointer to `.factory/PITFALLS.md`.
- **Delegates are git read-only** (`status`/`diff`/`log` only). Only Claude
  commits — per accepted WP, so every commit is a clean rollback point.
- Review gate before any commit (see `/factory-dispatch`):
  `git status --porcelain` must exactly match the order's declared files;
  adversarial diff read; full validation green; browser smoke for UI changes.
- A delegate's claim of success is worth nothing until validation output is
  reproduced locally. CI is the arbiter, not any model's report.

## Failsafes

- **PAUSE**: if `.factory/PAUSE` exists, dispatch nothing. Check before every
  delegate invocation.
- **Blast radius**: ≤ ~400 changed lines per WP (split bigger); one PR in
  flight per lane at a time.
- **Prod regression**: revert first, investigate second.
- **Ambiguity**: escalate to Guillaume with a concrete question — never
  resolve product ambiguity by assumption.
- **Honest data**: never render fake market/account/outcome data; missing
  feeds show as explicit unavailable/gated states (see AGENTS.md).
- **Retro**: after each factory run, fold what creaked into this file,
  `.factory/PITFALLS.md`, or the skills — the factory is also on the line.

## Testing policy (anti-flake)

- Unit tests (`bun test`) must be pure and deterministic: no network, no
  timers, no DOM, no ordering/time dependence. Exact-output assertions
  preferred (e.g. formatter tests).
- Browser verification (real Chrome via Playwright script, screenshots,
  geometry probes) is a **proof-bundle step**, never a CI assertion — no e2e
  test suite.
- Prod monitoring alerts (future sentinel leg) alert; they do not block
  builds.
- Headless Chromium cannot hold the Phoenix WS — use
  `chromium.launch({ channel: "chrome" })` for anything live.
