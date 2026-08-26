-- Grammar Mastery Platform - real learner notifications
-- Additive runtime patch. PostgreSQL 15+.
-- Notifications are user-scoped, auditable, persisted, and deduplicated by source event.

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK(kind IN ('learning','system','general')),
  tone varchar(24) NOT NULL CHECK(tone IN ('review','streak','improvement','practice','result','summary','system')),
  action_required boolean NOT NULL DEFAULT false,
  title_fa text NOT NULL,
  title_en text NOT NULL,
  body_fa text NOT NULL,
  body_en text NOT NULL,
  href text,
  cta_fa text,
  cta_en text,
  french_scope text,
  source_type varchar(60) NOT NULL,
  source_key varchar(160) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  seen_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_notifications_source UNIQUE(user_id, source_type, source_key),
  CHECK(jsonb_typeof(payload)='object'),
  CHECK(read_at IS NULL OR seen_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
  ON user_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unseen
  ON user_notifications(user_id, created_at DESC)
  WHERE seen_at IS NULL;

INSERT INTO system_versions(component, version, status, source_ref, metadata)
VALUES (
  'runtime.notifications',
  'real-notifications-v1.0.0',
  'REVIEW_CANDIDATE',
  'database/postgres/011_runtime_notifications_v1.0.sql',
  '{"read_state":"server","dedupe":"source_event","streak_source":"accepted-user-answer"}'::jsonb
)
ON CONFLICT(component) DO UPDATE SET
  version=EXCLUDED.version,
  source_ref=EXCLUDED.source_ref,
  metadata=EXCLUDED.metadata;
