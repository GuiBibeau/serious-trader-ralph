CREATE TABLE IF NOT EXISTS strategy_desk_promotion_handoffs (
  handoff_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  current_state TEXT NOT NULL,
  target_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  implementation_reference_json TEXT,
  evidence_refs_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  approvals_json TEXT NOT NULL,
  bindings_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (scenario_id) REFERENCES strategy_desk_scenarios(scenario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_promotion_handoffs_scenario
ON strategy_desk_promotion_handoffs(scenario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_promotion_handoffs_status
ON strategy_desk_promotion_handoffs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_desk_promotion_handoff_events (
  event_id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  summary TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id) REFERENCES strategy_desk_promotion_handoffs(handoff_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_promotion_handoff_events_handoff
ON strategy_desk_promotion_handoff_events(handoff_id, created_at ASC);

CREATE TABLE IF NOT EXISTS strategy_desk_execution_recipes (
  recipe_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  handoff_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL,
  venue_key TEXT NOT NULL,
  instrument_id TEXT,
  pair_json TEXT,
  target_mode TEXT NOT NULL,
  lane TEXT,
  leg_ids_json TEXT NOT NULL,
  budget_json TEXT,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES strategy_desk_scenarios(scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (handoff_id) REFERENCES strategy_desk_promotion_handoffs(handoff_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_desk_execution_recipes_binding
ON strategy_desk_execution_recipes(handoff_id, binding_id);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_execution_recipes_scenario
ON strategy_desk_execution_recipes(scenario_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_execution_recipes_status
ON strategy_desk_execution_recipes(status, updated_at DESC);
