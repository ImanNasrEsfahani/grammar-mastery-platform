-- Grammar Mastery Platform - Stage 16 additive SQLite reference patch
-- Patch version: error-review-storage-patch-v0.9.0
-- Base: sqlite-reference-v0.9.0; compatible after Stage15 additive patch.

CREATE TABLE error_review_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_answer_id TEXT NOT NULL REFERENCES user_answers(id) ON DELETE RESTRICT,
  test_question_id TEXT NOT NULL REFERENCES test_questions(id) ON DELETE RESTRICT,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  lesson_id TEXT NOT NULL REFERENCES grammar_lessons(id) ON DELETE RESTRICT,
  subtopic_id TEXT NOT NULL REFERENCES grammar_subtopics(id) ON DELETE RESTRICT,
  misconception_id TEXT REFERENCES misconceptions(id) ON DELETE RESTRICT,
  group_key TEXT NOT NULL,
  group_quality TEXT NOT NULL CHECK(group_quality IN ('MISCONCEPTION','SUBTOPIC_UNMAPPED')),
  difficulty_code TEXT NOT NULL CHECK(difficulty_code IN ('EASY','MEDIUM','HARD','VERY_HARD')),
  wrong_at TEXT NOT NULL,
  resolution_status TEXT NOT NULL CHECK(resolution_status IN ('UNRESOLVED','CORRECTED','EXCLUDED_CONTENT_ISSUE')),
  reviewability TEXT NOT NULL CHECK(reviewability IN ('RETRY_ALLOWED','HISTORY_ONLY')),
  marked_for_review INTEGER NOT NULL DEFAULT 0 CHECK(marked_for_review IN (0,1)),
  corrected_at TEXT,
  review_model_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, source_answer_id),
  CHECK((resolution_status='CORRECTED' AND corrected_at IS NOT NULL) OR (resolution_status<>'CORRECTED' AND corrected_at IS NULL)),
  CHECK(resolution_status<>'EXCLUDED_CONTENT_ISSUE' OR reviewability='HISTORY_ONLY')
);

CREATE TABLE error_review_events (
  id TEXT PRIMARY KEY,
  review_item_id TEXT NOT NULL REFERENCES error_review_items(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('ITEM_OPENED','RETRY_SUBMITTED','ANSWER_REVEALED','MARKED_FOR_REVIEW','UNMARKED_FOR_REVIEW','CONTENT_EXCLUDED','CONTENT_REINSTATED')),
  selected_option_id TEXT REFERENCES question_options(id) ON DELETE RESTRICT,
  is_correct INTEGER CHECK(is_correct IS NULL OR is_correct IN (0,1)),
  event_at TEXT NOT NULL,
  event_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(event_metadata)),
  review_model_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(
    (event_type='RETRY_SUBMITTED' AND selected_option_id IS NOT NULL AND is_correct IS NOT NULL)
    OR
    (event_type<>'RETRY_SUBMITTED' AND is_correct IS NULL)
  )
);

CREATE TABLE learning_evidence_exclusion_events (
  id TEXT PRIMARY KEY,
  source_answer_id TEXT NOT NULL REFERENCES user_answers(id) ON DELETE RESTRICT,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('EXCLUDE','REINSTATE')),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('CONTENT_AMBIGUITY','INVALID_ITEM','ANSWER_KEY_INVALID','NON_SCORABLE_CONTENT','ISSUE_RESOLVED')),
  actor_id TEXT REFERENCES actors(id) ON DELETE RESTRICT,
  event_at TEXT NOT NULL,
  review_model_version TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_error_review_user_status_wrong_at ON error_review_items(user_id, resolution_status, wrong_at DESC);
CREATE INDEX idx_error_review_user_group ON error_review_items(user_id, group_key, wrong_at DESC);
CREATE INDEX idx_error_review_filters ON error_review_items(user_id, lesson_id, subtopic_id, difficulty_code, wrong_at DESC);
CREATE INDEX idx_error_review_misconception ON error_review_items(user_id, misconception_id, wrong_at DESC) WHERE misconception_id IS NOT NULL;
CREATE INDEX idx_error_review_marked ON error_review_items(user_id, marked_for_review, resolution_status) WHERE marked_for_review=1;
CREATE INDEX idx_error_review_events_item_time ON error_review_events(review_item_id, event_at, id);
CREATE INDEX idx_evidence_exclusion_answer_time ON learning_evidence_exclusion_events(source_answer_id, event_at, id);

CREATE VIEW v_error_review_groups AS
SELECT
  user_id,
  group_key,
  max(group_quality) AS group_quality,
  max(misconception_id) AS misconception_id,
  sum(CASE WHEN resolution_status<>'EXCLUDED_CONTENT_ISSUE' THEN 1 ELSE 0 END) AS eligible_wrong_count,
  sum(CASE WHEN resolution_status='UNRESOLVED' THEN 1 ELSE 0 END) AS unresolved_count,
  sum(CASE WHEN resolution_status='CORRECTED' THEN 1 ELSE 0 END) AS corrected_count,
  sum(CASE WHEN resolution_status='EXCLUDED_CONTENT_ISSUE' THEN 1 ELSE 0 END) AS excluded_count,
  sum(CASE WHEN marked_for_review=1 THEN 1 ELSE 0 END) AS marked_count,
  min(wrong_at) AS first_wrong_at,
  max(wrong_at) AS last_wrong_at,
  CASE
    WHEN sum(CASE WHEN resolution_status='UNRESOLVED' THEN 1 ELSE 0 END)>0 THEN 'UNRESOLVED'
    WHEN sum(CASE WHEN resolution_status='CORRECTED' THEN 1 ELSE 0 END)>0 THEN 'CORRECTED'
    ELSE 'EXCLUDED_CONTENT_ISSUE'
  END AS group_resolution
FROM error_review_items
GROUP BY user_id, group_key;

CREATE VIEW v_learning_evidence_exclusion_state AS
SELECT e.source_answer_id, e.question_id, e.action, e.reason_code, e.event_at, e.review_model_version
FROM learning_evidence_exclusion_events e
WHERE e.id = (
  SELECT e2.id FROM learning_evidence_exclusion_events e2
  WHERE e2.source_answer_id=e.source_answer_id
  ORDER BY e2.event_at DESC, e2.id DESC LIMIT 1
);

CREATE TRIGGER trg_error_review_events_no_update BEFORE UPDATE ON error_review_events
BEGIN SELECT RAISE(ABORT,'error_review_events is append-only'); END;
CREATE TRIGGER trg_error_review_events_no_delete BEFORE DELETE ON error_review_events
BEGIN SELECT RAISE(ABORT,'error_review_events cannot be hard-deleted'); END;
CREATE TRIGGER trg_evidence_exclusion_events_no_update BEFORE UPDATE ON learning_evidence_exclusion_events
BEGIN SELECT RAISE(ABORT,'learning_evidence_exclusion_events is append-only'); END;
CREATE TRIGGER trg_evidence_exclusion_events_no_delete BEFORE DELETE ON learning_evidence_exclusion_events
BEGIN SELECT RAISE(ABORT,'learning_evidence_exclusion_events cannot be hard-deleted'); END;
