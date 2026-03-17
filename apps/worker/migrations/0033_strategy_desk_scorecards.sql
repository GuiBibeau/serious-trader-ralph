ALTER TABLE strategy_desk_scenarios
ADD COLUMN risk_limits_json TEXT;

ALTER TABLE strategy_desk_reports
ADD COLUMN scorecard_json TEXT;

ALTER TABLE strategy_desk_reports
ADD COLUMN risk_overlays_json TEXT;
