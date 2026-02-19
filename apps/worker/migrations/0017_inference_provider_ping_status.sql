ALTER TABLE bot_inference_providers ADD COLUMN last_ping_at TEXT;
ALTER TABLE bot_inference_providers ADD COLUMN last_ping_error TEXT;

CREATE INDEX IF NOT EXISTS bot_inference_providers_ping_idx
ON bot_inference_providers (last_ping_at, updated_at);
