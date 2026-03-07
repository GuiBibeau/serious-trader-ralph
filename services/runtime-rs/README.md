# runtime-rs

`runtime-rs` is the minimal Rust service skeleton for the autonomous runtime
program. In this phase it is intentionally internal-only and exposes just a
health endpoint plus config loading.

## Local commands

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p runtime-rs
```

## Environment variables

- `RUNTIME_RS_BIND_ADDR`
  Default: `127.0.0.1:8081`
- `RUNTIME_RS_ENV`
  Allowed: `local`, `preview`, `production`
  Default: `local`
- `RUNTIME_RS_LOG`
  Default: `info`

## Health check

```bash
curl -fsS http://127.0.0.1:8081/health
```

Expected output is a JSON document describing the service name, environment,
protocol version, bind address, strategy support, and internal dependency
stubs.
