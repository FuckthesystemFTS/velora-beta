CREATE TABLE IF NOT EXISTS forum_sections (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_messages (
  id UUID PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES forum_sections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  body_length INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'VISIBLE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS forum_presence (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES forum_sections(id) ON DELETE CASCADE,
  session_id_hash TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, section_id, session_id_hash)
);

CREATE TABLE IF NOT EXISTS forum_moderation_actions (
  id UUID PRIMARY KEY,
  moderator_user_id UUID,
  target_user_id UUID,
  message_id UUID REFERENCES forum_messages(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO forum_sections (id, slug, title, description, sort_order)
VALUES (
  '00000000-0000-4000-8000-000000000701',
  'global-chat',
  'Chat Globale',
  'La prima chat pubblica della Beta Velora',
  1
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  is_active = TRUE,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_forum_messages_section_created ON forum_messages(section_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_messages_user_created ON forum_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_presence_section_seen ON forum_presence(section_id, last_seen_at DESC);
