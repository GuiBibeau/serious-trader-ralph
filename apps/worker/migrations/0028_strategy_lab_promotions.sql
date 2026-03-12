CREATE TABLE IF NOT EXISTS strategy_lab_promotions (
  promotion_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  current_state TEXT NOT NULL,
  target_state TEXT NOT NULL,
  transition_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  issue_number INTEGER,
  pull_request_number INTEGER,
  deployment_id TEXT,
  policy_gate_id TEXT,
  synthesis_id TEXT,
  triage_id TEXT,
  implementation_reference_json TEXT,
  evidence_refs_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  approvals_json TEXT,
  metadata_json TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_promotions_subject
ON strategy_lab_promotions(subject_kind, subject_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_promotions_status
ON strategy_lab_promotions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_lab_promotion_events (
  event_id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  summary TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (promotion_id) REFERENCES strategy_lab_promotions(promotion_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_promotion_events_promotion
ON strategy_lab_promotion_events(promotion_id, created_at ASC);
