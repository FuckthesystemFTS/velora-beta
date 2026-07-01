CREATE TABLE IF NOT EXISTS beta_logical_nodes (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'LOGICAL_BETA_NODE',
  public_key TEXT NOT NULL,
  encrypted_private_key_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'STARTING',
  protocol_version TEXT NOT NULL DEFAULT 'beta-logical-node-v1',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  inventory_digest TEXT NOT NULL DEFAULT 'sha256:v1:empty',
  monotonic_counter BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_error_code TEXT,
  restart_count INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beta_node_heartbeats (
  node_id TEXT NOT NULL REFERENCES beta_logical_nodes(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  status TEXT NOT NULL,
  inventory_digest TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id, sequence)
);

CREATE TABLE IF NOT EXISTS beta_node_payloads (
  cid TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  object_reference TEXT NOT NULL,
  object_hash TEXT NOT NULL,
  object_size BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beta_node_objects (
  node_id TEXT NOT NULL REFERENCES beta_logical_nodes(id) ON DELETE CASCADE,
  cid TEXT NOT NULL REFERENCES beta_node_payloads(cid) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_reference TEXT NOT NULL,
  object_hash TEXT NOT NULL,
  replica_status TEXT NOT NULL DEFAULT 'PENDING',
  acknowledged_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id, cid)
);

CREATE TABLE IF NOT EXISTS beta_replication_jobs (
  id UUID PRIMARY KEY,
  cid TEXT NOT NULL,
  source_node_id TEXT,
  destination_node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beta_node_events (
  id UUID PRIMARY KEY,
  node_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  safe_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beta_cluster_leases (
  lease_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_node_heartbeats_created_at_idx ON beta_node_heartbeats (created_at DESC);
CREATE INDEX IF NOT EXISTS beta_node_objects_cid_idx ON beta_node_objects (cid);
CREATE INDEX IF NOT EXISTS beta_node_objects_status_idx ON beta_node_objects (replica_status);
CREATE INDEX IF NOT EXISTS beta_replication_jobs_status_idx ON beta_replication_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS beta_node_events_created_at_idx ON beta_node_events (created_at DESC);
