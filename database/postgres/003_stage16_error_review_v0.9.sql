-- Grammar Mastery Platform - Stage 16 additive PostgreSQL patch
-- Patch version: error-review-storage-patch-v0.9.0
-- Base: relational-schema-v0.9.0 + mastery-storage-patch-v0.9.0
-- Additive; raw test/answer history remains unchanged.

CREATE TABLE IF NOT EXISTS error_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_answer_id uuid NOT NULL REFERENCES user_answers(id) ON DELETE RESTRICT,
  test_question_id uuid NOT NULL REFERENCES test_questions(id) ON DELETE RESTRICT,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  lesson_id uuid NOT NULL REFERENCES grammar_lessons(id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES grammar_subtopics(id) ON DELETE RESTRICT,
  misconception_id uuid REFERENCES misconceptions(id) ON DELETE RESTRICT,
  group_key varchar(160) NOT NULL,
  group_quality varchar(30) NOT NULL CHECK(group_quality IN ('MISCONCEPTION','SUBTOPIC_UNMAPPED')),
  difficulty_code difficulty_code NOT NULL,
  wrong_at timestamptz NOT NULL,
  resolution_status varchar(40) NOT NULL CHECK(resolution_status IN ('UNRESOLVED','CORRECTED','EXCLUDED_CONTENT_ISSUE')),
  reviewability varchar(20) NOT NULL CHECK(reviewability IN ('RETRY_ALLOWED','HISTORY_ONLY')),
  marked_for_review boolean NOT NULL DEFAULT false,
  corrected_at timestamptz,
  review_model_version varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_answer_id),
  CHECK((resolution_status='CORRECTED') = (corrected_at IS NOT NULL)),
  CHECK(resolution_status<>'EXCLUDED_CONTENT_ISSUE' OR reviewability='HISTORY_ONLY')
);

CREATE TABLE IF NOT EXISTS error_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_item_id uuid NOT NULL REFERENCES error_review_items(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL CHECK(event_type IN ('ITEM_OPENED','RETRY_SUBMITTED','ANSWER_REVEALED','MARKED_FOR_REVIEW','UNMARKED_FOR_REVIEW','CONTENT_EXCLUDED','CONTENT_REINSTATED')),
  selected_option_id uuid REFERENCES question_options(id) ON DELETE RESTRICT,
  is_correct boolean,
  event_at timestamptz NOT NULL,
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_model_version varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(
    (event_type='RETRY_SUBMITTED' AND selected_option_id IS NOT NULL AND is_correct IS NOT NULL)
    OR
    (event_type<>'RETRY_SUBMITTED' AND is_correct IS NULL)
  )
);

-- Append-only audit of answers excluded from/reinstated to Stage15 mastery evidence.
CREATE TABLE IF NOT EXISTS learning_evidence_exclusion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_answer_id uuid NOT NULL REFERENCES user_answers(id) ON DELETE RESTRICT,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  action varchar(15) NOT NULL CHECK(action IN ('EXCLUDE','REINSTATE')),
  reason_code varchar(50) NOT NULL CHECK(reason_code IN ('CONTENT_AMBIGUITY','INVALID_ITEM','ANSWER_KEY_INVALID','NON_SCORABLE_CONTENT','ISSUE_RESOLVED')),
  actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  event_at timestamptz NOT NULL,
  review_model_version varchar(100) NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_review_user_status_wrong_at
  ON error_review_items(user_id, resolution_status, wrong_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_review_user_group
  ON error_review_items(user_id, group_key, wrong_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_review_filters
  ON error_review_items(user_id, lesson_id, subtopic_id, difficulty_code, wrong_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_review_misconception
  ON error_review_items(user_id, misconception_id, wrong_at DESC) WHERE misconception_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_review_marked
  ON error_review_items(user_id, marked_for_review, resolution_status) WHERE marked_for_review=true;
CREATE INDEX IF NOT EXISTS idx_error_review_events_item_time
  ON error_review_events(review_item_id, event_at, id);
CREATE INDEX IF NOT EXISTS idx_evidence_exclusion_answer_time
  ON learning_evidence_exclusion_events(source_answer_id, event_at, id);

CREATE OR REPLACE VIEW v_error_review_groups AS
SELECT
  user_id,
  group_key,
  max(group_quality) AS group_quality,
  min(misconception_id::text)::uuid AS misconception_id,
  count(*) FILTER (WHERE resolution_status<>'EXCLUDED_CONTENT_ISSUE') AS eligible_wrong_count,
  count(*) FILTER (WHERE resolution_status='UNRESOLVED') AS unresolved_count,
  count(*) FILTER (WHERE resolution_status='CORRECTED') AS corrected_count,
  count(*) FILTER (WHERE resolution_status='EXCLUDED_CONTENT_ISSUE') AS excluded_count,
  count(*) FILTER (WHERE marked_for_review) AS marked_count,
  min(wrong_at) AS first_wrong_at,
  max(wrong_at) AS last_wrong_at,
  CASE
    WHEN bool_or(resolution_status='UNRESOLVED') THEN 'UNRESOLVED'
    WHEN bool_or(resolution_status='CORRECTED') THEN 'CORRECTED'
    ELSE 'EXCLUDED_CONTENT_ISSUE'
  END AS group_resolution
FROM error_review_items
GROUP BY user_id, group_key;

CREATE OR REPLACE VIEW v_learning_evidence_exclusion_state AS
SELECT DISTINCT ON (source_answer_id)
  source_answer_id,
  question_id,
  action,
  reason_code,
  event_at,
  review_model_version
FROM learning_evidence_exclusion_events
ORDER BY source_answer_id, event_at DESC, id DESC;

CREATE OR REPLACE FUNCTION s16_prevent_event_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stage16 review/evidence events are append-only';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_error_review_events_append_only ON error_review_events;
CREATE TRIGGER trg_error_review_events_append_only
BEFORE UPDATE OR DELETE ON error_review_events
FOR EACH ROW EXECUTE FUNCTION s16_prevent_event_history_mutation();

DROP TRIGGER IF EXISTS trg_evidence_exclusion_events_append_only ON learning_evidence_exclusion_events;
CREATE TRIGGER trg_evidence_exclusion_events_append_only
BEFORE UPDATE OR DELETE ON learning_evidence_exclusion_events
FOR EACH ROW EXECUTE FUNCTION s16_prevent_event_history_mutation();
