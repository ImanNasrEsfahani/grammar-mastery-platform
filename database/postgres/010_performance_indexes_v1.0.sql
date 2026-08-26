-- Grammar Mastery Platform — additive performance hotfix
-- Version: runtime-performance-indexes-v1.0.0 | PostgreSQL 15+
-- IMPORTANT: CREATE INDEX CONCURRENTLY must not run inside an explicit transaction.

-- Dashboard: latest completed attempt and completed-attempt counts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_test_attempts_user_completed
  ON test_attempts(user_id, completed_at DESC, id DESC)
  WHERE status = 'COMPLETED';

-- Dashboard: most recent in-progress attempt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_test_attempts_user_in_progress
  ON test_attempts(user_id, started_at DESC, id DESC)
  WHERE status = 'IN_PROGRESS';

-- Dashboard trend: latest persisted mastery snapshots regardless of model version.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_mastery_snapshots_user_time
  ON mastery_snapshots(user_id, captured_at DESC, id DESC);

-- Dashboard activity count for completed mistake-review retries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_error_review_events_user_type
  ON error_review_events(user_id, event_type);

-- Dashboard/review due-state aggregation, including suspended concept rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_review_queue_user_state_due
  ON review_queue(user_id, learning_state, due_at)
  WHERE target_type = 'SUBTOPIC';

-- Auth fast path already has primary-key/session and active-role indexes from
-- Stage 21; no duplicate auth index is added here.

INSERT INTO system_versions(component, version, status, source_ref, metadata)
VALUES (
  'runtime.performance_indexes',
  'runtime-performance-indexes-v1.0.0',
  'APPLIED',
  'database/postgres/010_performance_indexes_v1.0.sql',
  '{"purpose":"dashboard/auth latency hotfix","online_indexes":true}'::jsonb
)
ON CONFLICT(component) DO UPDATE
SET version = EXCLUDED.version,
    status = EXCLUDED.status,
    source_ref = EXCLUDED.source_ref,
    metadata = EXCLUDED.metadata;
