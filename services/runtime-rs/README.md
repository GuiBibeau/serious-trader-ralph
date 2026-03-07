# runtime-rs

`runtime-rs` is the minimal Rust service skeleton for the autonomous runtime
program. In this phase it is intentionally internal-only and exposes health and
feed-metric endpoints plus config loading.

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
- `RUNTIME_DATABASE_URL`
  Optional runtime-owned relational store bootstrap secret for later phases.

## Health check

```bash
curl -fsS http://127.0.0.1:8081/health
curl -fsS http://127.0.0.1:8081/metrics
```

Expected output is a JSON document describing the service name, environment,
protocol version, bind address, strategy support, feed freshness contracts,
duplicate suppression counters, slot lag, and internal dependency stubs.

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
