CREATE TABLE IF NOT EXISTS velora_cloud_files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_velora_cloud_files_user_active
  ON velora_cloud_files(user_id, created_at DESC)
  WHERE deleted_at IS NULL;
