CREATE TABLE IF NOT EXISTS strategy_lab_subject_controls (
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  live_allowed INTEGER NOT NULL DEFAULT 1,
  kill_switch_enabled INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  PRIMARY KEY (subject_kind, subject_key)
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_subject_controls_updated
ON strategy_lab_subject_controls(updated_at DESC, subject_kind, subject_key);

CREATE TABLE IF NOT EXISTS strategy_lab_readiness_artifacts (
  readiness_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  target_state TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  venue_key TEXT,
  asset_key TEXT,
  canary_run_id TEXT,
  checks_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  controls_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_readiness_subject
ON strategy_lab_readiness_artifacts(subject_kind, subject_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_readiness_status
ON strategy_lab_readiness_artifacts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_lab_readiness_canary_state (
  canary_key TEXT PRIMARY KEY,
  wallet_id TEXT,
  wallet_address TEXT,
  last_run_id TEXT,
  last_run_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO strategy_lab_readiness_canary_state (
  canary_key,
  wallet_id,
  wallet_address,
  last_run_id,
  last_run_at,
  updated_at
) VALUES (
  'strategy_lab',
  NULL,
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_lab_readiness_canary_runs (
  run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  venue_key TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  pair_symbol TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  target_notional_usd TEXT NOT NULL,
  wallet_id TEXT,
  wallet_address TEXT,
  receipt_id TEXT,
  signature TEXT,
  error_code TEXT,
  error_message TEXT,
  reconciliation_json TEXT,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_readiness_canary_subject
ON strategy_lab_readiness_canary_runs(subject_kind, subject_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_readiness_canary_status
ON strategy_lab_readiness_canary_runs(status, started_at DESC);
