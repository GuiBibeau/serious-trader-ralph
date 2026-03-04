# Terminal Cutover Plan v1

This document defines production cutover for the terminal UX and execution path.

## Objective

Move terminal UX and execution to production with:

- feature-flagged rollout by mode and user cohort
- explicit go/no-go gates before each promotion
- immediate rollback steps that preserve execution data integrity

## Rollout Controls

Terminal mode gates (Portal env):

- `NEXT_PUBLIC_TERMINAL_ALLOWED_MODES`
  - CSV of globally enabled modes from `regular,degen,custom`
  - default: all modes
- `NEXT_PUBLIC_TERMINAL_DEGEN_COHORT`
  - one of: `all`, `onboarded`, `experienced`, `degen_acknowledged`
  - default: `all`
- `NEXT_PUBLIC_TERMINAL_CUSTOM_COHORT`
  - one of: `all`, `onboarded`, `experienced`, `degen_acknowledged`
  - default: `all`

Execution actor-segment gates (Worker env):

- `EXEC_ROLLOUT_INTERNAL_ENABLED`
- `EXEC_ROLLOUT_TRUSTED_ENABLED`
- `EXEC_ROLLOUT_EXTERNAL_ENABLED`

## Cohort Signals

Cohort evaluation is based on `/api/me` response fields:

- `experience.onboardingCompleted`
- `experience.level`
- `user.degenAcknowledgedAt`

Mode fallback rule:

- If selected mode is not allowed for the user cohort, UI coerces to `regular`.

## Promotion Sequence

1. `codex/*` -> `dev`
2. `dev` -> `staging`
3. `staging` -> `main`

Do not skip lanes during normal rollout.

## Go/No-Go Gates

All gates must pass before lane promotion:

1. CI gates green:
   - `lint`
   - `typecheck`
   - `unit-tests`
   - `integration-tests`
   - `terminal-e2e-tests`
2. Deploy gates green:
   - `Deploy (dev|staging|production)`
   - `Deploy Portal (Vercel)`
3. Terminal execution checks:
   - submit -> status -> receipt loop healthy on lane API host
   - execution inspector shows ordered timeline + receipt outcome
   - no unexpected increase in `submission-failed` / `expired-blockhash`
4. UX gates:
   - mode gating behaves correctly for test cohorts
   - disallowed mode transitions are blocked and safely coerced

No-go triggers:

- execution failure spike above normal baseline for two consecutive windows
- receipt readiness regressions (`ready=false` after terminal state)
- rollout gate misconfiguration causing widespread `policy-denied`

## Rollback Playbook

If regression is detected:

1. Restrict terminal modes immediately:
   - set `NEXT_PUBLIC_TERMINAL_ALLOWED_MODES=regular`
2. Restrict risky cohorts:
   - set `NEXT_PUBLIC_TERMINAL_DEGEN_COHORT=degen_acknowledged`
   - set `NEXT_PUBLIC_TERMINAL_CUSTOM_COHORT=onboarded`
3. If execution instability persists, gate actor segments in order:
   - `EXEC_ROLLOUT_EXTERNAL_ENABLED=0`
   - `EXEC_ROLLOUT_TRUSTED_ENABLED=0` (if needed)
4. Re-run smoke checks on lane domains:
   - `/api/health`
   - `/api/x402/exec/health`
   - `/api/x402/exec/status/:requestId`
   - `/api/x402/exec/receipt/:requestId`

Rollback preserves data because execution requests/events/attempts/receipts are append-only and idempotent.

## Post-Launch Validation Checklist

Run after each promotion and 24h after production cutover:

1. Validate cohort gates with representative accounts:
   - onboarding incomplete
   - onboarded intermediate
   - advanced/degen acknowledged
2. Verify execution observability snapshots:
   - landed/finalized rates stable
   - no abnormal expiry trend
3. Spot-check canonical receipts and timeline rendering.
4. Confirm no new CORS/auth regressions on terminal execution routes.

