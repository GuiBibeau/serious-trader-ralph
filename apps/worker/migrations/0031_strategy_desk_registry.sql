CREATE TABLE IF NOT EXISTS strategy_desk_scenarios (
  scenario_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  strategy_key TEXT NOT NULL,
  thesis TEXT NOT NULL,
  sleeve_id TEXT,
  state TEXT NOT NULL,
  reviewed_at TEXT,
  active_handoff_id TEXT,
  latest_report_id TEXT,
  evidence_json TEXT NOT NULL,
  implementation_references_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_scenarios_owner
ON strategy_desk_scenarios(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_scenarios_strategy
ON strategy_desk_scenarios(strategy_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_scenarios_state
ON strategy_desk_scenarios(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_desk_scenario_legs (
  scenario_id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  venue_key TEXT NOT NULL,
  intent_family TEXT NOT NULL,
  market_type TEXT NOT NULL,
  pair_json TEXT,
  instrument_id TEXT,
  asset_keys_json TEXT NOT NULL,
  enabled_modes_json TEXT NOT NULL,
  sizing_json TEXT NOT NULL,
  thesis TEXT,
  dependencies_json TEXT,
  tags_json TEXT,
  PRIMARY KEY (scenario_id, leg_id),
  FOREIGN KEY (scenario_id) REFERENCES strategy_desk_scenarios(scenario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_scenario_legs_order
ON strategy_desk_scenario_legs(scenario_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_scenario_legs_venue
ON strategy_desk_scenario_legs(venue_key, market_type, intent_family);

CREATE TABLE IF NOT EXISTS strategy_desk_runs (
  scenario_run_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  scenario_state TEXT NOT NULL,
  run_kind TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  leg_runs_json TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (scenario_id) REFERENCES strategy_desk_scenarios(scenario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_runs_scenario
ON strategy_desk_runs(scenario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_runs_state
ON strategy_desk_runs(state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_runs_kind
ON strategy_desk_runs(run_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_desk_reports (
  report_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  scenario_run_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  leg_outcomes_json TEXT NOT NULL,
  portfolio_summary_json TEXT,
  evidence_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  approvals_json TEXT NOT NULL,
  metadata_json TEXT,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (scenario_id) REFERENCES strategy_desk_scenarios(scenario_id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_run_id) REFERENCES strategy_desk_runs(scenario_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_reports_scenario
ON strategy_desk_reports(scenario_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_reports_run
ON strategy_desk_reports(scenario_run_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_desk_reports_stage
ON strategy_desk_reports(stage, generated_at DESC);
