CREATE TABLE IF NOT EXISTS execution_canary_state (
  state_key TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  wallet_id TEXT,
  wallet_address TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  last_direction TEXT,
  last_run_id TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execution_canary_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  direction TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  target_notional_usd TEXT NOT NULL,
  amount_atomic TEXT,
  slippage_bps INTEGER NOT NULL,
  quoted_out_atomic TEXT,
  min_expected_out_atomic TEXT,
  quote_price_impact_pct REAL,
  request_id TEXT,
  receipt_id TEXT,
  signature TEXT,
  receipt_status TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'not_attempted',
  wallet_id TEXT,
  wallet_address TEXT,
  disable_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT,
  quote_json TEXT,
  receipt_json TEXT,
  reconciliation_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_canary_runs_started_at
ON execution_canary_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_canary_runs_status_started
ON execution_canary_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_canary_runs_signature
ON execution_canary_runs(signature);
