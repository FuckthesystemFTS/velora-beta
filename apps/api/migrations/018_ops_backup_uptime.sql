CREATE TABLE IF NOT EXISTS database_backup_events (
  id UUID PRIMARY KEY,
  admin_id TEXT,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'heroku-postgres',
  status TEXT NOT NULL,
  backup_ref TEXT,
  restore_target TEXT,
  note TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS database_backup_events_created_idx
  ON database_backup_events(created_at DESC);

CREATE TABLE IF NOT EXISTS uptime_checks (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  health_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS uptime_checks_checked_idx
  ON uptime_checks(checked_at DESC);
