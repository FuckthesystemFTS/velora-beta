CREATE TABLE IF NOT EXISTS contribution_profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'VELORA_ONLY',
  velora_node_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  hosting_node_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mining_partner_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  resource_profile TEXT NOT NULL DEFAULT 'MINIMUM',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS node_module_consents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_peer_id TEXT,
  module TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  resource_profile TEXT NOT NULL DEFAULT 'MINIMUM',
  disclosure_json JSONB NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contributor_nodes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_peer_id TEXT NOT NULL,
  module TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  resource_profile TEXT NOT NULL DEFAULT 'MINIMUM',
  certificate_json JSONB NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_peer_id, module)
);

CREATE TABLE IF NOT EXISTS contributor_node_heartbeats (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES contributor_nodes(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  uptime_seconds INTEGER NOT NULL DEFAULT 0,
  resources_json JSONB NOT NULL,
  health_json JSONB NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_id, nonce)
);

CREATE TABLE IF NOT EXISTS hosting_credit_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id UUID REFERENCES contributor_nodes(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  period_month TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  requested_use TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  decision_reason TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_peer_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_peer_id)
);

CREATE TABLE IF NOT EXISTS mining_workers (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  coin TEXT NOT NULL,
  user_wallet TEXT NOT NULL,
  velora_wallet TEXT NOT NULL,
  pool_url TEXT,
  payout_split_user_bps INTEGER NOT NULL DEFAULT 5000,
  payout_split_velora_bps INTEGER NOT NULL DEFAULT 5000,
  status TEXT NOT NULL DEFAULT 'DISABLED',
  consent_id UUID REFERENCES node_module_consents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mining_device_id, coin)
);

CREATE TABLE IF NOT EXISTS mining_ledger (
  id UUID PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES mining_workers(id) ON DELETE CASCADE,
  coin TEXT NOT NULL,
  gross_atomic_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
  user_atomic_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
  velora_atomic_amount NUMERIC(40,0) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  tx_hash TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contribution_profiles_user_idx ON contribution_profiles(user_id);
CREATE INDEX IF NOT EXISTS contributor_nodes_user_status_idx ON contributor_nodes(user_id, status);
CREATE INDEX IF NOT EXISTS hosting_credit_ledger_user_status_idx ON hosting_credit_ledger(user_id, status);
CREATE INDEX IF NOT EXISTS credit_requests_status_idx ON credit_requests(status);
CREATE INDEX IF NOT EXISTS mining_workers_status_idx ON mining_workers(status);
CREATE INDEX IF NOT EXISTS mining_ledger_worker_status_idx ON mining_ledger(worker_id, status);
