-- Grammar Mastery Platform - Stage 17 additive SQLite reference patch
-- Patch version: spaced-review-storage-patch-v0.9.0
-- Apply once after Stage15/Stage16 reference patches.

ALTER TABLE review_queue ADD COLUMN learning_state TEXT CHECK(learning_state IS NULL OR learning_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED'));
ALTER TABLE review_queue ADD COLUMN success_streak INTEGER NOT NULL DEFAULT 0 CHECK(success_streak>=0);
ALTER TABLE review_queue ADD COLUMN state_before_suspend TEXT CHECK(state_before_suspend IS NULL OR state_before_suspend IN ('NEW','LEARNING','REVIEW','LAPSED'));
ALTER TABLE review_queue ADD COLUMN suspended_reason TEXT;
ALTER TABLE review_queue ADD COLUMN last_scheduled_at TEXT;
ALTER TABLE review_queue ADD COLUMN scheduler_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scheduler_metadata));

CREATE UNIQUE INDEX uq_s17_user_subtopic_queue
  ON review_queue(user_id, subtopic_id)
  WHERE target_type='SUBTOPIC' AND subtopic_id IS NOT NULL AND learning_state IS NOT NULL;
CREATE INDEX idx_s17_due_queue
  ON review_queue(user_id, due_at, learning_state)
  WHERE target_type='SUBTOPIC' AND learning_state IS NOT NULL AND learning_state<>'SUSPENDED';

CREATE TRIGGER trg_s17_review_queue_validate_insert
BEFORE INSERT ON review_queue
WHEN NEW.learning_state IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.target_type<>'SUBTOPIC' OR NEW.subtopic_id IS NULL
    THEN RAISE(ABORT,'Stage17 queue rows must target SUBTOPIC') END;
  SELECT CASE WHEN NEW.learning_state='SUSPENDED' AND (NEW.status<>'SUSPENDED' OR NEW.suspended_reason IS NULL)
    THEN RAISE(ABORT,'Suspended Stage17 row requires SUSPENDED status and reason') END;
  SELECT CASE WHEN NEW.learning_state<>'SUSPENDED' AND NEW.status NOT IN ('SCHEDULED','DUE')
    THEN RAISE(ABORT,'Active Stage17 row status must be SCHEDULED or DUE') END;
END;

CREATE TRIGGER trg_s17_review_queue_validate_update
BEFORE UPDATE OF learning_state,status,target_type,subtopic_id,suspended_reason ON review_queue
WHEN NEW.learning_state IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.target_type<>'SUBTOPIC' OR NEW.subtopic_id IS NULL
    THEN RAISE(ABORT,'Stage17 queue rows must target SUBTOPIC') END;
  SELECT CASE WHEN NEW.learning_state='SUSPENDED' AND (NEW.status<>'SUSPENDED' OR NEW.suspended_reason IS NULL)
    THEN RAISE(ABORT,'Suspended Stage17 row requires SUSPENDED status and reason') END;
  SELECT CASE WHEN NEW.learning_state<>'SUSPENDED' AND NEW.status NOT IN ('SCHEDULED','DUE')
    THEN RAISE(ABORT,'Active Stage17 row status must be SCHEDULED or DUE') END;
END;

CREATE TABLE spaced_review_events (
  id TEXT PRIMARY KEY,
  review_queue_id TEXT NOT NULL REFERENCES review_queue(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subtopic_id TEXT NOT NULL REFERENCES grammar_subtopics(id) ON DELETE RESTRICT,
  source_answer_id TEXT REFERENCES user_answers(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('ANSWER_SCHEDULED','EVIDENCE_REPLAY_ADJUSTED','CONCEPT_SUSPENDED','CONCEPT_RESUMED','DIVERSITY_FALLBACK')),
  from_state TEXT CHECK(from_state IS NULL OR from_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED')),
  to_state TEXT CHECK(to_state IS NULL OR to_state IN ('NEW','LEARNING','REVIEW','LAPSED','SUSPENDED')),
  interval_before_days NUMERIC CHECK(interval_before_days IS NULL OR interval_before_days>=0),
  interval_after_days NUMERIC CHECK(interval_after_days IS NULL OR interval_after_days>=0),
  due_before TEXT,
  due_after TEXT,
  mastery_band TEXT CHECK(mastery_band IS NULL OR mastery_band IN ('NO_EVIDENCE','UNCERTAIN','WEAK','DEVELOPING','STRONG')),
  mastery_confidence NUMERIC CHECK(mastery_confidence IS NULL OR mastery_confidence BETWEEN 0 AND 1),
  mastery_model_version TEXT,
  scheduler_version TEXT NOT NULL,
  event_at TEXT NOT NULL,
  event_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(event_metadata)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_s17_events_queue_time ON spaced_review_events(review_queue_id, event_at, id);
CREATE INDEX idx_s17_events_user_subtopic_time ON spaced_review_events(user_id, subtopic_id, event_at DESC);
CREATE INDEX idx_s17_events_source_answer ON spaced_review_events(source_answer_id) WHERE source_answer_id IS NOT NULL;

CREATE VIEW v_spaced_review_due AS
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
  CASE WHEN julianday(rq.due_at)<=julianday('now') THEN 1 ELSE 0 END AS is_due,
  CASE rq.learning_state WHEN 'LAPSED' THEN 1 WHEN 'LEARNING' THEN 2 WHEN 'REVIEW' THEN 3 WHEN 'NEW' THEN 4 ELSE 9 END AS state_priority
FROM review_queue rq
WHERE rq.target_type='SUBTOPIC'
  AND rq.learning_state IS NOT NULL
  AND rq.learning_state<>'SUSPENDED';

CREATE TRIGGER trg_s17_events_no_update BEFORE UPDATE ON spaced_review_events
BEGIN SELECT RAISE(ABORT,'spaced_review_events is append-only'); END;
CREATE TRIGGER trg_s17_events_no_delete BEFORE DELETE ON spaced_review_events
BEGIN SELECT RAISE(ABORT,'spaced_review_events cannot be hard-deleted'); END;
