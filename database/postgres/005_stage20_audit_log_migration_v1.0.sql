-- Grammar Mastery Platform - Stage 20 admin audit log
-- Migration version: admin-audit-v1.0.0
-- Additive. This does not replace question revision history from Stage 12.
-- Stage12 audit_logs remains canonical; each domain event links to its canonical audit row.

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_audit_log_id bigint NOT NULL UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  action varchar(60) NOT NULL,
  resource_type varchar(60) NOT NULL,
  resource_id uuid,
  batch_id uuid,
  request_id varchar(120),
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK(before_state IS NOT NULL OR after_state IS NOT NULL OR metadata <> '{}'::jsonb)
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_resource_time
  ON admin_audit_events(resource_type, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_time
  ON admin_audit_events(actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_batch
  ON admin_audit_events(batch_id) WHERE batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION s20_prevent_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stage20 admin audit events are append-only';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_audit_append_only ON admin_audit_events;
CREATE TRIGGER trg_admin_audit_append_only
BEFORE UPDATE OR DELETE ON admin_audit_events
FOR EACH ROW EXECUTE FUNCTION s20_prevent_admin_audit_mutation();
