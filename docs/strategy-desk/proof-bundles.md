# Strategy Desk Proof Bundles

## Purpose

A strategy-desk proof bundle is the minimum auditable artifact set required to
justify moving a composite scenario from study through shadow, paper, and
bounded execution review.

The bundle is scenario-scoped. Do not mix outputs from different scenario ids,
commits, or request templates inside one bundle.

## Recommended bundle layout

Store desk proofs under:

```text
.tmp/strategy-desk-proof/<scenario-id>/
```

Recommended layout:

```text
.tmp/strategy-desk-proof/desk_sol_composite_1/
  01-scenario/
  02-study/
  03-shadow/
  04-paper/
  05-handoff/
  06-drills/
  07-browser-proof/
```

## Minimum artifacts by stage

| Stage | Required artifacts | Minimum pass condition |
| --- | --- | --- |
| Replay and backtest | scenario upsert output, study output, selected-variant summary, reproducibility refs | study matrix exists, selected variant exists, holdout coverage is explicit |
| Shadow | shadow run output, shadow report, leg receipts or failures, overlay status | no unexpected fail-open behavior, scenario remains non-monetary |
| Paper | paper run output, paper report, scorecard, portfolio summary, overlay status | paper evidence is stable enough for operator review |
| Arming review | prepare output, handoff detail, check list, binding list, approval record | all live-eligible bindings are explicit and human review is recorded |
| Applied bounded execution | apply output, handoff detail after apply, event timeline, execution recipes | scenario is `execution_bound`, handoff is `applied`, rollback path is documented |
| Drill evidence | pause or kill output, demote output, drill notes, browser proof summary | rollback is reversible and evidence reconstruction is possible |

## Exact command matrix

The request templates under
`docs/strategy-desk/request-templates/desk-sol-composite/` are the canonical
command inputs for the sample composite desk scenario.

Set:

```bash
export DESK_BASE_URL="${DESK_BASE_URL:-http://127.0.0.1:8888}"
export ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN first}"
```

### 1. Scenario manifest

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action upsert \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/scenario.upsert.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/01-scenario
```

### 2. Study evidence

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action study \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/study.backtest.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/02-study
```

### 3. Shadow and paper evidence

```bash
bun run strategy-desk:registry \
  --resource scenario \
  --action execute \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/execute.shadow.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/03-shadow

bun run strategy-desk:registry \
  --resource scenario \
  --action execute \
  --base-url "${DESK_BASE_URL}" \
  --admin-token "${ADMIN_TOKEN}" \
  --request-file docs/strategy-desk/request-templates/desk-sol-composite/execute.paper.request.json \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/04-paper
```

### 4. Handoff and bounded execution evidence

Prepare:

```bash
mkdir -p \
  .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff \
  .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills \
  .tmp/strategy-desk-proof/desk_sol_composite_1/07-browser-proof

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.prepare.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/01-prepare.json

export HANDOFF_ID="$(jq -r '.handoff.handoffId' .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/01-prepare.json)"
test -n "${HANDOFF_ID}" && test "${HANDOFF_ID}" != "null"
```

Approve and apply:

```bash
rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/02-submit.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.submit.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/02-submit.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/02-submit.json

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/03-approve.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.approve.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/03-approve.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/03-approve.json

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/04-apply.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.apply.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/04-apply.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/04-apply.json

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/05-detail.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/05-detail.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/05-handoff/05-detail.json
```

### 5. Browser proof

```bash
bun run harness:proof \
  --output-dir .tmp/strategy-desk-proof/desk_sol_composite_1/07-browser-proof
```

Required desk screenshot:

- `strategy-desk-bounded-execution.png`

## Review checklist

Before calling the bundle complete, confirm all of the following:

- scenario id is consistent across every artifact
- study, shadow, paper, and handoff outputs are all present
- the handoff detail shows the final status you intend to claim
- the event timeline includes the transitions you executed
- recipe or binding materialization is explicit for every non-live leg
- browser-proof summary exists if the operator surface changed
- canary or rollback drill outputs are attached for bounded execution claims
