from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from backend.application import LearningApplication
from backend.errors import APIError
from backend.idempotency import InMemoryIdempotencyRegistry
from backend.projections import find_forbidden_preanswer_fields
from backend.security import InMemoryAuthService, PasswordHasher

from stage24_fixtures import REFERENCE, question_snapshot


NOW = REFERENCE["now"]
NOW_DT = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)


class Stage24EndToEndTests(unittest.TestCase):
    def test_register_create_answer_result_and_review_journey(self):
        auth = InMemoryAuthService(
            signing_secret=b"stage24-reference-signing-secret-000000000000",
            now=lambda: NOW_DT,
            hasher=PasswordHasher(iterations=100000),
        )
        user = auth.register("learner.stage24@example.test", "Stage24-safe-passphrase", "Stage 24")
        session = auth.login("learner.stage24@example.test", "Stage24-safe-passphrase")
        principal = auth.authenticate(f"Bearer {session['access_token']}")
        self.assertEqual(principal.user_id, user["id"])

        app = LearningApplication(now=lambda: NOW)
        test = app.create_test_snapshot(
            principal.user_id,
            [question_snapshot()],
            {"mode": "custom", "title": "Stage24 synthetic E2E"},
        )
        attempt = app.start_attempt(principal.user_id, test["id"])
        question = app.get_next_question(principal.user_id, attempt["id"])
        self.assertEqual(find_forbidden_preanswer_fields(question), [])

        receipt = app.submit_answer_idempotent(
            InMemoryIdempotencyRegistry(),
            principal.user_id,
            "stage24-e2e-answer-0001",
            attempt["id"],
            question["test_question_id"],
            question["options"][1]["id"],
            response_ms=1200,
            answered_at=NOW,
        ).body
        self.assertFalse(receipt["feedback"]["is_correct"])
        self.assertIsNotNone(receipt["review_item_id"])
        self.assertIsNone(app.get_next_question(principal.user_id, attempt["id"]))

        completed = app.complete_attempt(principal.user_id, attempt["id"])
        result = app.get_result(principal.user_id, attempt["id"])
        self.assertEqual(completed["status"], "COMPLETED")
        self.assertEqual(result["score_raw"], 0)
        self.assertEqual(result["score_pct"], 0.0)
        self.assertEqual(len(result["breakdown"]), 1)

        groups_before = app.list_review_groups(principal.user_id)
        self.assertEqual(groups_before[0]["unresolved_count"], 1)
        corrected = app.grade_review(
            principal.user_id,
            receipt["review_item_id"],
            question_snapshot()["correct_option_id"],
            event_at=NOW,
        )
        self.assertTrue(corrected["feedback"]["is_correct"])
        self.assertEqual(corrected["review_item"]["resolution_status"], "CORRECTED")
        self.assertEqual(app.list_review_groups(principal.user_id)[0]["unresolved_count"], 0)

        dashboard = app.get_dashboard(principal.user_id, as_of=NOW)
        self.assertEqual(dashboard["activity"]["questions_answered"], 1)
        self.assertEqual(dashboard["activity"]["tests_completed"], 1)
        self.assertEqual(dashboard["activity"]["reviews_completed"], 1)

        auth.logout(f"Bearer {session['access_token']}")
        with self.assertRaises(APIError) as revoked:
            auth.authenticate(f"Bearer {session['access_token']}")
        self.assertEqual(revoked.exception.code, "SESSION_REVOKED")


if __name__ == "__main__":
    unittest.main()
