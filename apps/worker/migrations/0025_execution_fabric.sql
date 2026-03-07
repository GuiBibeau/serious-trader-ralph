CREATE TABLE IF NOT EXISTS execution_requests (
  request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  mode TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  metadata_json TEXT,
  received_at TEXT NOT NULL,
  validated_at TEXT,
  terminal_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_execution_requests_status_updated
ON execution_requests(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_requests_received_at
ON execution_requests(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_requests_terminal_at
ON execution_requests(terminal_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_requests_actor
ON execution_requests(actor_type, actor_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_requests_mode_lane
ON execution_requests(mode, lane, received_at DESC);

CREATE TABLE IF NOT EXISTS execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  lane TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_request_id TEXT,
  provider_response_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, attempt_no),
  FOREIGN KEY (request_id)
    REFERENCES execution_requests(request_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_attempts_request_attempt
ON execution_attempts(request_id, attempt_no DESC);

CREATE INDEX IF NOT EXISTS idx_execution_attempts_provider
ON execution_attempts(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_attempts_status
ON execution_attempts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_status_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, seq),
  FOREIGN KEY (request_id)
    REFERENCES execution_requests(request_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_status_events_request_seq
ON execution_status_events(request_id, seq DESC);

CREATE INDEX IF NOT EXISTS idx_execution_status_events_request_created
ON execution_status_events(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_status_events_status_created
ON execution_status_events(status, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_receipts (
  request_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  finalized_status TEXT NOT NULL,
  lane TEXT NOT NULL,
  provider TEXT,
  signature TEXT,
  slot INTEGER,
  error_code TEXT,
  error_message TEXT,
  receipt_json TEXT,
  ready_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id)
    REFERENCES execution_requests(request_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_receipts_ready_at
ON execution_receipts(ready_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_receipts_signature
ON execution_receipts(signature);

CREATE INDEX IF NOT EXISTS idx_execution_receipts_provider_lane
ON execution_receipts(provider, lane, ready_at DESC);
