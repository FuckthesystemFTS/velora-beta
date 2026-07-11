ALTER TABLE mining_ledger
  ADD COLUMN IF NOT EXISTS accounting_period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  ADD COLUMN IF NOT EXISTS pool_payment_id UUID REFERENCES mining_pool_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS network_fee_atomic_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_wallet TEXT,
  ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mining_ledger_idempotency_key_idx
  ON mining_ledger(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE mining_pool_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mining_pool_payments_idempotency_key_idx
  ON mining_pool_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
