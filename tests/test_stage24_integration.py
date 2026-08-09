from __future__ import annotations

from pathlib import Path
import sys
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from backend.application import InMemoryLearningStore, LearningApplication
from backend.errors import APIError
from backend.idempotency import InMemoryIdempotencyRegistry
from backend.import_pipeline.pipeline import ImportPipeline, PipelineError

from stage24_fixtures import REFERENCE, csv_bytes, lookup_catalog, question_snapshot, valid_import_row


USER_ID = REFERENCE["user_id"]
OTHER_USER_ID = REFERENCE["other_user_id"]
NOW = REFERENCE["now"]


class Stage24IntegrationTests(unittest.TestCase):
    def _attempt(self, app: LearningApplication):
        test = app.create_test_snapshot(USER_ID, [question_snapshot()], {"mode": "custom"})
        return app.start_attempt(USER_ID, test["id"])

    def test_answer_is_authorized_and_idempotent_with_one_side_effect(self):
        app = LearningApplication(now=lambda: NOW)
        attempt = self._attempt(app)
        question = app.get_next_question(USER_ID, attempt["id"])
        self.assertIsNotNone(question)
        with self.assertRaises(APIError) as forbidden:
            app.get_next_question(OTHER_USER_ID, attempt["id"])
        self.assertEqual(forbidden.exception.status, 404)

        registry = InMemoryIdempotencyRegistry()
        args = {
            "registry": registry,
            "user_id": USER_ID,
            "idempotency_key": "stage24-answer-key-0001",
            "attempt_id": attempt["id"],
            "test_question_id": question["test_question_id"],
            "selected_option_id": question["options"][1]["id"],
            "response_ms": 1200,
            "answered_at": NOW,
        }
        first = app.submit_answer_idempotent(**args)
        replay = app.submit_answer_idempotent(**args)
        self.assertFalse(first.replayed)
        self.assertTrue(replay.replayed)
        self.assertEqual(first.body, replay.body)
        self.assertEqual(len(app.store.answers), 1)
        self.assertEqual(len(app.store.mastery_snapshots), 1)
        self.assertEqual(len(app.store.srs_events), 1)

    def test_answer_transaction_rolls_back_every_projection_on_failure(self):
        def fail_after_mastery():
            raise RuntimeError("stage24 injected failure")

        store = InMemoryLearningStore()
        app = LearningApplication(store=store, now=lambda: NOW, after_mastery_hook=fail_after_mastery)
        attempt = self._attempt(app)
        question = app.get_next_question(USER_ID, attempt["id"])
        with self.assertRaisesRegex(RuntimeError, "injected failure"):
            app.submit_answer(
                USER_ID,
                attempt["id"],
                question["test_question_id"],
                question["options"][1]["id"],
                answered_at=NOW,
            )
        self.assertEqual(store.answers, [])
        self.assertEqual(store.mastery, {})
        self.assertEqual(store.mastery_snapshots, [])
        self.assertEqual(store.review_items, {})
        self.assertEqual(store.srs, {})
        self.assertEqual(store.srs_events, [])

    def test_import_commit_and_rollback_are_atomic_and_audited(self):
        pipeline = ImportPipeline(now=lambda: NOW)
        batch_id = str(uuid.uuid4())
        pipeline.upload(
            file_name="stage24.csv",
            content=csv_bytes([valid_import_row()]),
            actor_id="author-1",
            batch_id=batch_id,
        )
        pipeline.parse(batch_id, actor_id="author-1")
        preview = pipeline.validate_and_preview(
            batch_id, actor_id="author-1", lookups=lookup_catalog()
        )
        self.assertEqual(pipeline.repository.questions, {})
        committed = pipeline.commit(
            batch_id,
            confirmation_token=preview["confirmation_token"],
            actor_id="author-1",
        )
        self.assertEqual(committed["committed_count"], 1)
        self.assertEqual({row["status"] for row in pipeline.repository.questions.values()}, {"DRAFT"})
        rolled_back = pipeline.rollback(
            batch_id, actor_id="author-1", reason="Stage24 deterministic rollback scenario."
        )
        self.assertEqual(rolled_back["rolled_back_count"], 1)
        self.assertEqual(pipeline.repository.questions, {})
        audit = pipeline.batch_audit(batch_id)
        self.assertTrue(audit["raw_retained"])
        self.assertTrue(audit["raw_sha256_verified"])
        self.assertEqual(
            [event["event_type"] for event in audit["events"]],
            ["UPLOADED", "PARSED", "PREVIEWED", "COMMITTED", "ROLLED_BACK"],
        )

    def test_malformed_utf8_fails_closed_without_partial_question_data(self):
        pipeline = ImportPipeline(now=lambda: NOW)
        batch_id = str(uuid.uuid4())
        pipeline.upload(
            file_name="malformed.csv",
            content=b"\xff\xfe\x00stage24",
            actor_id="author-1",
            batch_id=batch_id,
        )
        with self.assertRaises(PipelineError) as caught:
            pipeline.parse(batch_id, actor_id="author-1")
        self.assertEqual(caught.exception.code, "IMPORT_ENCODING_INVALID")
        self.assertEqual(pipeline.repository.batches[batch_id]["status"], "FAILED")
        self.assertEqual(pipeline.repository.questions, {})
        self.assertTrue(pipeline.batch_audit(batch_id)["raw_retained"])


if __name__ == "__main__":
    unittest.main()
