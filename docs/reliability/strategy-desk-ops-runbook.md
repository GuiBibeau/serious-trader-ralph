# Strategy Desk Ops Runbook

## Purpose

This runbook defines how operators should author, test, arm, pause, kill, and
demote harness-native strategy-desk scenarios without pretending they are
first-class runtime deployments.

Use this alongside the existing strategy-lab and autonomous-runtime runbooks:

- strategy and venue promotion policy still lives in
  `docs/reliability/strategy-lab-ops-runbook.md`
- bounded runtime deployment controls still live in
  `docs/reliability/autonomous-runtime-ops-runbook.md`

## Operating model

- A strategy-desk scenario is a composite harness object, not a runtime
  deployment.
- Scenario state, scenario-run state, and promotion-handoff state are all
  separate and must stay auditable.
- Replay and backtest evidence determine whether a composite scenario should
  enter shadow or paper.
- Shadow and paper runs are still non-monetary.
- Limited-live arming only happens through a promotion handoff.
- A handoff may materialize one or more bounded objects:
  - a runtime deployment when a leg fits the existing runtime model
  - a Worker execution recipe when a leg must remain harness-owned
  - a subject control when a leg must stay paper-bound or disabled
- Human review remains mandatory before any limited-live arming.

## Desk states and required operator posture

| Stage | Scenario state | Required evidence | Immediate rollback path |
| --- | --- | --- | --- |
| Replay and backtest | `replay_ready` | scenario manifest, study matrix, reproducibility refs, selected-variant summary | keep in `draft` or return to `replay_ready` |
| Shadow | `shadow_ready` | latest replay or backtest report, shadow run, leg receipts, failure overlay review | pause scenario or demote to `replay_ready` |
| Paper | `paper_ready` | shadow evidence, paper run, scorecard, risk overlays, browser proof if UI changed | pause scenario or demote to `shadow_ready` |
| Review | `operator_review` or `execution_ready` | green paper bundle, explicit leg bindings, human approval note, drill references | reject handoff, archive handoff, keep scenario paper-bound |
| Bounded execution | `execution_bound` | applied handoff, bound deployment or recipes, canary note, rollback drill | pause, kill, or demote the handoff and scenario |

## Required controls before bounded execution arming

- scenario latest report is `paper` or `shadow` evidence suitable for operator
  review
- handoff status is `approved` before `apply`
- every live-eligible binding is explicit about venue, target mode, and lane
- all non-live legs are explicitly left as paper-bound recipes or controls
- rollback path is chosen before applying the handoff

## Routine operator actions

Set a local base URL before running the command matrix:

```bash
export DESK_BASE_URL="${DESK_BASE_URL:-http://127.0.0.1:8888}"
export ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN first}"
```

### Upsert or review a scenario

Use the checked-in manifest template:

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action upsert \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/scenario.upsert.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/01-scenario
```

Expected effect:

- the scenario manifest is persisted through the Worker admin surface
- the scenario remains auditable as a desk object instead of a runtime
  deployment

### Run replay or backtest study

Use the study request template:

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action study \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/study.backtest.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/02-study
```

Expected effect:

- a study matrix is attached to the scenario
- selected-variant and holdout summaries are persisted as first-class evidence

### Run a shadow validation

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action execute \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/execute.shadow.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/03-shadow
```

Expected effect:

- a composite shadow run is persisted
- leg receipts and overlays become reviewable without mutating live capital

### Run a paper validation

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action execute \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/execute.paper.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/04-paper
```

Expected effect:

- the desk paper run becomes the canonical pre-arming evidence
- portfolio summary, scorecard, and leg outcomes are pinned to one report

### Prepare a bounded execution handoff

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.prepare.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/01-prepare.json
```

Expected effect:

- a draft handoff is created from the latest scenario report
- proposed bindings, checks, and actions are materialized for review

### Submit, approve, and apply a handoff

Set the handoff id from the prepare response:

```bash
export HANDOFF_ID="${HANDOFF_ID:?set HANDOFF_ID from prepare output}"
```

Submit:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.submit.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/02-submit.json
```

Approve:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.approve.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/03-approve.json
```

Apply:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.apply.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/04-apply.json
```

Read back the handoff detail and materialized recipes:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/05-detail.json
```

Expected effect:

- scenario state moves into bounded execution only after explicit approval
- runtime deployments, execution recipes, and paper-only controls remain
  inspectable as one composite handoff

### Pause, kill, or demote a handoff

Pause:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.pause.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/pause.json
```

Kill:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.kill.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/kill.json
```

Demote:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.demote.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/demote.json
```

## Rollback order of operations

1. Pause or kill the active handoff.
2. Confirm the detail route shows the scenario as no longer execution-bound.
3. Demote the handoff so the scenario returns to a paper-safe state.
4. Preserve the handoff detail, event log, and recipe list in the proof bundle.
5. If the incident is venue-specific, tighten the corresponding strategy-lab
   readiness or subject control before resuming desk activity.

## Required drills

- one canary arm drill from `prepare` through `apply`
- one rollback drill from `applied` through `pause` or `kill`, then `demote`
- one venue-disable or paper-only leg isolation drill for a non-live binding
- one proof reconstruction drill from stored scenario, run, report, handoff,
  and browser-proof artifacts

See:

- `docs/strategy-desk/drills/desk-sol-composite.canary-drill.md`
- `docs/strategy-desk/drills/desk-sol-composite.rollback-drill.md`
- `docs/strategy-desk/proof-bundles.md`
