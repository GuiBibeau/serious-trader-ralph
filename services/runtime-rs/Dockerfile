FROM rust:1.86-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY services/runtime-rs ./services/runtime-rs

RUN cargo build --release -p runtime-rs

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 runtime

WORKDIR /app

COPY --from=builder /app/target/release/runtime-rs /usr/local/bin/runtime-rs

USER runtime

EXPOSE 8080

ENTRYPOINT ["runtime-rs"]
