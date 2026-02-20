ALTER TABLE users
ADD COLUMN experience_level TEXT NOT NULL DEFAULT 'beginner'
  CHECK (experience_level IN ('beginner', 'intermediate', 'pro', 'degen'));

ALTER TABLE users
ADD COLUMN level_source TEXT NOT NULL DEFAULT 'auto'
  CHECK (level_source IN ('auto', 'manual'));

ALTER TABLE users
ADD COLUMN onboarding_completed_at TEXT;

ALTER TABLE users
ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN feed_seed_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN degen_acknowledged_at TEXT;
