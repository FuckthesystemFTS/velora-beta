CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_peer_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_status ON auth_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_access_hash ON auth_sessions(access_token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_hash ON auth_sessions(refresh_token_hash);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  challenge_id UUID REFERENCES admin_challenges(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(session_token_hash);

ALTER TABLE velomail_messages ADD COLUMN IF NOT EXISTS subject_ciphertext TEXT;
ALTER TABLE velomail_messages ADD COLUMN IF NOT EXISTS encryption_scheme TEXT NOT NULL DEFAULT 'LEGACY_CENTRALIZED';
ALTER TABLE velomail_messages ADD COLUMN IF NOT EXISTS replication_status TEXT NOT NULL DEFAULT 'CENTRALIZED';
ALTER TABLE velomail_messages ADD COLUMN IF NOT EXISTS replica_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE velomail_messages ADD COLUMN IF NOT EXISTS encrypted_by_client BOOLEAN NOT NULL DEFAULT false;
