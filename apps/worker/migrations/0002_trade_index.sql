CREATE TABLE IF NOT EXISTS trade_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  run_id TEXT,
  venue TEXT,
  market TEXT,
  side TEXT,
  size TEXT,
  price TEXT,
  status TEXT,
  log_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS trade_index_tenant_idx ON trade_index (tenant_id, created_at);
