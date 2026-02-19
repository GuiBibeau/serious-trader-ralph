CREATE TABLE IF NOT EXISTS strategy_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  strategy_hash TEXT NOT NULL,
  strategy_type TEXT NOT NULL,
  lookback_days INTEGER NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics_json TEXT,
  thresholds_json TEXT,
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS strategy_validations_tenant_created_idx
ON strategy_validations (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS strategy_validations_tenant_hash_created_idx
ON strategy_validations (tenant_id, strategy_hash, created_at);
