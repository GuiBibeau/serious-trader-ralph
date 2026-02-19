ALTER TABLE users ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'being_onboarded'
  CHECK (onboarding_status IN ('being_onboarded', 'active'));

UPDATE users
SET onboarding_status = CASE
  WHEN id IN (
    SELECT user_id
    FROM subscriptions
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND datetime(expires_at) > datetime('now')
  ) THEN 'active'
  ELSE 'being_onboarded'
END;
