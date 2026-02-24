#!/usr/bin/env bash
set -euo pipefail

HELIUS_MAINNET_RPC_URL="${HELIUS_MAINNET_RPC_URL:-}"
if [[ -z "$HELIUS_MAINNET_RPC_URL" ]]; then
  echo "Set HELIUS_MAINNET_RPC_URL to a mainnet Helius RPC URL." >&2
  exit 1
fi
if [[ "$HELIUS_MAINNET_RPC_URL" != https://mainnet.helius-rpc.com/* ]]; then
  echo "HELIUS_MAINNET_RPC_URL must be a mainnet Helius URL." >&2
  exit 1
fi

CHECKS="${1:-2}"
TICKS_PER_CHECK="${2:-5}"
SLEEP_SECONDS="${3:-60}"
TICK_TIMEOUT_SECONDS="${SOAK_TICK_TIMEOUT_SECONDS:-60}"
WARMUP_TICKS="${SOAK_WARMUP_TICKS:-1}"
WARMUP_TICK_TIMEOUT_SECONDS="${SOAK_WARMUP_TICK_TIMEOUT_SECONDS:-120}"
WARMUP_SLEEP_SECONDS="${SOAK_WARMUP_SLEEP_SECONDS:-15}"
POST_WARMUP_SLEEP_SECONDS="${SOAK_POST_WARMUP_SLEEP_SECONDS:-45}"
PORT_RANGE_START="${SOAK_PORT_RANGE_START:-9888}"
PORT_RANGE_END="${SOAK_PORT_RANGE_END:-9999}"

is_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
    return $?
  fi
  nc -z 127.0.0.1 "$port" >/dev/null 2>&1
}

pick_open_port() {
  local port
  for port in $(seq "$PORT_RANGE_START" "$PORT_RANGE_END"); do
    if ! is_port_in_use "$port"; then
      echo "$port"
      return 0
    fi
  done
  return 1
}

WORKDIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_TAG="$(date +%Y%m%d_%H%M%S)"
STATE_DIR="$WORKDIR/.wrangler/state-loopb-mainnet-${RUN_TAG}"
PORT="${SOAK_PORT:-$(pick_open_port || true)}"
if [[ -z "$PORT" ]]; then
  echo "Could not find an open local port in range ${PORT_RANGE_START}-${PORT_RANGE_END}." >&2
  exit 1
fi
BASE_URL="http://localhost:${PORT}"
LOG_FILE="/tmp/loopb_mainnet_soak_${RUN_TAG}.log"

cleanup() {
  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

find_kv_sqlite() {
  find "$STATE_DIR/v3/kv/miniflare-KVNamespaceObject" -name "*.sqlite" | head -n 1
}

find_kv_blob_dir() {
  echo "$(find "$STATE_DIR/v3/kv" -mindepth 1 -maxdepth 1 -type d ! -name 'miniflare-KVNamespaceObject' | head -n 1)/blobs"
}

get_json_key() {
  local sqlite_file="$1"
  local blob_dir="$2"
  local key="$3"
  local blob_id
  blob_id="$(sqlite3 "$sqlite_file" "SELECT blob_id FROM _mf_entries WHERE key='${key}' ORDER BY rowid DESC LIMIT 1;" || true)"
  if [[ -z "${blob_id:-}" || ! -f "$blob_dir/$blob_id" ]]; then
    return 1
  fi
  cat "$blob_dir/$blob_id"
}

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee -a "$LOG_FILE"
}

run_scheduled_tick() {
  local timeout="$1"
  curl -sS -m "$timeout" "$BASE_URL/__scheduled" >/dev/null
}

mkdir -p "$STATE_DIR"

cd "$WORKDIR"
printf 'y\n' | npx wrangler d1 migrations apply WAITLIST_DB --local --persist-to "$STATE_DIR" >/dev/null

npx wrangler dev \
  --local \
  --persist-to "$STATE_DIR" \
  --test-scheduled \
  --port "$PORT" \
  --var "RPC_ENDPOINT:${HELIUS_MAINNET_RPC_URL}" \
  --var "BALANCE_RPC_ENDPOINT:${HELIUS_MAINNET_RPC_URL}" \
  --var LOOP_A_SLOT_SOURCE_ENABLED:1 \
  --var LOOP_A_BLOCK_FETCH_ENABLED:1 \
  --var LOOP_A_BLOCK_FETCH_COMMITMENTS:confirmed \
  --var LOOP_A_BLOCK_FETCH_MAX_CONCURRENCY:8 \
  --var LOOP_A_BLOCK_FETCH_MAX_RETRIES:0 \
  --var LOOP_A_BLOCK_FETCH_BASE_BACKOFF_MS:50 \
  --var LOOP_A_BLOCK_FETCH_MAX_SLOTS_PER_TICK:120 \
  --var LOOP_A_BLOCK_FETCH_REQUEST_TIMEOUT_MS:20000 \
  --var LOOP_A_DECODER_ENABLED:1 \
  --var LOOP_A_STATE_STORE_ENABLED:1 \
  --var LOOP_A_BACKFILL_RESOLVER_ENABLED:1 \
  --var LOOP_A_BACKFILL_MAX_TOTAL_SLOTS_PER_TICK:96 \
  --var LOOP_A_MARK_ENGINE_ENABLED:1 \
  --var LOOP_A_COORDINATOR_ENABLED:1 \
  --var LOOP_B_MINUTE_ACCUMULATOR_ENABLED:1 \
  > /tmp/loopb_mainnet_worker.log 2>&1 &
WORKER_PID=$!

for _ in $(seq 1 30); do
  if curl -sS -m 2 "$BASE_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sS -m 2 "$BASE_URL/api/health" >/dev/null 2>&1; then
  echo "Worker failed to start. See /tmp/loopb_mainnet_worker.log" >&2
  exit 1
fi

log "starting_soak checks=$CHECKS ticks_per_check=$TICKS_PER_CHECK sleep_seconds=$SLEEP_SECONDS tick_timeout_seconds=$TICK_TIMEOUT_SECONDS warmup_ticks=$WARMUP_TICKS warmup_tick_timeout_seconds=$WARMUP_TICK_TIMEOUT_SECONDS post_warmup_sleep_seconds=$POST_WARMUP_SLEEP_SECONDS port=$PORT port_range=${PORT_RANGE_START}-${PORT_RANGE_END} state_dir=$STATE_DIR"

warmup_ok=0
warmup_fail=0
for warmup_tick in $(seq 1 "$WARMUP_TICKS"); do
  if run_scheduled_tick "$WARMUP_TICK_TIMEOUT_SECONDS"; then
    warmup_ok=$((warmup_ok + 1))
  else
    warmup_fail=$((warmup_fail + 1))
  fi
  if [[ "$warmup_tick" -lt "$WARMUP_TICKS" ]]; then
    sleep "$WARMUP_SLEEP_SECONDS"
  fi
done

log "warmup_done ticks_ok=$warmup_ok ticks_fail=$warmup_fail"
if [[ "$warmup_ok" -eq 0 ]]; then
  echo "Loop warmup failed before quality checks. See $LOG_FILE and /tmp/loopb_mainnet_worker.log" >&2
  exit 1
fi
if [[ "$POST_WARMUP_SLEEP_SECONDS" -gt 0 ]]; then
  sleep "$POST_WARMUP_SLEEP_SECONDS"
fi

for check in $(seq 1 "$CHECKS"); do
  tick_ok=0
  tick_fail=0
  for tick in $(seq 1 "$TICKS_PER_CHECK"); do
    if run_scheduled_tick "$TICK_TIMEOUT_SECONDS"; then
      tick_ok=$((tick_ok + 1))
    else
      tick_fail=$((tick_fail + 1))
    fi
    if [[ "$tick" -lt "$TICKS_PER_CHECK" ]]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  KV_SQL="$(find_kv_sqlite)"
  KV_BLOBS="$(find_kv_blob_dir)"

  scores_json=""
  top_json=""
  liq_json=""
  anom_json=""
  health_json=""
  marks_json=""

  if scores_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopB:v1:scores:latest" 2>/dev/null)"; then :; else scores_json=""; fi
  if top_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopB:v1:views:top_movers:latest" 2>/dev/null)"; then :; else top_json=""; fi
  if liq_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopB:v1:views:liquidity_stress:latest" 2>/dev/null)"; then :; else liq_json=""; fi
  if anom_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopB:v1:views:anomaly_feed:latest" 2>/dev/null)"; then :; else anom_json=""; fi
  if health_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopB:v1:health" 2>/dev/null)"; then :; else health_json=""; fi
  if marks_json="$(get_json_key "$KV_SQL" "$KV_BLOBS" "loopA:v1:marks:confirmed:latest" 2>/dev/null)"; then :; else marks_json=""; fi

  missing_confirmed="$(sqlite3 "$KV_SQL" "SELECT COUNT(*) FROM _mf_entries WHERE key LIKE 'loopA:v1:block_missing:pending:confirmed:%';")"
  backfill_confirmed="$(sqlite3 "$KV_SQL" "SELECT COUNT(*) FROM _mf_entries WHERE key LIKE 'loopA:v1:backfill:pending:confirmed:%';")"

  has_all_views=true
  [[ -n "$scores_json" && -n "$top_json" && -n "$liq_json" && -n "$anom_json" && -n "$health_json" ]] || has_all_views=false

  scores_count=0
  scores_sorted=false
  scores_explain=false
  top_freshness=999999999
  liq_freshness=999999999
  anom_freshness=999999999
  marks_count=0
  last_finalized="null"

  if [[ -n "$scores_json" ]]; then
    scores_count="$(jq -r '.count // 0' <<<"$scores_json")"
    scores_sorted="$(jq -r 'if (.rows|type)=="array" and (.rows|length)>1 then ([.rows[].finalScore] == ([.rows[].finalScore]|sort|reverse)) else true end' <<<"$scores_json")"
    scores_explain="$(jq -r 'if (.rows|type)=="array" then all(.rows[]; (.explain|type)=="array" and (.explain|length)>0) else false end' <<<"$scores_json")"
  fi
  if [[ -n "$top_json" ]]; then top_freshness="$(jq -r '.freshnessMs // 999999999' <<<"$top_json")"; fi
  if [[ -n "$liq_json" ]]; then liq_freshness="$(jq -r '.freshnessMs // 999999999' <<<"$liq_json")"; fi
  if [[ -n "$anom_json" ]]; then anom_freshness="$(jq -r '.freshnessMs // 999999999' <<<"$anom_json")"; fi
  if [[ -n "$marks_json" ]]; then marks_count="$(jq -r '.count // 0' <<<"$marks_json")"; fi
  if [[ -n "$health_json" ]]; then last_finalized="$(jq -r '.lastFinalizedMinute // "null"' <<<"$health_json")"; fi

  quality_ok=true
  [[ "$has_all_views" == "true" ]] || quality_ok=false
  [[ "$scores_count" -gt 0 ]] || quality_ok=false
  [[ "$scores_sorted" == "true" ]] || quality_ok=false
  [[ "$scores_explain" == "true" ]] || quality_ok=false
  [[ "$top_freshness" -le 180000 ]] || quality_ok=false
  [[ "$liq_freshness" -le 180000 ]] || quality_ok=false
  [[ "$anom_freshness" -le 180000 ]] || quality_ok=false
  [[ "$missing_confirmed" -le 256 ]] || quality_ok=false
  [[ "$backfill_confirmed" -le 256 ]] || quality_ok=false

  log "check=$check ticks_ok=$tick_ok ticks_fail=$tick_fail quality_ok=$quality_ok has_all_views=$has_all_views marks_count=$marks_count scores_count=$scores_count scores_sorted=$scores_sorted scores_explain=$scores_explain top_freshness_ms=$top_freshness liq_freshness_ms=$liq_freshness anom_freshness_ms=$anom_freshness last_finalized_minute=$last_finalized missing_confirmed=$missing_confirmed backfill_confirmed=$backfill_confirmed"

  if [[ "$quality_ok" != "true" ]]; then
    echo "Loop B quality gate failed at check $check. See $LOG_FILE and /tmp/loopb_mainnet_worker.log" >&2
    exit 1
  fi

  if [[ "$check" -lt "$CHECKS" ]]; then
    sleep "$SLEEP_SECONDS"
  fi
done

log "completed_soak log_file=$LOG_FILE"
echo "LOG_FILE=$LOG_FILE"
