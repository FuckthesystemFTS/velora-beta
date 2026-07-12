CREATE TABLE IF NOT EXISTS mining_payout_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES mining_workers(id) ON DELETE SET NULL,
  coin TEXT NOT NULL,
  payout_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  note TEXT,
  admin_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mining_payout_requests_user_status_idx
  ON mining_payout_requests(user_id, status, requested_at DESC);
