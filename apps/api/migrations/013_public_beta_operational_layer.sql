ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS recovery_token_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE auth_sessions
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '12 hours'),
  ALTER COLUMN refresh_expires_at SET DEFAULT (NOW() + INTERVAL '90 days');

ALTER TABLE mining_payout_requests
  ADD COLUMN IF NOT EXISTS admin_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNREAD',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_notifications_user_status_idx
  ON user_notifications(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS operational_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_admin_id TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO',
  ip_hash TEXT,
  user_agent_hash TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operational_events_created_idx
  ON operational_events(created_at DESC);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS database_backups (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'HEROKU_PG',
  status TEXT NOT NULL DEFAULT 'CHECK_REQUIRED',
  label TEXT NOT NULL,
  backup_url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
