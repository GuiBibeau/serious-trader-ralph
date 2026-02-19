CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  kind TEXT NOT NULL CHECK(kind IN ('validation', 'strategy_json')),
  request_json TEXT NOT NULL,
  summary_json TEXT,
  result_ref TEXT,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS backtest_runs_tenant_created_idx
ON backtest_runs (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS backtest_runs_tenant_status_created_idx
ON backtest_runs (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS backtest_runs_run_id_idx
ON backtest_runs (run_id);

CREATE TABLE IF NOT EXISTS backtest_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS backtest_run_events_run_created_idx
ON backtest_run_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS backtest_run_events_tenant_created_idx
ON backtest_run_events (tenant_id, created_at);
