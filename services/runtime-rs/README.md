# runtime-rs

`runtime-rs` is the internal Rust hot path for the autonomous runtime program.
In this phase it remains shadow-only and exposes:

- public health and metrics endpoints,
- authenticated internal deployment and run-inspection routes,
- a runtime-owned SQLite strategy registry,
- deterministic shadow trigger evaluation backed by the feature cache.

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
  Default: `.tmp/runtime-rs/strategy-registry.sqlite3`

## Health check

```bash
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:8081/metrics
```

Expected output is a JSON document describing the service name, environment,
protocol version, bind address, strategy support, feed freshness contracts,
slot lag, feature freshness windows, derived signal snapshots, and strategy
registry status.

## Internal routes

All internal routes require:

```bash
export RUNTIME_INTERNAL_SERVICE_TOKEN=...
```

Route surface:

- `GET /api/internal/runtime/health`
- `POST /api/internal/runtime/deployments`
- `GET /api/internal/runtime/deployments/:deploymentId`
- `POST /api/internal/runtime/deployments/:deploymentId/pause`
- `POST /api/internal/runtime/deployments/:deploymentId/resume`
- `POST /api/internal/runtime/deployments/:deploymentId/kill`
- `POST /api/internal/runtime/deployments/:deploymentId/evaluate`
- `GET /api/internal/runtime/runs/:deploymentId`

Example shadow evaluation flow:

```bash
curl -fsS http://127.0.0.1:8081/api/internal/runtime/deployments \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}" \
  -H "content-type: application/json" \
  --data @docs/runtime-contracts/fixtures/runtime.deployment.valid.v1.json

curl -fsS http://127.0.0.1:8081/api/internal/runtime/deployments/dep_runtime_sol_usdc_shadow/evaluate \
  -X POST \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}" \
  -H "content-type: application/json" \
  --data '{}'

curl -fsS http://127.0.0.1:8081/api/internal/runtime/runs/dep_runtime_sol_usdc_shadow \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"
```

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
