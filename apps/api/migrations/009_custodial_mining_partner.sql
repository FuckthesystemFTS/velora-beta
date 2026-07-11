ALTER TABLE mining_workers
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS pool_username TEXT,
  ADD COLUMN IF NOT EXISTS pool_worker_format TEXT,
  ADD COLUMN IF NOT EXISTS pool_worker_password TEXT,
  ADD COLUMN IF NOT EXISTS payout_wallet TEXT,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'CONFIGURATION_INCOMPLETE',
  ADD COLUMN IF NOT EXISTS accounting_period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  ADD COLUMN IF NOT EXISTS last_accounting_error TEXT;

UPDATE mining_workers
SET
  payout_wallet = COALESCE(payout_wallet, user_wallet),
  pool_username = COALESCE(pool_username, velora_wallet),
  worker_id = COALESCE(worker_id, 'velora_legacy_' || SUBSTRING(id::text, 1, 12)),
  accounting_status = CASE
    WHEN accounting_status IS NULL OR accounting_status = '' THEN 'CONFIGURATION_INCOMPLETE'
    ELSE accounting_status
  END
WHERE payout_wallet IS NULL OR pool_username IS NULL OR worker_id IS NULL OR accounting_status IS NULL OR accounting_status = '';

CREATE UNIQUE INDEX IF NOT EXISTS mining_workers_worker_id_idx ON mining_workers(worker_id);

CREATE TABLE IF NOT EXISTS mining_pool_shares (
  id UUID PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES mining_workers(id) ON DELETE CASCADE,
  coin TEXT NOT NULL,
  pool_url TEXT NOT NULL,
  pool_share_id TEXT NOT NULL,
  accounting_period TEXT NOT NULL,
  status TEXT NOT NULL,
  difficulty_atomic NUMERIC(40,0) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(worker_id, pool_share_id)
);

CREATE TABLE IF NOT EXISTS mining_pool_payments (
  id UUID PRIMARY KEY,
  coin TEXT NOT NULL,
  pool_url TEXT NOT NULL,
  accounting_period TEXT NOT NULL,
  confirmed_mined_atomic_amount NUMERIC(40,0) NOT NULL,
  unavoidable_network_fee_atomic_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
  tx_hash TEXT,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(coin, pool_url, accounting_period, tx_hash)
);

CREATE INDEX IF NOT EXISTS mining_pool_shares_worker_period_idx ON mining_pool_shares(worker_id, accounting_period);
CREATE INDEX IF NOT EXISTS mining_pool_payments_status_idx ON mining_pool_payments(status);
