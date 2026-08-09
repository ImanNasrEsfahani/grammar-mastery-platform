-- Grammar Mastery Platform - Stage 23 import storage compatibility correction
-- Migration version: stage23-import-storage-v1.1.0 | PostgreSQL 15+
-- Stage24 finding: Stage12 already owns import_batches with an incompatible shape.
-- This replacement preserves that historical table and uses question_import_* names.
-- The historical v1.0 file remains in the repository for audit but must not be applied.

CREATE TABLE IF NOT EXISTS question_import_batches (
  id uuid PRIMARY KEY,
  schema_version varchar(100) NOT NULL,
  pipeline_version varchar(100) NOT NULL,
  file_name varchar(255) NOT NULL,
  file_type varchar(8) NOT NULL CHECK(file_type IN ('CSV','XLSX')),
  raw_object_key text NOT NULL,
  raw_sha256 char(64) NOT NULL CHECK(raw_sha256 ~ '^[0-9a-f]{64}$'),
  raw_size_bytes bigint NOT NULL CHECK(raw_size_bytes BETWEEN 1 AND 20971520),
  status varchar(24) NOT NULL CHECK(status IN ('UPLOADED','PARSED','PREVIEW_READY','COMMITTED','FAILED','ROLLED_BACK')),
  row_count int NOT NULL DEFAULT 0 CHECK(row_count BETWEEN 0 AND 1000),
  valid_count int NOT NULL DEFAULT 0 CHECK(valid_count>=0),
  invalid_count int NOT NULL DEFAULT 0 CHECK(invalid_count>=0),
  duplicate_count int NOT NULL DEFAULT 0 CHECK(duplicate_count>=0),
  semantic_review_count int NOT NULL DEFAULT 0 CHECK(semantic_review_count>=0),
  committed_count int NOT NULL DEFAULT 0 CHECK(committed_count>=0),
  preview_sha256 char(64) CHECK(preview_sha256 IS NULL OR preview_sha256 ~ '^[0-9a-f]{64}$'),
  confirmation_token_sha256 char(64) CHECK(confirmation_token_sha256 IS NULL OR confirmation_token_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  rolled_back_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  request_id varchar(128) NOT NULL,
  failure_code varchar(100),
  failure_detail jsonb,
  rollback_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  parsed_at timestamptz,
  previewed_at timestamptz,
  committed_at timestamptz,
  failed_at timestamptz,
  rolled_back_at timestamptz,
  CHECK(jsonb_typeof(coalesce(failure_detail, '{}'::jsonb))='object'),
  CHECK(status<>'PREVIEW_READY' OR (preview_sha256 IS NOT NULL AND confirmation_token_sha256 IS NOT NULL)),
  CHECK(status<>'COMMITTED' OR (committed_at IS NOT NULL AND committed_count=row_count AND invalid_count=0 AND duplicate_count=0 AND semantic_review_count=0)),
  CHECK(status<>'FAILED' OR (failed_at IS NOT NULL AND failure_code IS NOT NULL)),
  CHECK(status<>'ROLLED_BACK' OR (rolled_back_at IS NOT NULL AND rolled_back_by_actor_id IS NOT NULL AND nullif(btrim(rollback_reason),'') IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_s23_question_import_batches_status_time
  ON question_import_batches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_s23_question_import_batches_raw_hash
  ON question_import_batches(raw_sha256, created_at DESC);

CREATE TABLE IF NOT EXISTS question_import_batch_rows (
  batch_id uuid NOT NULL REFERENCES question_import_batches(id) ON DELETE RESTRICT,
  row_number int NOT NULL CHECK(row_number>=2),
  external_id varchar(100),
  source_data jsonb NOT NULL,
  normalized_data jsonb NOT NULL,
  disposition varchar(24) NOT NULL CHECK(disposition IN ('VALID','INVALID','DUPLICATE','SEMANTIC_REVIEW','COMMITTED','ROLLED_BACK')),
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint_sha256 char(64) CHECK(fingerprint_sha256 IS NULL OR fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  semantic_signature_sha256 char(64) CHECK(semantic_signature_sha256 IS NULL OR semantic_signature_sha256 ~ '^[0-9a-f]{64}$'),
  duplicate_classification varchar(40) CHECK(duplicate_classification IS NULL OR duplicate_classification IN ('UNIQUE','EXACT_EXISTING','EXACT_IN_BATCH','SEMANTIC_EXISTING_REVIEW','SEMANTIC_IN_BATCH_REVIEW')),
  related_row_number int,
  semantic_decision varchar(24) CHECK(semantic_decision IS NULL OR semantic_decision IN ('ACCEPT_DISTINCT','REJECT_DUPLICATE')),
  semantic_decision_reason text,
  semantic_decided_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  semantic_decided_at timestamptz,
  committed_question_id uuid UNIQUE REFERENCES questions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch_id,row_number),
  CHECK(jsonb_typeof(source_data)='object'),
  CHECK(jsonb_typeof(normalized_data)='object'),
  CHECK(jsonb_typeof(validation_issues)='array'),
  CHECK((semantic_decision IS NULL AND semantic_decision_reason IS NULL AND semantic_decided_by_actor_id IS NULL AND semantic_decided_at IS NULL)
     OR (semantic_decision IS NOT NULL AND nullif(btrim(semantic_decision_reason),'') IS NOT NULL AND semantic_decided_by_actor_id IS NOT NULL AND semantic_decided_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_s23_question_import_rows_disposition
  ON question_import_batch_rows(batch_id, disposition, row_number);
CREATE INDEX IF NOT EXISTS idx_s23_question_import_rows_fingerprint
  ON question_import_batch_rows(fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_s23_question_import_rows_semantic
  ON question_import_batch_rows(semantic_signature_sha256) WHERE semantic_signature_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS question_import_batch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES question_import_batches(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL CHECK(event_type IN ('UPLOADED','PARSED','PREVIEWED','SEMANTIC_REVIEW_RESOLVED','COMMITTED','POST_CHECKED','FAILED','ROLLED_BACK')),
  actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  canonical_audit_log_id bigint REFERENCES audit_logs(id) ON DELETE RESTRICT,
  admin_audit_event_id uuid REFERENCES admin_audit_events(id) ON DELETE RESTRICT,
  request_id varchar(128) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(details)='object')
);

CREATE INDEX IF NOT EXISTS idx_s23_question_import_events_batch_time
  ON question_import_batch_events(batch_id, occurred_at, id);

CREATE OR REPLACE FUNCTION s23_prevent_question_import_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stage23 question import events are append-only';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s23_question_import_events_append_only ON question_import_batch_events;
CREATE TRIGGER trg_s23_question_import_events_append_only
BEFORE UPDATE OR DELETE ON question_import_batch_events
FOR EACH ROW EXECUTE FUNCTION s23_prevent_question_import_event_mutation();

CREATE OR REPLACE FUNCTION s23_guard_question_import_batch_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.id<>OLD.id
     OR NEW.schema_version<>OLD.schema_version
     OR NEW.pipeline_version<>OLD.pipeline_version
     OR NEW.file_name<>OLD.file_name
     OR NEW.file_type<>OLD.file_type
     OR NEW.raw_object_key<>OLD.raw_object_key
     OR NEW.raw_sha256<>OLD.raw_sha256
     OR NEW.raw_size_bytes<>OLD.raw_size_bytes
     OR NEW.created_by_actor_id<>OLD.created_by_actor_id
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Stage23 question import batch identity and raw provenance are immutable';
  END IF;
  IF NOT (
       NEW.status=OLD.status
    OR (OLD.status='UPLOADED' AND NEW.status IN ('PARSED','FAILED'))
    OR (OLD.status='PARSED' AND NEW.status IN ('PREVIEW_READY','FAILED'))
    OR (OLD.status='PREVIEW_READY' AND NEW.status IN ('COMMITTED','FAILED'))
    OR (OLD.status='COMMITTED' AND NEW.status='ROLLED_BACK')
  ) THEN
    RAISE EXCEPTION 'Invalid Stage23 question import batch state transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s23_question_import_batch_transition ON question_import_batches;
CREATE TRIGGER trg_s23_question_import_batch_transition
BEFORE UPDATE ON question_import_batches
FOR EACH ROW EXECUTE FUNCTION s23_guard_question_import_batch_transition();

INSERT INTO system_versions(component,version,status,source_ref,metadata)
VALUES
  ('stage23.import_pipeline','stage23-import-pipeline-v1.0.0','REVIEW_CANDIDATE','config/stage23_import_pipeline_contract_v1.0.json','{"formats":["CSV_UTF8","XLSX"],"commit":"ATOMIC_DRAFT_ONLY"}'::jsonb),
  ('stage23.import_storage','stage23-import-storage-v1.1.0','REVIEW_CANDIDATE','database/postgres/007_stage23_import_pipeline_v1.1.sql','{"raw_provenance":"OBJECT_KEY_PLUS_SHA256","events":"APPEND_ONLY","compatibility_fix":"STAGE12_IMPORT_BATCHES_PRESERVED"}'::jsonb)
ON CONFLICT(component) DO UPDATE SET
  version=EXCLUDED.version,
  status=EXCLUDED.status,
  source_ref=EXCLUDED.source_ref,
  metadata=EXCLUDED.metadata;
