CREATE TABLE IF NOT EXISTS strategy_runtime_state (
  tenant_id TEXT PRIMARY KEY,
  lifecycle_state TEXT NOT NULL DEFAULT 'candidate',
  active_strategy_hash TEXT,
  last_validation_id INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_tuned_at TEXT,
  next_revalidate_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (last_validation_id) REFERENCES strategy_validations(id)
);

CREATE INDEX IF NOT EXISTS strategy_runtime_state_lifecycle_revalidate_idx
ON strategy_runtime_state (lifecycle_state, next_revalidate_at);
