CREATE TABLE IF NOT EXISTS publisher_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES navigation_zones(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_releases (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES navigation_zones(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content_cid TEXT NOT NULL UNIQUE,
  manifest_json JSONB NOT NULL,
  manifest_hash TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  publisher_public_key TEXT NOT NULL,
  publisher_signature TEXT NOT NULL,
  total_size BIGINT NOT NULL,
  file_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  CONSTRAINT uq_site_release_version UNIQUE(zone_id, version)
);

CREATE TABLE IF NOT EXISTS site_release_files (
  id UUID PRIMARY KEY,
  release_id UUID NOT NULL REFERENCES site_releases(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_objects (
  id UUID PRIMARY KEY,
  content_cid TEXT NOT NULL UNIQUE,
  package_hash TEXT NOT NULL,
  local_path TEXT NOT NULL,
  total_size BIGINT NOT NULL,
  file_count INTEGER NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_chunks (
  id UUID PRIMARY KEY,
  content_cid TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  chunk_size BIGINT NOT NULL,
  local_path TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_chunk UNIQUE(content_cid, chunk_index)
);

CREATE TABLE IF NOT EXISTS content_providers (
  id UUID PRIMARY KEY,
  content_cid TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_content_provider UNIQUE(content_cid, peer_id)
);

CREATE TABLE IF NOT EXISTS release_events (
  id UUID PRIMARY KEY,
  release_id UUID NOT NULL REFERENCES site_releases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_releases_zone_status ON site_releases(zone_id, status);
CREATE INDEX IF NOT EXISTS idx_content_chunks_cid ON content_chunks(content_cid);
CREATE INDEX IF NOT EXISTS idx_content_providers_cid ON content_providers(content_cid);
