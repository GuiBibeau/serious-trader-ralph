# Desk SOL Composite Rollback Drill

## Goal

Prove that an applied bounded-execution handoff can be paused or killed and
then demoted back to a paper-safe scenario without losing the audit trail.

## Preconditions

- the canary drill has already produced an applied handoff
- `HANDOFF_ID` points at an applied desk handoff
- `ADMIN_TOKEN` is set

Set:

```bash
export DESK_BASE_URL="${DESK_BASE_URL:-http://127.0.0.1:8888}"
export ADMIN_TOKEN="${ADMIN_TOKEN:?set ADMIN_TOKEN first}"
export HANDOFF_ID="${HANDOFF_ID:?set HANDOFF_ID first}"
```

## Drill steps

### 1. Pause the active handoff

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.pause.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/rollback.pause.json
```

Expected:

- scenario state is `paused`
- handoff status remains `applied` until an explicit demotion archives it
- the event trail records a `paused` transition

### 2. Optional venue-disable style kill

Use this if the triggering condition is a venue failure or a non-live binding
misbehaving:

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.kill.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/rollback.kill.json
```

Expected:

- active execution is fail-closed immediately
- the event trail records a `killed` transition

### 3. Demote back to paper

```bash
curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}/transition" \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/strategy-desk/request-templates/desk-sol-composite/handoff.transition.demote.request.json \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/rollback.demote.json

curl -fsS \
  "${DESK_BASE_URL}/api/admin/ops/runtime/strategy-desk/handoffs/${HANDOFF_ID}" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  | tee .tmp/strategy-desk-proof/desk_sol_composite_1/06-drills/rollback.detail.json
```

Expected:

- scenario state is `paper_ready`
- handoff status is `archived`
- event list includes `paused` or `killed`, then `demoted`
- no leg remains silently armed after demotion

## Pass criteria

- the desk can return to a paper-safe state without deleting the handoff
- the final detail output still contains the full event history
- rollback outputs are captured in the proof bundle directory
