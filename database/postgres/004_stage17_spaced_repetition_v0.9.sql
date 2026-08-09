-- Grammar Mastery Platform - Stage 17 additive PostgreSQL patch
-- Patch version: spaced-review-storage-patch-v0.9.0
-- Base: relational-schema-v0.9.0 + Stage15 mastery + Stage16 error review.
-- Stage17 schedules SUBTOPIC concepts. Existing QUESTION rows remain historical/legacy.

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS learning_state varchar(16),
  ADD COLUMN IF NOT EXISTS success_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state_before_suspend varchar(16),
  ADD COLUMN IF NOT EXISTS suspended_reason varchar(80),
  ADD COLUMN IF NOT EXISTS last_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduler_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='s17_review_queue_learning_state_chk') THEN
    ALTER TABLE review_queue ADD CONSTRAINT s17_review_queue_learning_state_chk
      CHECK(learning_state IS NULL OR learning_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='s17_review_queue_prior_state_chk') THEN
    ALTER TABLE review_queue ADD CONSTRAINT s17_review_queue_prior_state_chk
      CHECK(state_before_suspend IS NULL OR state_before_suspend IN ('NEW','LEARNING','REVIEW','LAPSED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='s17_review_queue_streak_chk') THEN
    ALTER TABLE review_queue ADD CONSTRAINT s17_review_queue_streak_chk CHECK(success_streak>=0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='s17_review_queue_concept_scope_chk') THEN
    ALTER TABLE review_queue ADD CONSTRAINT s17_review_queue_concept_scope_chk
      CHECK(learning_state IS NULL OR (target_type='SUBTOPIC' AND subtopic_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='s17_review_queue_suspend_chk') THEN
    ALTER TABLE review_queue ADD CONSTRAINT s17_review_queue_suspend_chk
      CHECK(
        learning_state IS NULL OR
        (learning_state='SUSPENDED' AND status='SUSPENDED' AND suspended_reason IS NOT NULL) OR
        (learning_state<>'SUSPENDED' AND status IN ('SCHEDULED','DUE'))
      );
  END IF;
END $$;

-- One current concept schedule per user. Scheduler-version upgrades update this row;
-- historical transitions live in spaced_review_events.
CREATE UNIQUE INDEX IF NOT EXISTS uq_s17_user_subtopic_queue
  ON review_queue(user_id, subtopic_id)
  WHERE target_type='SUBTOPIC' AND subtopic_id IS NOT NULL AND learning_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_s17_due_queue
  ON review_queue(user_id, due_at, learning_state)
  WHERE target_type='SUBTOPIC' AND learning_state IS NOT NULL AND learning_state<>'SUSPENDED';

CREATE TABLE IF NOT EXISTS spaced_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_queue_id uuid NOT NULL REFERENCES review_queue(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subtopic_id uuid NOT NULL REFERENCES grammar_subtopics(id) ON DELETE RESTRICT,
  source_answer_id uuid REFERENCES user_answers(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL CHECK(event_type IN (
    'ANSWER_SCHEDULED',
    'EVIDENCE_REPLAY_ADJUSTED',
    'CONCEPT_SUSPENDED',
    'CONCEPT_RESUMED',
    'DIVERSITY_FALLBACK'
  )),
  from_state varchar(16) CHECK(from_state IS NULL OR from_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED')),
  to_state varchar(16) CHECK(to_state IS NULL OR to_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED')),
  interval_before_days numeric(8,2) CHECK(interval_before_days IS NULL OR interval_before_days>=0),
  interval_after_days numeric(8,2) CHECK(interval_after_days IS NULL OR interval_after_days>=0),
  due_before timestamptz,
  due_after timestamptz,
  mastery_band varchar(20) CHECK(mastery_band IS NULL OR mastery_band IN ('NO_EVIDENCE','UNCERTAIN','WEAK','DEVELOPING','STRONG')),
  mastery_confidence numeric(5,4) CHECK(mastery_confidence IS NULL OR mastery_confidence BETWEEN 0 AND 1),
  mastery_model_version varchar(100),
  scheduler_version varchar(100) NOT NULL,
  event_at timestamptz NOT NULL,
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_s17_events_queue_time
  ON spaced_review_events(review_queue_id, event_at, id);
CREATE INDEX IF NOT EXISTS idx_s17_events_user_subtopic_time
  ON spaced_review_events(user_id, subtopic_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_s17_events_source_answer
  ON spaced_review_events(source_answer_id) WHERE source_answer_id IS NOT NULL;

CREATE OR REPLACE VIEW v_spaced_review_due AS
SELECT
  rq.id AS review_queue_id,
  rq.user_id,
  rq.subtopic_id,
  rq.learning_state,
  rq.due_at,
  rq.interval_days,
  rq.lapse_count,
  rq.success_streak,
  rq.scheduler_version,
  (rq.due_at<=now()) AS is_due,
  CASE rq.learning_state
    WHEN 'LAPSED' THEN 1
    WHEN 'LEARNING' THEN 2
    WHEN 'REVIEW' THEN 3
    WHEN 'NEW' THEN 4
    ELSE 9
  END AS state_priority
FROM review_queue rq
WHERE rq.target_type='SUBTOPIC'
  AND rq.learning_state IS NOT NULL
  AND rq.learning_state<>'SUSPENDED';

CREATE OR REPLACE FUNCTION s17_prevent_event_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stage17 spaced review events are append-only';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_s17_events_append_only ON spaced_review_events;
CREATE TRIGGER trg_s17_events_append_only
BEFORE UPDATE OR DELETE ON spaced_review_events
FOR EACH ROW EXECUTE FUNCTION s17_prevent_event_history_mutation();
