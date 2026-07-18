ALTER TABLE velora_cloud_files
  ADD COLUMN IF NOT EXISTS protection_scheme TEXT NOT NULL DEFAULT 'LEGACY_BASE64',
  ADD COLUMN IF NOT EXISTS content_envelope JSONB,
  ADD COLUMN IF NOT EXISTS guardian_status TEXT NOT NULL DEFAULT 'PROTECTED',
  ADD COLUMN IF NOT EXISTS multisig_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS multisig_policy_id UUID;

CREATE TABLE IF NOT EXISTS guardian_security_state (
  id TEXT PRIMARY KEY,
  breached_levels INTEGER NOT NULL DEFAULT 0 CHECK (breached_levels >= 0 AND breached_levels <= 10),
  emergency_mode BOOLEAN NOT NULL DEFAULT FALSE,
  last_signal TEXT,
  last_signal_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO guardian_security_state (id, breached_levels, emergency_mode)
VALUES ('global', 0, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS guardian_security_events (
  id UUID PRIMARY KEY,
  level INTEGER NOT NULL CHECK (level >= 1 AND level <= 10),
  signal TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_admin_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT,
  severity TEXT NOT NULL DEFAULT 'NOTICE',
  sanitized_detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS guardian_security_events_created_idx
  ON guardian_security_events(created_at DESC);

CREATE TABLE IF NOT EXISTS cloud_multisig_policies (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosigner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cosigner_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cloud_multisig_policies_owner_active_idx
  ON cloud_multisig_policies(owner_user_id)
  WHERE status IN ('PENDING','ACTIVE');

CREATE TABLE IF NOT EXISTS cloud_multisig_approvals (
  id UUID PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES cloud_multisig_policies(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_file_id UUID REFERENCES velora_cloud_files(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS cloud_multisig_approvals_policy_idx
  ON cloud_multisig_approvals(policy_id, status, requested_at DESC);
