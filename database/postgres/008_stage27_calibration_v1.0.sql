-- Grammar Mastery Platform — Stage 27 additive calibration storage
-- Migration: 008_stage27_calibration_v1.0.sql | PostgreSQL 15+
-- Requires canonical Stage26 sequence ending in 007_stage23_import_pipeline_v1.1.sql.
-- Additive only: historical answers, mastery snapshots, question revisions and QA events are never rewritten.

CREATE TABLE IF NOT EXISTS calibration_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component varchar(40) NOT NULL CHECK(component IN ('DIFFICULTY','ADAPTIVE_SELECTOR','ADAPTIVE_SCORE','MASTERY','SRS','TCF_WEIGHT')),
  version varchar(120) NOT NULL,
  parent_version varchar(120),
  payload_sha256 char(64),
  status varchar(20) NOT NULL CHECK(status IN ('CANDIDATE','ACTIVE','RETIRED')),
  rationale text NOT NULL,
  source_experiment_id uuid,
  effective_at timestamptz,
  retired_at timestamptz,
  created_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(component,version)
);

CREATE TABLE IF NOT EXISTS answer_calibration_context (
  user_answer_id uuid PRIMARY KEY REFERENCES user_answers(id) ON DELETE RESTRICT,
  mastery_before_score numeric(6,3) CHECK(mastery_before_score BETWEEN 0 AND 100),
  mastery_before_confidence numeric(5,4) CHECK(mastery_before_confidence BETWEEN 0 AND 1),
  mastery_model_version varchar(120),
  selection_model_version varchar(120),
  difficulty_model_version varchar(120),
  scheduler_version varchar(120),
  repeat_error_flag boolean NOT NULL DEFAULT false,
  context_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  cohort_key varchar(100) NOT NULL DEFAULT 'ALL',
  sample_size int NOT NULL CHECK(sample_size>=0),
  correct_rate numeric(7,6) CHECK(correct_rate BETWEEN 0 AND 1),
  median_response_ms numeric CHECK(median_response_ms>=0),
  p90_response_ms numeric CHECK(p90_response_ms>=0),
  discrimination numeric(7,6) CHECK(discrimination BETWEEN -1 AND 1),
  report_rate numeric(7,6) CHECK(report_rate BETWEEN 0 AND 1),
  repeat_error_rate numeric(7,6) CHECK(repeat_error_rate BETWEEN 0 AND 1),
  option_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  metric_version varchar(120) NOT NULL,
  source_query_version varchar(120) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CHECK(window_end>window_start),
  UNIQUE(question_id,window_start,window_end,cohort_key,metric_version)
);

CREATE TABLE IF NOT EXISTS calibration_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  metric_snapshot_id uuid NOT NULL REFERENCES question_metric_snapshots(id) ON DELETE RESTRICT,
  decision_type varchar(40) NOT NULL CHECK(decision_type IN ('OPEN_REVIEW','DIFFICULTY_CHANGE_CANDIDATE','RETIREMENT_CANDIDATE','KEEP','NO_DECISION_INSUFFICIENT_DATA')),
  status varchar(20) NOT NULL CHECK(status IN ('PROPOSED','APPROVED','REJECTED','APPLIED','CANCELLED')),
  previous_difficulty difficulty_code,
  proposed_difficulty difficulty_code,
  trigger_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text NOT NULL,
  decided_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  applied_question_revision_id uuid REFERENCES questions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  applied_at timestamptz,
  CHECK(decision_type<>'RETIREMENT_CANDIDATE' OR status<>'APPLIED' OR applied_question_revision_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS calibration_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) NOT NULL UNIQUE,
  hypothesis text NOT NULL,
  primary_metric varchar(80) NOT NULL,
  guardrails jsonb NOT NULL,
  baseline_model_version varchar(120) NOT NULL,
  candidate_model_version varchar(120) NOT NULL,
  candidate_traffic_share numeric(5,4) NOT NULL CHECK(candidate_traffic_share>0 AND candidate_traffic_share<=0.25),
  minimum_duration_days int NOT NULL CHECK(minimum_duration_days>=14),
  minimum_observations_per_arm int NOT NULL CHECK(minimum_observations_per_arm>=200),
  status varchar(20) NOT NULL CHECK(status IN ('DRAFT','READY','RUNNING','STOPPED','ANALYZED','ACCEPTED','REJECTED')),
  owner_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(baseline_model_version<>candidate_model_version)
);

ALTER TABLE calibration_model_versions
  DROP CONSTRAINT IF EXISTS fk_s27_model_source_experiment;
ALTER TABLE calibration_model_versions
  ADD CONSTRAINT fk_s27_model_source_experiment FOREIGN KEY(source_experiment_id) REFERENCES calibration_experiments(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS calibration_experiment_assignments (
  experiment_id uuid NOT NULL REFERENCES calibration_experiments(id) ON DELETE RESTRICT,
  subject_hash char(64) NOT NULL,
  arm varchar(20) NOT NULL CHECK(arm IN ('BASELINE','CANDIDATE')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(experiment_id,subject_hash)
);

CREATE TABLE IF NOT EXISTS calibration_experiment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES calibration_experiments(id) ON DELETE RESTRICT,
  arm varchar(20) NOT NULL CHECK(arm IN ('BASELINE','CANDIDATE')),
  sample_size int NOT NULL CHECK(sample_size>=0),
  primary_metric_value numeric,
  guardrail_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis_version varchar(120) NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CHECK(window_end>window_start),
  UNIQUE(experiment_id,arm,analysis_version,window_start,window_end)
);

CREATE INDEX IF NOT EXISTS idx_s27_metric_question_window ON question_metric_snapshots(question_id,window_end DESC);
CREATE INDEX IF NOT EXISTS idx_s27_decisions_status ON calibration_decisions(status,decision_type,created_at);
CREATE INDEX IF NOT EXISTS idx_s27_experiment_status ON calibration_experiments(status,created_at);

CREATE OR REPLACE VIEW v_question_calibration_current AS
SELECT DISTINCT ON (s.question_id) s.*
FROM question_metric_snapshots s
ORDER BY s.question_id,s.window_end DESC,s.computed_at DESC;
