CREATE TABLE IF NOT EXISTS strategy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  before_config_json TEXT,
  after_config_json TEXT,
  validation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (validation_id) REFERENCES strategy_validations(id)
);

CREATE INDEX IF NOT EXISTS strategy_events_tenant_created_idx
ON strategy_events (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS strategy_events_tenant_type_created_idx
ON strategy_events (tenant_id, event_type, created_at);
