# PRD: Trader Ralph Strategy Lab

**Status:** Accepted for repo planning  
**Date:** 2026-03-10  
**Audience:** product, engineering, infra, ops, and harness execution

## Summary

Trader Ralph can now run a bounded managed-strategy stack through the harness,
the Worker boundary, and the autonomous runtime. What it does not yet have is
a repo-owned system for:

- tracking the latest strategy and venue research with provenance,
- converting research into candidate strategies, venues, and assets,
- evaluating those candidates with reproducible evidence,
- promoting them through shadow, paper, and bounded real-money states.

The strategy-lab program keeps the current architecture intact:

- the Worker remains the only public API boundary,
- the harness remains the only supported delivery workflow,
- new real-money capability stays human-gated and reversible.

## Problem

Without a repo-owned research-to-production contract, new strategy ideas,
venues, and assets will be handled ad hoc. That creates four failure modes:

- research provenance becomes untraceable,
- strategy evaluation becomes irreproducible,
- venue and asset onboarding become inconsistent,
- real-money promotion can happen without explicit evidence boundaries.

## Goals

### Primary goals

- Ingest current research with citations, dates, and provenance.
- Convert research into candidate StrategySpecs and evaluation plans.
- Support new strategies, venues, and assets through the same harness workflow.
- Make promotion from candidate to limited live explicit, auditable, and
  reversible.
- Keep new real-money rollouts bounded by canaries, scorecards, and human
  approval.

### Non-goals for v1

- fully unsupervised broad live rollout,
- arbitrary user-authored executable code in production,
- bypassing the Worker boundary for research or promotion controls,
- promoting a new strategy, venue, or asset directly to broad live from a
  research brief.

## Product principles

- One harness, one delivery model:
  issue -> PR preview -> `main` -> bounded production rollout.
- Research is a first-class artifact:
  source provenance, experiment manifests, and scorecards must survive review.
- Promotion is stateful:
  candidate, shadow, paper, and real-money states are explicit objects, not
  comments or tribal knowledge.
- Money gates are human gates:
  the system may prepare and validate, but humans must authorize real-money
  promotion.
- Rollback must be faster than rollout:
  every production-facing state requires a pause, demotion, or kill path.

## Strategy promotion states

| State | Meaning | Wallet mutation | Entry requirements | Exit or rollback path |
| --- | --- | --- | --- | --- |
| `candidate` | Research hypothesis exists but no runtime-ready implementation is assumed | none | source provenance, hypothesis, expected mechanism, candidate issue | archive, supersede, or promote to `draft` |
| `draft` | StrategySpec, evaluation plan, and implementation scope exist | none | candidate evidence plus StrategySpec draft, feature requirements, failure modes | demote to `candidate`, archive, or promote to `shadow` |
| `shadow` | Runtime evaluates the strategy without mutating wallets | none | merged implementation PR, replay or backtest coverage, shadow-safe defaults, operator sign-off for shadow activation | pause, demote to `draft`, or promote to `paper` |
| `paper` | Runtime uses production-like lifecycle with synthetic execution only | none | shadow scorecards, paper simulator readiness, cost model coverage, explicit operator approval | pause, demote to `shadow`, or promote to `limited_live` |
| `limited_live` | Strategy is allowlisted for bounded real-money validation | bounded real money | paper scorecards, limited-live policy, canary plan, risk budgets, explicit human approval | kill, pause, demote to `paper`, or remove from allowlist |
| `broad_live` | Strategy is eligible for broader live use under current policy | real money | successful limited-live canary and soak, operator review, explicit human approval | demote to `limited_live`, pause, or kill |
| `paused` | Strategy is intentionally blocked while evidence and state remain inspectable | state-dependent | manual or automatic pause action | resume to prior non-terminal state with approval |
| `deprecated` | Strategy remains auditable but is no longer eligible for promotion or execution | none | operator or policy decision | no promotion; replace with a new candidate if needed |

## Venue and asset onboarding states

Venue and asset onboarding must be tracked separately from strategy promotion so
the repo can answer whether a strategy is weak versus whether a venue or asset
is not ready.

| State | Meaning | Required evidence | Rollback path |
| --- | --- | --- | --- |
| `candidate` | Venue or asset is known to the research registry but not yet trusted for runtime use | source provenance, metadata draft, risk notes | archive or supersede |
| `integrated` | Canonical metadata, mappings, and adapter hooks exist | schema coverage, precision rules, identifier mappings, test fixtures | demote to `candidate` or disable |
| `shadow_ready` | Safe for non-mutating replay and shadow evaluation | data coverage, replay fixtures, feature support, adapter validation | demote to `integrated` |
| `paper_ready` | Safe for production-like paper simulation | cost model coverage, paper lifecycle coverage, reconciliation expectations | demote to `shadow_ready` |
| `limited_live_ready` | Safe for tiny-notional bounded live validation | explicit allowlist, readiness gates, kill switch, bounded canary plan | remove from allowlist or pause |
| `broad_live_ready` | Eligible for broader use under current policy | successful limited-live canary and soak, operator approval | demote to `limited_live_ready` |
| `paused` | Temporarily blocked due to drift, venue issues, or policy | pause action and incident context | resume with approval |
| `deprecated` | No longer supported for new promotion work | deprecation decision and replacement path where relevant | no promotion |

## Evidence bundles by transition

### Candidate -> Draft

Required bundle:

- source citations with exact URLs and dates,
- strategy or market hypothesis,
- expected edge mechanism,
- initial venue and asset assumptions,
- known failure modes and disqualifiers.

### Draft -> Shadow

Required bundle:

- StrategySpec or equivalent runtime contract,
- implementation PR with human review,
- deterministic replay or backtest fixtures,
- feature requirements and parameter surface,
- shadow activation notes and kill posture.

### Shadow -> Paper

Required bundle:

- shadow scorecards and replay evidence,
- cost model assumptions,
- reproducibility manifest,
- paper execution plan,
- operator sign-off for paper activation.

### Paper -> Limited Live

Required bundle:

- paper scorecards with promotion gates,
- venue and asset readiness evidence,
- risk budget and allocator review,
- limited-live canary plan,
- explicit human approval recorded in issue, PR, or operator record.

### Limited Live -> Broad Live

Required bundle:

- limited-live canary output,
- soak summary,
- observed-versus-modeled cost comparison,
- drift and incident review,
- explicit human approval for broader rollout.

## Approval boundaries

- Merging a PR never authorizes real-money promotion by itself.
- New strategy, venue, or asset code may enter `shadow` only after human review
  on the implementation PR.
- `paper` requires explicit operator approval even though it does not mutate
  wallets.
- `limited_live` requires explicit human approval, allowlist changes, kill
  controls, and a bounded canary plan.
- `broad_live` requires a successful limited-live soak and explicit human
  approval.
- Any production-facing state may be paused or killed automatically by policy,
  but resume requires human review.

## GitHub and harness workflow

Research-to-production work must stay on the existing harness path:

1. Open or refine a GitHub issue with explicit lifecycle state and evidence
   target.
2. Mark it `harness` and `agent-ready` only when dependencies are actually
   merged and the scope fits one PR.
3. Branch from `main` with `codex/issue-<number>-<slug>`.
4. Implement the narrowest slice needed for the target transition.
5. Attach a proof bundle with exact validations and the relevant research,
   replay, paper, or canary artifacts.
6. Stop at human review before merge.
7. Treat post-merge runtime activation and money-state promotion as separate
   operator actions with their own evidence requirements.

## Rollback posture

- `candidate` and `draft` rollback is issue-level:
  demote, archive, or supersede the candidate.
- `shadow` rollback is runtime-level:
  pause or demote without wallet mutation.
- `paper` rollback is runtime-level:
  pause or demote while preserving paper receipts and scorecards.
- `limited_live` rollback is policy-level and runtime-level:
  kill the deployment, remove from allowlists, pause venue or asset readiness,
  and revert code when needed.
- `broad_live` rollback starts by demoting to `limited_live`, then pausing or
  killing as needed.

## Success criteria for the program

- Strategy, venue, and asset states are explicit and queryable.
- Evidence bundles are attached to every promotion transition.
- New strategies, venues, and assets can reach bounded real-money validation
  without bypassing the Worker boundary or the harness workflow.
- Real-money promotion remains human-gated and reversible.
