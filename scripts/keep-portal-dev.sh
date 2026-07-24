#!/usr/bin/env bash
# Run the Harness portal Vite server and restart it if it exits.
# Use this from Terminal.app / iTerm (outside Cursor) so the process
# is not torn down when agent shells end.
#
#   ./scripts/keep-portal-dev.sh
#   ./scripts/keep-portal-dev.sh 3001

set -euo pipefail

PORT="${1:-3001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORTAL="$ROOT/apps/portal"
LOG_DIR="$ROOT/.logs"
LOG="$LOG_DIR/portal-vite-${PORT}.log"
export PATH="${HOME}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

mkdir -p "$LOG_DIR"
cd "$PORTAL"

echo "Harness portal dev server on http://127.0.0.1:${PORT}/terminal"
echo "Log: ${LOG}"
echo "Ctrl+C stops the keeper (and the current Vite child)."
echo

while true; do
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting vite :${PORT}" | tee -a "$LOG"
  bunx vite --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1 || true
  code=$?
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] vite exited code=${code}; restarting in 2s" | tee -a "$LOG"
  sleep 2
done
