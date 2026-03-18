# Desk SOL Composite Canary Drill

## Goal

Prove that a paper-ready composite scenario can move through bounded execution
review without skipping human approval and while preserving a single auditable
handoff trail.

## Preconditions

- local or remote Worker admin surface is healthy
- the desk scenario is already persisted from
  `docs/strategy-desk/request-templates/desk-sol-composite/scenario.upsert.json`
- the paper report exists for `desk_sol_composite_1`
- `ADMIN_TOKEN` is set

Set:

```bash
export DESK_BASE_URL="${DESK_BASE_URL:-http://127.0.0.1:8888}"
export ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN first}"
```

## Drill steps

### 1. Prepare the handoff

```bash
mkdir -p .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.prepare.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.prepare.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.prepare.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.prepare.json
```

Extract the created handoff id:

```bash
export HANDOFF_ID="$(jq -r '.handoff.handoffId' .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.prepare.json)"
test -n "${HANDOFF_ID}" && test "${HANDOFF_ID}" != "null"
```

Expected:

- handoff status is `draft`
- at least one binding is present

### 2. Submit and approve

```bash
rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.submit.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.submit.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.submit.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.submit.json

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.approve.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.approve.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.approve.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.approve.json
```

Expected:

- handoff status reaches `approved`
- human approval is visible in the handoff payload

### 3. Apply and inspect

```bash
rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.apply.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.apply.request.json \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.apply.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.apply.json

rm -f .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.detail.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  --remove-on-error \
  --output .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.detail.json

cat .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/canary.detail.json
```

Expected:

- scenario state is `execution_bound`
- handoff status is `applied`
- event list includes `prepared`, `submitted`, `approved`, and `applied`
- execution recipes or controls are materialized for non-live legs

## Pass criteria

- every transition response is `ok=true`
- no transition bypasses `approved`
- final detail output contains the full event trail
- the canary outputs are saved in the proof bundle directory
