# runtime-rs

`runtime-rs` is the internal Rust hot path for the autonomous runtime program.
In this phase it remains shadow-only and exposes:

- public health and metrics endpoints,
- authenticated internal deployment and run-inspection routes,
- a runtime-owned SQLite strategy registry,
- persisted machine-readable risk verdicts and deployment-safe pause behavior,
- deterministic shadow trigger evaluation backed by the feature cache.

Pack 1 managed strategy semantics are now wired through the runtime contract:

- `dca`: fixed-notional base accumulation using the deployment reserve budget
- `threshold_rebalance`: drift-aware buy/sell actions toward a 50/50 sleeve split
- `twap`: per-run slices derived from `maxConcurrentRuns`, with buy or sell
  direction chosen from current base exposure

Pack 2 signal-driven managed strategy semantics extend the same runtime path:

- `trend_following`: follows the short-window return direction from the feature
  cache
- `mean_reversion`: fades the short-window return direction from the feature
  cache

Pack 3 advanced managed templates stay on the same deterministic runtime path:

- `breakout`: requires short-window momentum plus long-window confirmation
  before it opens or exits risk
- `macro_rotation`: rotates exposure from the long-window regime and avoids
  mixed-regime churn
- `volatility_target`: scales target base exposure from realized volatility and
  rebalances toward that budget

Promotion for signal-driven templates is intentionally stricter:

- replay evidence must show expected behavior across both positive and negative
  return windows
- scorecards must keep stale-feature rejects at zero before promotion
- fresh feature inputs are required for every shadow and paper evidence run

Promotion for advanced templates is stricter again:

- shadow promotion requires an extended five-run evidence window
- paper promotion requires an extended seven-run evidence window
- stale-feature rejects must still remain at zero across the promotion window
- replay evidence must cover the exact template behavior that would reach the
  bounded live bridge

Allocator coordination now sits in front of risk and planning for any sleeve
with multiple runtime deployments:

- each evaluation records an auditable allocator decision for the deployment
  and its peers in the same sleeve
- allocator grants clamp requested allocated and reserved capital to the
  current sleeve equity before risk and planning run
- allocator priority is deterministic by mode, lane, strategy key, and
  deployment id, with an operator escape hatch through the deployment tag
  `allocator:priority=<integer>`
- allocator scorecards surface constrained and zero-grant runs so live
  promotion fails closed when capital contention appears in paper mode

The bounded live bridge remains intentionally narrow in v1:

- live runtime execution is allowlisted with
  `RUNTIME_MANAGED_LIVE_DEPLOYMENT_IDS`
- only `lane=safe` plans are eligible
- only single-slice live plans are accepted
- `runtime.shadowOnly` must be disabled explicitly through Worker ops controls
- paper mode uses a deterministic runtime-owned simulator that emits canonical
  submit attempts, receipts, observed ledgers, and reconciliation artifacts
- shadow mode still coordinates synthetically through the Worker bridge

Strategy selection is no longer hardcoded as a raw `strategy_key` allowlist:

- `crates/strategy-core` owns the built-in `RuntimeStrategySpec` catalog
- `crates/strategy-registry` validates deployments against that catalog
- `crates/execution-planner` loads repo-owned strategy plugins from the same
  contract surface
- new strategies can be added by registering a new StrategySpec and planner
  plugin without widening the public Worker API

## Local commands

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p runtime-rs
bun run runtime:fly:deploy
bun run runtime:fly:smoke
```

## Environment variables

- `RUNTIME_RS_BIND_ADDR`
  Default: `127.0.0.1:8081`
- `RUNTIME_RS_ENV`
  Allowed: `local`, `preview`, `production`
  Default: `local`
- `RUNTIME_RS_LOG`
  Default: `info`
- `RUNTIME_WORKER_API_BASE`
  Default: `http://127.0.0.1:8888`
- `RUNTIME_INTERNAL_SERVICE_TOKEN`
  Shared bearer token used for private runtime-to-Worker requests.
- `RUNTIME_FEED_PROVIDER`
  Default: `fixture`
- `RUNTIME_FEED_WS_URL`
  Default: `wss://price-feed.example/runtime`
- `RUNTIME_FEED_HTTP_URL`
  Default: `https://rpc.example/runtime`
- `RUNTIME_FEED_MARKET_STALE_AFTER_MS`
  Default: `30000`
- `RUNTIME_FEED_SLOT_STALE_AFTER_MS`
  Default: `15000`
- `RUNTIME_FEED_MAX_SLOT_GAP`
  Default: `2`
- `RUNTIME_FEED_REPLAY_FIXTURE_PATH`
  Optional local replay fixture. The checked-in deterministic fixture is
  `services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json`.
- `RUNTIME_FEATURE_STALE_AFTER_MS`
  Default: `20000`
- `RUNTIME_FEATURE_SHORT_WINDOW_MS`
  Default: `10000`
- `RUNTIME_FEATURE_LONG_WINDOW_MS`
  Default: `25000`
- `RUNTIME_FEATURE_VOLATILITY_WINDOW_SIZE`
  Default: `4`
- `RUNTIME_FEATURE_MAX_SAMPLES_PER_STREAM`
  Default: `64`
- `RUNTIME_DATABASE_URL`
  SQLite database path or `sqlite://` URL for the runtime-owned registry.
  Default: `/tmp/runtime-rs/runtime-state.sqlite3`
  If the configured path is not writable, individual runtime components fall
  back to their own `/tmp/runtime-rs/*.sqlite3` state files.

## Health check

```bash
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:8081/metrics
```

Expected output is a JSON document describing the service name, environment,
protocol version, bind address, strategy support, feed freshness contracts,
slot lag, feature freshness windows, derived signal snapshots, strategy
registry status, ledger health, and risk-engine health.

## Internal routes

All internal routes require:

```bash
export RUNTIME_INTERNAL_SERVICE_TOKEN=...
```

Route surface:

- `GET /api/internal/runtime/health`
- `POST /api/internal/runtime/deployments`
- `GET /api/internal/runtime/deployments`
- `GET /api/internal/runtime/deployments/:deploymentId`
- `POST /api/internal/runtime/deployments/:deploymentId/pause`
- `POST /api/internal/runtime/deployments/:deploymentId/resume`
- `POST /api/internal/runtime/deployments/:deploymentId/kill`
- `POST /api/internal/runtime/deployments/:deploymentId/evaluate`
- `GET /api/internal/runtime/runs/:deploymentId`
- `GET /api/internal/runtime/risk?deploymentId=:deploymentId`
- `GET /api/internal/runtime/positions?deploymentId=:deploymentId`
- `GET /api/internal/runtime/pnl?deploymentId=:deploymentId`
- `GET /api/internal/runtime/scorecards?deploymentId=:deploymentId`
- `GET /api/internal/runtime/leaderboards`
- `GET /api/internal/runtime/allocator?deploymentId=:deploymentId`

Scorecards now include the latest linked backtest evidence, significance and
regime-stability metrics, reproducibility verification state, and optional
research-backed promotion gate checks. The leaderboard route ranks candidate
strategies from the same research scorecard signals plus deployment readiness
when a candidate already has a runtime deployment.

Research and evaluation routes now preserve the evidence chain needed for paper
and limited-live promotion:

- `GET /api/internal/runtime/research`
- `POST /api/internal/runtime/research/hypotheses`
- `POST /api/internal/runtime/research/sources`
- `POST /api/internal/runtime/research/experiments`
- `POST /api/internal/runtime/research/evidence-bundles`
- `POST /api/internal/runtime/research/reproducibility-bundles`
- `POST /api/internal/runtime/research/reproducibility-bundles/rerun`
- `GET /api/internal/runtime/backtests`
- `POST /api/internal/runtime/backtests`

Every successful `POST /api/internal/runtime/backtests` run now persists a
linked reproducibility bundle with the exact code revision, dataset snapshots,
backtest configuration, and expected result used to build the report. Reruns
verify the bundle under bounded tolerance and write the latest verification
result back into the research registry.

Promotion evidence is stricter now:

- `paper` and live-target evidence still require a `backtest-report` artifact
- the same evidence bundle must also include a matching
  `reproducibility-bundle` artifact
- the bundle must match the experiment id, strategy key, and backtest report id
  carried by the promotion record

Example shadow evaluation flow:

```bash
curl -fsS http://127.0.0.1:8081/api/internal/runtime/deployments \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/runtime-contracts/fixtures/runtime.deployment.valid.v1.json

curl -fsS http://127.0.0.1:8081/api/internal/runtime/deployments \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"

curl -fsS http://127.0.0.1:8081/api/internal/runtime/deployments/dep_runtime_sol_usdc_shadow/evaluate \
  -X POST \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}" \
  -H "content-type: application/json" \
  --data '{}'

curl -fsS http://127.0.0.1:8081/api/internal/runtime/runs/dep_runtime_sol_usdc_shadow \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"

curl -fsS "http://127.0.0.1:8081/api/internal/runtime/risk?deploymentId=dep_runtime_sol_usdc_shadow" \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"
```

## Worker-admin ops surface

Operators should use the Worker as the public control plane:

- `GET /api/admin/ops/runtime`
- `POST /api/admin/ops/runtime/research/briefs`
- `POST /api/admin/ops/runtime/research/synthesis`
- `POST /api/admin/ops/runtime/research/triage`
- `POST /api/admin/ops/runtime/research/policy-gate`
- `POST /api/admin/ops/runtime/deployments/:deploymentId/pause`
- `POST /api/admin/ops/runtime/deployments/:deploymentId/resume`
- `POST /api/admin/ops/runtime/deployments/:deploymentId/kill`
- `POST /api/admin/ops/controls` with `runtime.shadowOnly=true` to keep the
  runtime shadow-only until live rollout is explicitly enabled in a later issue

Research briefs stay on the Worker-admin surface so source acquisition remains
approved-host-only and public APIs stay unchanged. The same brief flow can run
locally or in CI:

```bash
bun run strategy-lab:research --profile latest_strategy_papers
```

That command writes `.tmp/strategy-lab-research/brief.json` and
`.tmp/strategy-lab-research/brief.md`, and the scheduled GitHub Actions
workflow uploads the same artifacts every 12 hours.

Candidate synthesis uses the same pattern, but stays manual rather than
scheduled so weak ideas do not automatically turn into candidate issues:

```bash
bun run strategy-lab:synthesize --brief-file .tmp/strategy-lab-research/brief.json
```

That command writes `.tmp/strategy-lab-synthesis/synthesis.json` and
`.tmp/strategy-lab-synthesis/synthesis.md`, including a draft hypothesis,
StrategySpec scaffold, evaluation plan, and candidate-issue body.

Candidate triage stays on the same internal-only pattern:

```bash
bun run strategy-lab:triage --synthesis-file .tmp/strategy-lab-synthesis/synthesis.json
```

That command writes `.tmp/strategy-lab-triage/triage.json` and
`.tmp/strategy-lab-triage/triage.md`, including novelty scoring, duplicate
matches, explainable rationale, and an optional archival recommendation.

Policy gating keeps candidate progression explicit and fail-closed:

```bash
bun run strategy-lab:policy-gate \
  --synthesis-file .tmp/strategy-lab-synthesis/synthesis.json \
  --triage-file .tmp/strategy-lab-triage/triage.json
```

That command writes `.tmp/strategy-lab-policy-gate/policy-gate.json` and
`.tmp/strategy-lab-policy-gate/policy-gate.md`, including machine-readable
shadow, paper, limited-live, and broad-live gates, unsafe-pattern detection,
and explicit human-approval requirements before paper or real-money promotion.

The runtime operator surface now includes allocator details for a deployment:

- current grant allocated and reserved USD,
- priority rank and priority score,
- constrained versus full-grant status,
- peer grants inside the same sleeve,
- sleeve equity and aggregate grant totals.

Operators should treat repeated constrained or zero-grant paper runs as a
promotion blocker until capital budgets or priorities are corrected.

The default runtime control baseline is:

- `runtime.enabled=true`
- `runtime.shadowOnly=true`
- `runtime.shadowOnlyReason=live-rollout-pending`

To enable the managed live bridge for a specific deployment in v1, operators
must set all of the following:

- `runtime.shadowOnly=false` through `POST /api/admin/ops/controls`
- the deployment id in `RUNTIME_MANAGED_LIVE_DEPLOYMENT_IDS`
- `lane=safe` on the runtime deployment record
- a strategy that produces exactly one live slice per evaluation

## Fly foundation

- Config: `fly.runtime-rs.toml`
- Docker image: `services/runtime-rs/Dockerfile`
- Default app: `ralph-runtime-rs`
- Default regions:
  - active: `ord`
  - warm standby: `iad`
- GitHub workflows:
  - `.github/workflows/deploy-runtime-rs.yml`
  - `.github/workflows/rollback-runtime-rs.yml`
