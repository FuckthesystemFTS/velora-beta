CREATE TABLE IF NOT EXISTS velomail_reserved_aliases (
  alias TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO velomail_reserved_aliases(alias, reason) VALUES
  ('admin', 'platform-reserved'),
  ('system', 'platform-reserved'),
  ('security', 'official-system-address'),
  ('support', 'official-system-address'),
  ('billing', 'platform-reserved'),
  ('updates', 'official-system-address'),
  ('velora', 'platform-reserved'),
  ('root', 'platform-reserved'),
  ('abuse', 'platform-reserved'),
  ('postmaster', 'platform-reserved'),
  ('noreply', 'official-system-address'),
  ('notifications', 'official-system-address')
ON CONFLICT (alias) DO NOTHING;

CREATE TABLE IF NOT EXISTS velomail_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  identity_level INTEGER NOT NULL DEFAULT 0,
  public_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS device_account_links (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_device_account_links_device_active ON device_account_links(device_id, status);

CREATE TABLE IF NOT EXISTS velomail_messages (
  id UUID PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES velomail_accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  folder TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  recipient_addresses TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL,
  body_ciphertext TEXT NOT NULL,
  body_preview TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  envelope_signature TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'QUEUED',
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_velomail_messages_account_folder ON velomail_messages(account_id, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_velomail_messages_account_search ON velomail_messages(account_id, sender_address, subject);

CREATE TABLE IF NOT EXISTS velomail_blocked_senders (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES velomail_accounts(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, sender_address)
);

CREATE TABLE IF NOT EXISTS velomail_abuse_reports (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES velomail_accounts(id) ON DELETE CASCADE,
  message_id UUID REFERENCES velomail_messages(id) ON DELETE SET NULL,
  sender_address TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
