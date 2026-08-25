-- Grammar Mastery Platform - Password recovery extension
-- Version: password-recovery-storage-v1.0.0 | PostgreSQL 15+
-- Additive only. Existing users, credentials, sessions and learning history are unchanged.

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  email_fingerprint char(64) NOT NULL CHECK(email_fingerprint ~ '^[a-f0-9]{64}$'),
  locale varchar(5) NOT NULL CHECK(locale IN ('fa-IR','en-CA')),
  token_hash char(64) UNIQUE CHECK(token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  consumed_at timestamptz,
  delivery_status varchar(16) NOT NULL CHECK(delivery_status IN ('SUPPRESSED','PENDING','SENT','FAILED')),
  policy_version varchar(80) NOT NULL,
  CHECK(expires_at IS NULL OR expires_at > requested_at),
  CHECK(
    (user_id IS NULL AND token_hash IS NULL AND expires_at IS NULL AND delivery_status = 'SUPPRESSED')
    OR
    (user_id IS NOT NULL AND token_hash IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_password_reset_email_recent
  ON password_reset_requests(email_fingerprint, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_live
  ON password_reset_requests(user_id, expires_at DESC)
  WHERE user_id IS NOT NULL AND consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_expiry
  ON password_reset_requests(expires_at)
  WHERE expires_at IS NOT NULL AND consumed_at IS NULL;

COMMENT ON TABLE password_reset_requests IS
  'Account-recovery request ledger. Raw reset tokens and normalized emails are never stored here.';
