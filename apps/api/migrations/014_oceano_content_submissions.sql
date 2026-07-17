ALTER TABLE search_documents ALTER COLUMN zone_id DROP NOT NULL;
ALTER TABLE search_documents ALTER COLUMN release_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS oceano_content_submissions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'ARTICLE',
  source_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  admin_note TEXT,
  reviewed_by TEXT REFERENCES admin_accounts(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oceano_submissions_status ON oceano_content_submissions(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_oceano_submissions_user ON oceano_content_submissions(user_id, submitted_at DESC);
