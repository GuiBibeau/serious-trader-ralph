CREATE TABLE IF NOT EXISTS bot_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'admin')),
  question TEXT,
  answer TEXT,
  model TEXT,
  sources_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS bot_conversations_tenant_created_idx
ON bot_conversations (tenant_id, created_at);
