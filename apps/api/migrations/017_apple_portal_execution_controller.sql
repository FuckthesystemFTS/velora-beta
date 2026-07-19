CREATE TABLE IF NOT EXISTS remote_execution_operations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  requested_state TEXT,
  accepted_state TEXT NOT NULL DEFAULT 'ACCEPTED',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  timeout_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS remote_execution_operations_user_created_idx
  ON remote_execution_operations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS remote_execution_operations_status_idx
  ON remote_execution_operations(status, timeout_at);
