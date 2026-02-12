-- Per-bot loop configuration (strongly consistent via D1).
-- KV remains for legacy single-tenant config (loop:config).
CREATE TABLE IF NOT EXISTS loop_configs (
  tenant_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS loop_configs_enabled_idx
ON loop_configs (enabled, updated_at);

