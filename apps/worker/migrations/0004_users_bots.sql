CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  privy_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  signer_type TEXT NOT NULL DEFAULT 'privy',
  privy_wallet_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  last_tick_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS bots_user_idx ON bots (user_id, created_at);
CREATE INDEX IF NOT EXISTS bots_enabled_idx ON bots (enabled, updated_at);

