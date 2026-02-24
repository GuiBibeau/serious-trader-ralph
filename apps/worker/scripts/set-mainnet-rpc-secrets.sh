#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Set RPC secrets for Loop runtime across Cloudflare environments.

Usage:
  HELIUS_MAINNET_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." \
    ./scripts/set-mainnet-rpc-secrets.sh

Optional:
  ./scripts/set-mainnet-rpc-secrets.sh --rpc-url "https://mainnet.helius-rpc.com/?api-key=..."

This sets:
  - RPC_ENDPOINT
  - BALANCE_RPC_ENDPOINT
for:
  - dev (default env)
  - staging
  - production
USAGE
}

RPC_URL="${HELIUS_MAINNET_RPC_URL:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc-url)
      RPC_URL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

RPC_URL="$(printf "%s" "$RPC_URL" | xargs)"
if [[ -z "$RPC_URL" ]]; then
  echo "Missing RPC URL. Set HELIUS_MAINNET_RPC_URL or pass --rpc-url." >&2
  exit 1
fi

if [[ "$RPC_URL" != https://mainnet.helius-rpc.com/* ]]; then
  echo "Expected a mainnet Helius URL (https://mainnet.helius-rpc.com/...)." >&2
  exit 1
fi

echo "Checking Cloudflare auth..."
npx wrangler whoami >/dev/null

put_secret() {
  local env_name="$1"
  local secret_name="$2"

  if [[ "$env_name" == "dev" ]]; then
    printf "%s" "$RPC_URL" | npx wrangler secret put "$secret_name"
  else
    printf "%s" "$RPC_URL" | npx wrangler secret put "$secret_name" --env "$env_name"
  fi
}

for env_name in dev staging production; do
  echo "Setting RPC secrets for $env_name..."
  put_secret "$env_name" "RPC_ENDPOINT"
  put_secret "$env_name" "BALANCE_RPC_ENDPOINT"
done

echo "Done. RPC secrets updated for dev/staging/production."
