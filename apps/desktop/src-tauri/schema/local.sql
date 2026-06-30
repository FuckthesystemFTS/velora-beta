CREATE TABLE IF NOT EXISTS local_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS node_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  peer_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  private_key_sealed TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  profile_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parental_rules (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  value TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS known_peers (
  peer_id TEXT PRIMARY KEY,
  multiaddr TEXT NOT NULL,
  last_seen_at TEXT,
  score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_records (
  address TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  description TEXT,
  publisher TEXT,
  age_rating TEXT NOT NULL,
  trust_level INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS site_fts USING fts5(
  address,
  category,
  slug,
  title,
  description,
  keywords,
  publisher,
  language,
  tags,
  age_rating,
  trust_level UNINDEXED
);

CREATE TABLE IF NOT EXISTS bookmarks (
  address TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  title TEXT,
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  source_address TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_pending_commands (
  command_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cached_releases (
  address TEXT NOT NULL,
  release_id TEXT,
  version TEXT NOT NULL,
  content_cid TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  publisher_public_key TEXT NOT NULL,
  publisher_signature TEXT NOT NULL,
  package_path TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  total_size INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(address, version)
);

CREATE TABLE IF NOT EXISTS cached_content_chunks (
  content_cid TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(content_cid, chunk_index)
);
