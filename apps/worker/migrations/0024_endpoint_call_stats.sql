CREATE TABLE IF NOT EXISTS endpoint_call_stats (
  endpoint_method TEXT NOT NULL,
  endpoint_path TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  first_called_at TEXT NOT NULL,
  last_called_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (endpoint_method, endpoint_path)
);

CREATE INDEX IF NOT EXISTS idx_endpoint_call_stats_count
ON endpoint_call_stats(call_count DESC);

CREATE INDEX IF NOT EXISTS idx_endpoint_call_stats_last_called
ON endpoint_call_stats(last_called_at DESC);
