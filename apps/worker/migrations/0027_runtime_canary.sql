CREATE TABLE IF NOT EXISTS runtime_canary_state (
  state_key TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  deployment_id TEXT,
  wallet_id TEXT,
  wallet_address TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  last_run_id TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runtime_canary_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  target_notional_usd TEXT NOT NULL,
  runtime_run_id TEXT,
  runtime_deployment_state TEXT,
  submit_request_id TEXT,
  runtime_receipt_id TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'not_attempted',
  wallet_id TEXT,
  wallet_address TEXT,
  disable_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT,
  coordination_json TEXT,
  receipt_json TEXT,
  reconciliation_json TEXT,
  observed_ledger_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runtime_canary_runs_started_at
ON runtime_canary_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_canary_runs_status_started
ON runtime_canary_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_canary_runs_submit_request
ON runtime_canary_runs(submit_request_id);
