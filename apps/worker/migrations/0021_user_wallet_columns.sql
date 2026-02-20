ALTER TABLE users
ADD COLUMN signer_type TEXT NOT NULL DEFAULT 'privy';

ALTER TABLE users
ADD COLUMN privy_wallet_id TEXT;

ALTER TABLE users
ADD COLUMN wallet_address TEXT;

ALTER TABLE users
ADD COLUMN wallet_migrated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_privy_wallet_id_unique_idx
ON users (privy_wallet_id)
WHERE privy_wallet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_address_unique_idx
ON users (wallet_address)
WHERE wallet_address IS NOT NULL;
