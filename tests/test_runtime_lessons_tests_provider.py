from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings"
)

import django

django.setup()

from backend.django_adapter import runtime_learning
from backend.django_adapter.views import ContractEndpointView
from backend.errors import APIError
from backend.security import Principal


USER_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


class RuntimeLessonsTestsProviderTests(unittest.TestCase):
    def test_iso_uses_standard_library_utc_on_django_52(self):
        value = datetime(
            2026,
            8,
            13,
            1,
            3,
            45,
            tzinfo=timezone(timedelta(hours=-7)),
        )
        self.assertEqual(runtime_learning._iso(value), "2026-08-13T08:03:45Z")

    def test_frontend_adaptive_payload_validates(self):
        payload = runtime_learning._validate_test_payload(
            {
                "schema_version": "adaptive-selection-config-v0.9.0",
                "mode": "adaptive",
                "question_count": 10,
                "scope": {"all_active_lessons": True},
                "difficulty_mix_pct": {
                    "EASY": 20,
                    "MEDIUM": 40,
                    "HARD": 30,
                    "VERY_HARD": 10,
                },
            }
        )
        self.assertEqual(payload["mode"], "adaptive")
        self.assertEqual(payload["question_count"], 10)

    def test_scope_all_active_lessons_becomes_stable_uuid_clause(self):
        resolved = runtime_learning._normalize_scope(
            {"all_active_lessons": True},
            [LESSON_ID],
        )
        self.assertEqual(resolved["combine"], "AND")
        self.assertEqual(resolved["clauses"][0]["dimension"], "LESSON")
        self.assertEqual(resolved["clauses"][0]["ids"], [LESSON_ID])

    def test_scope_selected_lessons_becomes_stable_uuid_clause(self):
        second_lesson_id = "33333333-3333-4333-8333-333333333333"
        resolved = runtime_learning._normalize_scope(
            {"lesson_ids": [LESSON_ID, second_lesson_id]},
            [LESSON_ID, second_lesson_id],
        )
        self.assertEqual(resolved["clauses"][0]["dimension"], "LESSON")
        self.assertEqual(resolved["clauses"][0]["ids"], [LESSON_ID, second_lesson_id])

    def test_lesson_projection_includes_related_group_titles(self):
        projected = runtime_learning._lesson_projection(
            (
                LESSON_ID,
                1,
                "Les temps du passé",
                "Temps du passé",
                "33333333-3333-4333-8333-333333333333",
                "44444444-4444-4444-8444-444444444444",
                "Temps et modes",
                "زمان‌ها و وجه‌ها",
                "Temps du passé",
                "زمان‌های گذشته",
                1.0,
                True,
                37,
            )
        )
        self.assertEqual(projected["subcategory_title_fa"], "زمان‌های گذشته")
        self.assertEqual(projected["question_count"], 37)

    def test_scope_matching_supports_tags(self):
        candidate = {
            "lesson_id": LESSON_ID,
            "tag_ids": [
                "33333333-3333-4333-8333-333333333333",
                "44444444-4444-4444-8444-444444444444",
            ],
        }
        scope = {
            "combine": "AND",
            "clauses": [
                {"dimension": "LESSON", "ids": [LESSON_ID]},
                {
                    "dimension": "TAG",
                    "ids": ["33333333-3333-4333-8333-333333333333"],
                    "tag_match": "ANY",
                },
            ],
        }
        self.assertTrue(runtime_learning._matches_scope(candidate, scope))

    def test_review_mode_remains_explicit_dependency_boundary(self):
        principal = Principal(
            user_id=USER_ID,
            session_id="55555555-5555-4555-8555-555555555555",
            roles=("USER",),
            token_id="66666666-6666-4666-8666-666666666666",
        )
        request = SimpleNamespace(
            auth=principal,
            data={
                "schema_version": "test-config-schema-v0.9.0",
                "mode": "review",
                "question_count": 10,
                "scope": {"all_active_lessons": True},
                "difficulty_mix_pct": {
                    "EASY": 20,
                    "MEDIUM": 40,
                    "HARD": 30,
                    "VERY_HARD": 10,
                },
            },
        )
        with self.assertRaises(APIError) as raised:
            runtime_learning.create_test_request(request)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.code, "DEPENDENCY_UNAVAILABLE")

    def test_list_lessons_operation_is_bound(self):
        request = SimpleNamespace(method="GET")
        view = ContractEndpointView()
        view.operations = {"GET": "listLessons"}
        expected = SimpleNamespace(status_code=200)
        with patch.object(
            runtime_learning,
            "list_lessons_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request)
        self.assertIs(result, expected)
        handler.assert_called_once_with(request)

    def test_get_lesson_operation_passes_path_id(self):
        request = SimpleNamespace(method="GET")
        view = ContractEndpointView()
        view.operations = {"GET": "getLesson"}
        expected = SimpleNamespace(status_code=200)
        with patch.object(
            runtime_learning,
            "lesson_detail_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request, lessonId=LESSON_ID)
        self.assertIs(result, expected)
        handler.assert_called_once_with(request, lesson_id=LESSON_ID)

    def test_create_test_operation_is_bound(self):
        request = SimpleNamespace(method="POST")
        view = ContractEndpointView()
        view.operations = {"POST": "createTest"}
        expected = SimpleNamespace(status_code=201)
        with patch.object(
            runtime_learning,
            "create_test_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request)
        self.assertIs(result, expected)
        handler.assert_called_once_with(request)

    def test_complete_attempt_cycle_operations_are_bound(self):
        cases = (
            ("POST", "startAttempt", "start_attempt_request", {"testId": LESSON_ID}, {"test_id": LESSON_ID}),
            ("GET", "getNextAttemptQuestion", "next_attempt_question_request", {"attemptId": LESSON_ID}, {"attempt_id": LESSON_ID}),
            ("POST", "submitAttemptAnswer", "submit_attempt_answer_request", {"attemptId": LESSON_ID}, {"attempt_id": LESSON_ID}),
            ("POST", "completeAttempt", "complete_attempt_request", {"attemptId": LESSON_ID}, {"attempt_id": LESSON_ID}),
            ("GET", "getAttemptResult", "attempt_result_request", {"attemptId": LESSON_ID}, {"attempt_id": LESSON_ID}),
        )
        for method, operation, provider, path_kwargs, call_kwargs in cases:
            with self.subTest(operation=operation):
                request = SimpleNamespace(method=method)
                view = ContractEndpointView()
                view.operations = {method: operation}
                expected = SimpleNamespace(status_code=200)
                with patch.object(runtime_learning, provider, return_value=expected) as handler:
                    result = view._dispatch_contract(request, **path_kwargs)
                self.assertIs(result, expected)
                handler.assert_called_once_with(request, **call_kwargs)

    def test_review_collection_operation_is_bound(self):
        request = SimpleNamespace(method="GET")
        view = ContractEndpointView()
        view.operations = {"GET": "listReviews"}
        expected = SimpleNamespace(status_code=200)
        with patch.object(
            runtime_learning,
            "list_reviews_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request)
        self.assertIs(result, expected)
        handler.assert_called_once_with(request)

    def test_attempt_question_projection_never_leaks_answer_key(self):
        snapshot = {
            "question_revision_id": LESSON_ID,
            "stem": "Choisissez la bonne réponse.",
            "stem_locale": "fr-FR",
            "question_type": "MCQ",
            "difficulty": "EASY",
            "correct_option_id": "33333333-3333-4333-8333-333333333333",
            "full_explanation": "secret",
        }
        options = [
            {"id": f"33333333-3333-4333-8333-33333333333{i}", "position": p, "text": p, "explanation": "secret"}
            for i, p in enumerate(("A", "B", "C", "D"))
        ]
        public = runtime_learning._public_attempt_question(LESSON_ID, 1, snapshot, options)
        serialized = str(public)
        self.assertNotIn("correct_option_id", serialized)
        self.assertNotIn("explanation", serialized)

    def test_other_runtime_operation_still_fails_closed(self):
        request = SimpleNamespace(method="GET")
        view = ContractEndpointView()
        view.operations = {"GET": "getTest"}
        with self.assertRaises(APIError) as raised:
            view._dispatch_contract(request)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.code, "DEPENDENCY_UNAVAILABLE")

    def test_provider_uses_stage13_and_stage14_reference_engines(self):
        source = (
            ROOT / "src/backend/django_adapter/runtime_learning.py"
        ).read_text(encoding="utf-8")
        self.assertIn("generate_plan(", source)
        self.assertIn("select_adaptive(", source)
        self.assertIn("NO_ELIGIBLE_QUESTIONS", source)

    def test_test_creation_uses_canonical_postgres_snapshot_tables(self):
        source = (
            ROOT / "src/backend/django_adapter/runtime_learning.py"
        ).read_text(encoding="utf-8")
        for table in (
            "grammar_lessons",
            "grammar_subtopics",
            "questions",
            "question_options",
            "tests",
            "test_questions",
            "api_idempotency_records",
            "error_review_items",
            "review_queue",
        ):
            self.assertIn(table, source)
        self.assertNotIn("auth_user", source)


if __name__ == "__main__":
    unittest.main()
