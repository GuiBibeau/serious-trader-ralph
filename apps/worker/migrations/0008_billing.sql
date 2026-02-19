CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  starts_at TEXT,
  expires_at TEXT,
  source_signature TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS subscriptions_status_expires_idx
ON subscriptions (status, expires_at);

CREATE TABLE IF NOT EXISTS billing_payment_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  reference_key TEXT NOT NULL UNIQUE,
  mint TEXT NOT NULL,
  merchant_wallet TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  amount_decimal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  signature TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS billing_payment_intents_user_idx
ON billing_payment_intents (user_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_intents_signature_uidx
ON billing_payment_intents (signature)
WHERE signature IS NOT NULL;
