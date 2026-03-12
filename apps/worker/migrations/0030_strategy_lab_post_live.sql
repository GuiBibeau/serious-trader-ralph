CREATE TABLE IF NOT EXISTS strategy_lab_post_live_artifacts (
  post_live_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  subject_kind TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  current_state TEXT,
  deployment_id TEXT,
  venue_key TEXT,
  asset_key TEXT,
  pair_symbol TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  recommended_target_state TEXT,
  applied_action TEXT,
  applied_target_state TEXT,
  follow_up_promotion_id TEXT,
  follow_up_control_ref TEXT,
  checks_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_post_live_subject
ON strategy_lab_post_live_artifacts(subject_kind, subject_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_lab_post_live_status
ON strategy_lab_post_live_artifacts(status, created_at DESC);
