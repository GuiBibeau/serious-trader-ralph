#!/usr/bin/env bash
# Keep the Harness portal Vite server awake overnight and print uPNL log hints.
# Prefer the LaunchAgent (survives logout of Terminal):
#
#   cp scripts/com.harness.portal-dev.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.harness.portal-dev.plist
#
# Or run this script from Terminal.app / iTerm (outside Cursor):
#
#   ./scripts/overnight-paper.sh
#   ./scripts/overnight-paper.sh 3001
#
# Requires: leave http://127.0.0.1:PORT/terminal open in PAPER mode
# (the browser posts uPNL every 30m to .logs/paper-upnl.jsonl).
#
# Stop LaunchAgent:
#   launchctl bootout gui/$(id -u)/com.harness.portal-dev

set -euo pipefail

PORT="${1:-3001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.logs"
PID_FILE="$LOG_DIR/overnight-paper.pid"
VITE_LOG="$LOG_DIR/portal-vite-${PORT}.log"
UPNL_LOG="$LOG_DIR/paper-upnl.jsonl"
export PATH="${HOME}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

mkdir -p "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "Already running (pid $old). Log: $VITE_LOG"
    echo "uPNL samples: $UPNL_LOG"
    echo "Tail:  tail -f \"$UPNL_LOG\""
    exit 0
  fi
fi

echo "Starting overnight keeper on http://127.0.0.1:${PORT}/terminal"
echo "  Vite log:  $VITE_LOG"
echo "  uPNL log:  $UPNL_LOG"
echo "  Leave the terminal tab open in PAPER mode."
echo "  Ctrl+C stops this keeper."
echo

# Prevent idle sleep while this session runs; restart Vite if it exits.
cd "$ROOT"
# -i idle sleep, -d display sleep, -m disk sleep, -s system sleep
caffeinate -dims "$ROOT/scripts/keep-portal-dev.sh" "$PORT" &
keeper_pid=$!
echo "$keeper_pid" >"$PID_FILE"
trap 'kill "$keeper_pid" 2>/dev/null || true; rm -f "$PID_FILE"' EXIT INT TERM
wait "$keeper_pid"
