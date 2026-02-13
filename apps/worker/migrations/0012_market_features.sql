CREATE TABLE IF NOT EXISTS market_features (
  source TEXT NOT NULL,
  instrument TEXT NOT NULL,
  feature TEXT NOT NULL,
  ts TEXT NOT NULL,
  value_json TEXT NOT NULL,
  quality_score REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, instrument, feature, ts)
);

CREATE INDEX IF NOT EXISTS market_features_instrument_feature_ts_idx
ON market_features (instrument, feature, ts);
