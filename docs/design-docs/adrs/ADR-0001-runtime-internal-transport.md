# ADR-0001: Runtime internal transport

## Status

Accepted on 2026-03-07

## Context

Runtime-rs needs a private coordination path with the Worker for deployment
control, health, and execution lifecycle data. The repo already has strong HTTP
tooling, Cloudflare route handling, fixture-driven contract tests, and harness
proof expectations.

The main choice for v1 is whether to start with HTTP+JSON or jump directly to
gRPC.

## Decision

Start with service-authenticated HTTP+JSON for all Worker-to-runtime and
runtime-to-Worker internal APIs.

## Rationale

- It fits the current Worker and Bun tooling immediately.
- It is easier to inspect in tests, CI logs, and proof artifacts.
- It keeps internal contracts legible for the harness and for code review.
- It avoids introducing transport complexity before runtime behavior is proven.

## Consequences

- Internal schemas must be versioned and shared in-repo.
- Service-auth enforcement is mandatory before the routes are used.
- If runtime traffic or operability later demands gRPC, that becomes a
  deliberate follow-up change rather than an assumption in v1.
