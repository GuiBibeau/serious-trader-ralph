---
name: factory-dispatch
description: Dispatch one work order to its delegate model via pi, then run the review gate and commit on pass. Use after /factory-prd has written orders and Guillaume confirmed the dispatch plan.
---

# factory-dispatch — run one work package through a delegate

Takes one order (`.factory/orders/<slug>/wpN.md`), runs the assigned
delegate, reviews the result adversarially, and commits only what survives.

## Pre-flight (hard gates)

1. **PAUSE check**: if `.factory/PAUSE` exists → stop, dispatch nothing,
   tell Guillaume the factory is paused.
2. Working tree must be clean apart from expected untracked files
   (`git status --porcelain`) — never dispatch onto a dirty tree.
3. The order file exists and has no unfilled `<placeholders>`.
4. **Branch**: for a slug's first WP, `git fetch origin main` and cut
   `codex/<slug>` from `origin/main` before dispatching; for later WPs,
   confirm you're already on that branch. The delegate mutates whatever
   is checked out — never dispatch from a stale or unrelated branch.

## Dispatch

Pick the invocation from the CLAUDE.md routing table. Default
(implementation WP) — **glm-claude**, GLM 5.2 under the Claude Code
harness, git read-only enforced by tool permissions:

```bash
cd /Users/guillaume/Github/serious-trader-ralph
glm-claude -p "$(cat .factory/orders/<slug>/wpN.md)" \
  --allowedTools "Read" "Edit" "Write" "Grep" "Glob" \
  "Bash(bun:*)" "Bash(bunx:*)" \
  "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" \
  "Bash(curl:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(head:*)" "Bash(tail:*)" \
  "Bash(grep:*)" "Bash(rg:*)" "Bash(lsof:*)" "Bash(kill:*)" "Bash(sleep:*)"
```

(`glm-claude` = `~/bin/glm-claude`: Z.ai Anthropic endpoint, isolated
`~/.claude-glm` config. Never widen --allowedTools to bare "Bash".)

Backend/config WP: `pi --provider openai-codex --model gpt-5.5 --thinking
high -p "$(cat ...)"`. Routine WP: `pi --provider north-mini-code --model
north-mini-code -p "..."`.

- Fresh session per WP (no `--continue`/`--session` reuse across WPs).
- Run in background for long WPs; watch for stalls. If a delegate stalls
  twice on the same WP, take it over by hand — don't spin a third time.

## Review gate (nothing is committed until ALL pass)

1. **File-list match**: `git status --porcelain` output must exactly match
   the order's declared create/modify/delete lists. Any extra file =
   reject (revert the stray change or restart the WP).
2. **Adversarial diff read**: read the full diff assuming the delegate is
   plausible-but-wrong. Check PITFALLS compliance (scoped CSS moved with
   markup, runes in new components, byte-identical moves, no dialect
   crossing, no fake data).
3. **Validation reproduced locally** — never trust pasted output:
   `bun run typecheck && bun run lint && bun run test`, then
   `cd apps/portal && bun test`, then `bun run build` with build output
   grepped for `unused css selector` (must be 0).
4. **Browser smoke for UI changes**: real Chrome
   (`chromium.launch({ channel: "chrome" })` — headless blocks Phoenix WS),
   screenshot the affected surface for the proof bundle.

## On failure

- One `--session`-continue with a precise fix order (quote the exact
  failure output), same WP only.
- Second failure → Claude fixes by hand or rewrites the order. Note the
  failure mode in `.factory/PITFALLS.md` if it's general.

## On pass

Claude commits (delegates never do), one commit per accepted WP — message
describes the WP, so every commit is a clean rollback point. Then report:
what shipped, validation summary, what was rejected/amended and why.
