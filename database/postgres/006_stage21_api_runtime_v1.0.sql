-- Grammar Mastery Platform - Stage 21 API runtime storage
-- Patch version: api-runtime-storage-v1.0.0 | PostgreSQL 15+
-- Base: relational-schema-v0.9.0 plus Stage15-20 additive patches.
-- Additive only: question revisions, test snapshots, answers and historical reports are unchanged.
-- Selected adapter: Django 5.2 LTS + Django REST Framework 3.16+.
-- These tables remain canonical; Django must not create duplicate auth or learning tables.

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  password_algorithm varchar(40) NOT NULL,
  password_parameters jsonb NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempt_count int NOT NULL DEFAULT 0 CHECK(failed_attempt_count>=0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(length(password_hash)>=32),
  CHECK(jsonb_typeof(password_parameters)='object')
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_code varchar(30) NOT NULL CHECK(role_code IN ('USER','ADMIN','CONTENT_EDITOR','REVIEWER')),
  actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  granted_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK(jsonb_typeof(metadata)='object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_s21_active_user_role
  ON user_role_assignments(user_id, role_code)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_s21_roles_user_active
  ON user_role_assignments(user_id, role_code)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at>issued_at),
  CHECK((status='REVOKED')=(revoked_at IS NOT NULL)),
  CHECK(jsonb_typeof(client_metadata)='object')
);

CREATE INDEX IF NOT EXISTS idx_s21_auth_sessions_user_active
  ON auth_sessions(user_id, expires_at DESC)
  WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS idx_s21_auth_sessions_expiry
  ON auth_sessions(expires_at)
  WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS api_idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  state varchar(16) NOT NULL CHECK(state IN ('IN_PROGRESS','COMPLETED','FAILED')),
  response_status smallint CHECK(response_status BETWEEN 100 AND 599),
  response_body jsonb,
  resource_type varchar(80),
  resource_id uuid,
  request_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id, operation_id, idempotency_key),
  CHECK(expires_at>created_at),
  CHECK(
    state<>'COMPLETED'
    OR (response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_s21_idempotency_expiry
  ON api_idempotency_records(expires_at);

CREATE INDEX IF NOT EXISTS idx_s21_idempotency_resource
  ON api_idempotency_records(resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_type varchar(80) NOT NULL CHECK(job_type IN (
    'DASHBOARD_REBUILD',
    'MASTERY_BACKFILL',
    'PROGRESS_REBUILD',
    'QUESTION_METRICS_REBUILD'
  )),
  state varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  error_code varchar(80),
  progress_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK(progress_pct BETWEEN 0 AND 100),
  request_id varchar(128) NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(input_payload)='object'),
  CHECK(result_payload IS NULL OR jsonb_typeof(result_payload)='object'),
  CHECK(state<>'RUNNING' OR started_at IS NOT NULL),
  CHECK(state NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR completed_at IS NOT NULL),
  CHECK(state<>'FAILED' OR error_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_s21_analytics_jobs_state_time
  ON analytics_jobs(state, queued_at);

CREATE INDEX IF NOT EXISTS idx_s21_analytics_jobs_requester_time
  ON analytics_jobs(requested_by_user_id, queued_at DESC);

CREATE OR REPLACE FUNCTION s21_guard_session_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.user_id<>OLD.user_id OR NEW.issued_at<>OLD.issued_at OR NEW.expires_at<>OLD.expires_at THEN
    RAISE EXCEPTION 'Stage21 session identity and lifetime are immutable';
  END IF;
  IF OLD.status IN ('REVOKED','EXPIRED') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'Stage21 terminal session cannot be reactivated';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s21_auth_session_transition ON auth_sessions;
CREATE TRIGGER trg_s21_auth_session_transition
BEFORE UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION s21_guard_session_transition();

CREATE OR REPLACE FUNCTION s21_guard_idempotency_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.user_id<>OLD.user_id
     OR NEW.operation_id<>OLD.operation_id
     OR NEW.idempotency_key<>OLD.idempotency_key
     OR NEW.request_hash<>OLD.request_hash
     OR NEW.request_id<>OLD.request_id
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Stage21 idempotency identity is immutable';
  END IF;
  IF OLD.state='COMPLETED' THEN
    RAISE EXCEPTION 'Stage21 completed idempotency response is immutable';
  END IF;
  IF OLD.state='FAILED' AND NEW.state<>OLD.state THEN
    RAISE EXCEPTION 'Stage21 failed idempotency record cannot be reused';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s21_idempotency_transition ON api_idempotency_records;
CREATE TRIGGER trg_s21_idempotency_transition
BEFORE UPDATE ON api_idempotency_records
FOR EACH ROW EXECUTE FUNCTION s21_guard_idempotency_transition();

CREATE OR REPLACE FUNCTION s21_prevent_role_history_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stage21 role assignments are historical; revoke instead of delete';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s21_role_assignment_no_delete ON user_role_assignments;
CREATE TRIGGER trg_s21_role_assignment_no_delete
BEFORE DELETE ON user_role_assignments
FOR EACH ROW EXECUTE FUNCTION s21_prevent_role_history_delete();

INSERT INTO system_versions(component, version, status, source_ref, metadata)
VALUES
  ('stage21.api', 'grammar-mastery-api-v1.0.0', 'REVIEW_CANDIDATE', 'api/stage21_core_api_spec_v1.0.yaml', '{}'::jsonb),
  ('stage21.auth', 'auth-policy-v1.0.0', 'REVIEW_CANDIDATE', 'docs/stages/stage21/auth_policy_v1.0.md', '{}'::jsonb),
  ('stage21.errors', 'api-error-v1.0.0', 'REVIEW_CANDIDATE', 'docs/stages/stage21/error_contract_v1.0.md', '{}'::jsonb),
  ('stage21.idempotency', 'api-idempotency-v1.0.0', 'REVIEW_CANDIDATE', 'schemas/stage21_idempotency_record_v1.0.json', '{}'::jsonb),
  ('stage21.storage', 'api-runtime-storage-v1.0.0', 'REVIEW_CANDIDATE', 'database/postgres/006_stage21_api_runtime_v1.0.sql', '{}'::jsonb),
  ('stage21.implementation', 'stage21-django-nextjs-profile-v1.0.0', 'REVIEW_CANDIDATE', 'docs/stages/stage21/framework_decision_v1.0.md', '{"backend":"Django 5.2 LTS","api":"Django REST Framework 3.16+","frontend":"Next.js 16 Active LTS"}'::jsonb)
ON CONFLICT(component) DO NOTHING;
