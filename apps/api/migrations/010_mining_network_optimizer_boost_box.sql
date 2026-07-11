CREATE TABLE IF NOT EXISTS mining_hardware_profiles (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  hardware_hash TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_DEVICE',
  cpu_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sensors_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mining_device_id, hardware_hash)
);

CREATE TABLE IF NOT EXISTS mining_benchmarks (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  consent_id UUID REFERENCES node_module_consents(id) ON DELETE SET NULL,
  benchmark_version TEXT NOT NULL,
  miner_version TEXT NOT NULL,
  profile TEXT NOT NULL,
  result_json JSONB NOT NULL,
  recommended_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'RECORDED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_optimizer_profiles (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  selected_profile TEXT NOT NULL,
  config_json JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_profitability_snapshots (
  id UUID PRIMARY KEY,
  coin TEXT NOT NULL,
  pool_url TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  score_bps INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_auto_switch_rules (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'AUTOMATIC',
  min_profit_difference_percent INTEGER NOT NULL DEFAULT 8,
  min_active_minutes INTEGER NOT NULL DEFAULT 60,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  max_switches_per_day INTEGER NOT NULL DEFAULT 6,
  evaluation_interval_seconds INTEGER NOT NULL DEFAULT 300,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS mining_auto_switch_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mining_device_id UUID REFERENCES mining_devices(id) ON DELETE SET NULL,
  from_coin TEXT,
  to_coin TEXT NOT NULL,
  reason TEXT NOT NULL,
  score_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_device_capabilities (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  capabilities_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(mining_device_id)
);

CREATE TABLE IF NOT EXISTS mining_device_metrics (
  id UUID PRIMARY KEY,
  mining_device_id UUID NOT NULL REFERENCES mining_devices(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES mining_workers(id) ON DELETE SET NULL,
  coin TEXT,
  device_type TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_DEVICE',
  accepted_shares INTEGER NOT NULL DEFAULT 0,
  rejected_shares INTEGER NOT NULL DEFAULT 0,
  stale_shares INTEGER NOT NULL DEFAULT 0,
  observed_hashrate_hs INTEGER NOT NULL DEFAULT 0,
  temperature_c INTEGER,
  power_watts INTEGER,
  source TEXT NOT NULL DEFAULT 'SERVER_SIDE',
  period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mining_network_snapshots (
  id UUID PRIMARY KEY,
  total_hashrate_hs INTEGER NOT NULL DEFAULT 0,
  active_workers INTEGER NOT NULL DEFAULT 0,
  active_devices INTEGER NOT NULL DEFAULT 0,
  active_boost_boxes INTEGER NOT NULL DEFAULT 0,
  xmr_hashrate_hs INTEGER NOT NULL DEFAULT 0,
  zeph_hashrate_hs INTEGER NOT NULL DEFAULT 0,
  accepted_shares INTEGER NOT NULL DEFAULT 0,
  rejected_shares INTEGER NOT NULL DEFAULT 0,
  reward_confirmed_atomic NUMERIC(40,0) NOT NULL DEFAULT 0,
  users_share_atomic NUMERIC(40,0) NOT NULL DEFAULT 0,
  velora_share_atomic NUMERIC(40,0) NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_box_enrollments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_box_certificates (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mining_device_id UUID REFERENCES mining_devices(id) ON DELETE SET NULL,
  public_key TEXT NOT NULL,
  certificate_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_box_metrics (
  id UUID PRIMARY KEY,
  certificate_id UUID REFERENCES boost_box_certificates(id) ON DELETE SET NULL,
  metrics_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_box_update_events (
  id UUID PRIMARY KEY,
  certificate_id UUID REFERENCES boost_box_certificates(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boost_box_revocations (
  id UUID PRIMARY KEY,
  certificate_id UUID REFERENCES boost_box_certificates(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mining_device_metrics_period_idx ON mining_device_metrics(period, coin);
CREATE INDEX IF NOT EXISTS mining_network_snapshots_period_idx ON mining_network_snapshots(period, created_at DESC);
CREATE INDEX IF NOT EXISTS boost_box_certificates_user_status_idx ON boost_box_certificates(user_id, status);
