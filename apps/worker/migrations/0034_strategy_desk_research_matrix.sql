ALTER TABLE strategy_desk_scenarios
ADD COLUMN research_matrix_json TEXT;

ALTER TABLE strategy_desk_reports
ADD COLUMN study_matrix_json TEXT;
