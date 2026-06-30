CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  peer_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_certificates (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  certificate_payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_last4 TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS navigation_categories (
  code TEXT PRIMARY KEY,
  label_it TEXT NOT NULL,
  label_en TEXT NOT NULL,
  description_it TEXT NOT NULL,
  description_en TEXT NOT NULL,
  icon TEXT NOT NULL,
  age_rating TEXT NOT NULL,
  family_safe_default BOOLEAN NOT NULL,
  enabled BOOLEAN NOT NULL,
  version INTEGER NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reserved_names (
  name TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zone_requests (
  id UUID PRIMARY KEY,
  requested_address TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  slug TEXT NOT NULL,
  requester_user_id UUID NOT NULL,
  requester_data_encrypted TEXT NOT NULL,
  project_description TEXT NOT NULL,
  business_description TEXT NOT NULL,
  ownership_declaration BOOLEAN NOT NULL,
  content_type TEXT NOT NULL,
  age_rating TEXT NOT NULL,
  family_safe BOOLEAN NOT NULL,
  status TEXT NOT NULL,
  automatic_checks_json JSONB NOT NULL,
  admin_notes_encrypted TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_started_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  decision_reason TEXT,
  reservation_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS navigation_zones (
  id UUID PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  owner_public_key TEXT NOT NULL,
  status TEXT NOT NULL,
  record_payload JSONB NOT NULL,
  platform_signature TEXT NOT NULL,
  current_release_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  public_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  must_rotate_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_devices (
  id UUID PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  device_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_challenges (
  id UUID PRIMARY KEY,
  admin_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_command_nonces (
  nonce TEXT PRIMARY KEY,
  command_id UUID NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  admin_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bootstrap_peers (
  id UUID PRIMARY KEY,
  peer_id TEXT NOT NULL UNIQUE,
  multiaddr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revocations (
  id UUID PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  signature TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_requests_status ON zone_requests(status);
CREATE INDEX IF NOT EXISTS idx_zone_requests_address ON zone_requests(requested_address);
CREATE INDEX IF NOT EXISTS idx_navigation_zones_address_status ON navigation_zones(address, status);
CREATE INDEX IF NOT EXISTS idx_admin_challenges_expires ON admin_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

INSERT INTO reserved_names (name, reason)
VALUES
  ('admin', 'platform-reserved'),
  ('support', 'platform-reserved'),
  ('system', 'platform-reserved'),
  ('root', 'platform-reserved'),
  ('velora', 'platform-reserved')
ON CONFLICT (name) DO NOTHING;
