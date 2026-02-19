CREATE TABLE IF NOT EXISTS bot_inference_providers (
  bot_id TEXT PRIMARY KEY,
  provider_kind TEXT NOT NULL DEFAULT 'openai_compatible',
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  key_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE INDEX IF NOT EXISTS bot_inference_providers_kind_idx
ON bot_inference_providers (provider_kind, updated_at);
