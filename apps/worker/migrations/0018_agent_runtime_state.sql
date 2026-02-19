CREATE TABLE IF NOT EXISTS bot_steering_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'canceled')),
  queued_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,
  applied_run_id TEXT
);

CREATE INDEX IF NOT EXISTS bot_steering_messages_bot_status_idx
ON bot_steering_messages (bot_id, status, queued_at);

CREATE INDEX IF NOT EXISTS bot_steering_messages_bot_queued_idx
ON bot_steering_messages (bot_id, queued_at);

CREATE TABLE IF NOT EXISTS bot_agent_memory (
  bot_id TEXT PRIMARY KEY,
  memory_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE INDEX IF NOT EXISTS bot_agent_memory_updated_idx
ON bot_agent_memory (updated_at);

CREATE TABLE IF NOT EXISTS bot_run_state (
  bot_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  blocked_reason TEXT,
  current_run_id TEXT,
  last_tick_at TEXT,
  next_tick_at TEXT,
  provider_base_url_hash TEXT,
  provider_model TEXT,
  provider_ping_age_ms INTEGER,
  resolution_source TEXT,
  steering_last_applied_id INTEGER,
  compacted_at TEXT,
  compacted_count INTEGER NOT NULL DEFAULT 0,
  message_window_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE INDEX IF NOT EXISTS bot_run_state_state_idx
ON bot_run_state (state, updated_at);
