from __future__ import annotations

import os
import sys
import unittest
import uuid
from datetime import datetime, timezone
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

from backend.django_adapter import runtime_dashboard
from backend.django_adapter.views import ContractEndpointView
from backend.errors import APIError
from backend.security import Principal


USER_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"


def empty_snapshot():
    return {
        "as_of": "2026-08-09T22:55:00Z",
        "profile_locale": "fa-IR",
        "mastery": [],
        "review_queue": {
            "due_count": 0,
            "overdue_count": 0,
            "next_due_at": None,
            "suspended_concept_count": 0,
        },
        "error_review": {
            "unresolved_group_count": 0,
            "corrected_item_count": 0,
            "top_misconception_groups": [],
        },
        "recent_test": None,
        "in_progress_attempt": None,
        "trend": {"points": [], "incomplete_data": False, "warning": None},
        "activity": {
            "questions_answered": 0,
            "tests_completed": 0,
            "reviews_completed": 0,
        },
    }


class RuntimeDashboardProviderTests(unittest.TestCase):
    def test_in_progress_attempt_projection_preserves_resume_progress(self):
        class Cursor:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchone(self):
                return (
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    "adaptive",
                    None,
                    datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc),
                    20,
                    7,
                )

        cursor = Cursor()
        attempt = runtime_dashboard._load_in_progress_attempt(
            cursor, uuid.UUID(USER_ID)
        )
        self.assertEqual(attempt["answered_count"], 7)
        self.assertEqual(attempt["question_count"], 20)
        self.assertIn("IN_PROGRESS", cursor.sql)
        self.assertEqual(cursor.params, [uuid.UUID(USER_ID)])

    def test_mastery_projection_resolves_localized_scope_title(self):
        class Cursor:
            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchall(self):
                return [
                    (
                        "SUBTOPIC",
                        LESSON_ID,
                        "زمان گذشته مرکب",
                        54,
                        0.23,
                        1,
                        3,
                        "UNCERTAIN",
                        None,
                    )
                ]

        cursor = Cursor()
        items = runtime_dashboard._load_mastery(cursor, uuid.UUID(USER_ID), "fa")
        self.assertEqual(items[0]["scope_title"], "زمان گذشته مرکب")
        self.assertIn("grammar_subtopics", cursor.sql)
        self.assertEqual(cursor.params[:3], ["fa", "fa", "fa"])

    def test_new_user_selects_build_evidence_without_weakness_label(self):
        action = runtime_dashboard._select_next_action(empty_snapshot())
        self.assertEqual(action.code, "BUILD_EVIDENCE")
        self.assertEqual(action.destination, "/fa/tests/new")
        self.assertIn("شواهد", action.reason)

    def test_due_review_has_first_priority(self):
        snapshot = empty_snapshot()
        snapshot["review_queue"]["due_count"] = 2
        snapshot["error_review"]["unresolved_group_count"] = 9
        action = runtime_dashboard._select_next_action(snapshot)
        self.assertEqual(action.code, "OVERDUE_REVIEW")
        self.assertEqual(action.destination, "/fa/review")

    def test_unresolved_error_group_precedes_mastery_weakness(self):
        snapshot = empty_snapshot()
        snapshot["error_review"]["unresolved_group_count"] = 1
        snapshot["mastery"] = [
            {
                "scope_type": "LESSON",
                "scope_id": LESSON_ID,
                "mastery_score_pct": 20.0,
                "confidence": 0.9,
                "coverage_ratio": 0.8,
                "evidence_count": 10,
                "mastery_band": "WEAK",
            }
        ]
        action = runtime_dashboard._select_next_action(snapshot)
        self.assertEqual(action.code, "DUE_REVIEW")

    def test_confident_critical_lesson_targets_lesson_route(self):
        snapshot = empty_snapshot()
        snapshot["profile_locale"] = "en-CA"
        snapshot["mastery"] = [
            {
                "scope_type": "LESSON",
                "scope_id": LESSON_ID,
                "mastery_score_pct": 39.9,
                "confidence": 0.8,
                "coverage_ratio": 0.7,
                "evidence_count": 12,
                "mastery_band": "WEAK",
            }
        ]
        action = runtime_dashboard._select_next_action(snapshot)
        self.assertEqual(action.code, "CRITICAL_CONFIDENT_LESSON")
        self.assertEqual(action.destination, f"/en/lessons/{LESSON_ID}")

    def test_low_confidence_does_not_create_weakness_label(self):
        snapshot = empty_snapshot()
        snapshot["mastery"] = [
            {
                "scope_type": "LESSON",
                "scope_id": LESSON_ID,
                "mastery_score_pct": 10.0,
                "confidence": 0.2,
                "coverage_ratio": 0.4,
                "evidence_count": 3,
                "mastery_band": "UNCERTAIN",
            }
        ]
        action = runtime_dashboard._select_next_action(snapshot)
        self.assertEqual(action.code, "REGULAR_PRACTICE")

    def test_missing_persisted_mastery_band_fails_conservatively(self):
        band = runtime_dashboard._safe_mastery_band(
            None,
            evidence_count=4,
            confidence=0.9,
        )
        self.assertEqual(band, "UNCERTAIN")

    def test_dashboard_operation_is_bound(self):
        principal = Principal(
            user_id=USER_ID,
            session_id="33333333-3333-4333-8333-333333333333",
            roles=("USER",),
            token_id="44444444-4444-4444-8444-444444444444",
        )
        request = SimpleNamespace(method="GET", auth=principal)
        view = ContractEndpointView()
        view.operations = {"GET": "getDashboard"}
        expected = SimpleNamespace(status_code=200)

        with patch.object(
            runtime_dashboard,
            "dashboard_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request)

        self.assertIs(result, expected)
        handler.assert_called_once_with(request)

    def test_next_action_operation_is_bound(self):
        principal = Principal(
            user_id=USER_ID,
            session_id="33333333-3333-4333-8333-333333333333",
            roles=("USER",),
            token_id="44444444-4444-4444-8444-444444444444",
        )
        request = SimpleNamespace(method="GET", auth=principal)
        view = ContractEndpointView()
        view.operations = {"GET": "getCurrentNextAction"}
        expected = SimpleNamespace(status_code=200)

        with patch.object(
            runtime_dashboard,
            "next_action_request",
            return_value=expected,
        ) as handler:
            result = view._dispatch_contract(request)

        self.assertIs(result, expected)
        handler.assert_called_once_with(request)

    def test_other_unbound_operations_still_fail_closed(self):
        view = ContractEndpointView()
        view.operations = {"GET": "listLessons"}
        with self.assertRaises(APIError) as raised:
            view._dispatch_contract(SimpleNamespace(method="GET"))
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.code, "DEPENDENCY_UNAVAILABLE")

    def test_provider_is_read_only_and_uses_canonical_stage_tables(self):
        source = (
            ROOT / "src/backend/django_adapter/runtime_dashboard.py"
        ).read_text(encoding="utf-8")
        for name in (
            "user_mastery",
            "review_queue",
            "v_error_review_groups",
            "error_review_items",
            "test_attempts",
            "mastery_snapshots",
            "user_answers",
            "error_review_events",
        ):
            self.assertIn(name, source)

        upper = source.upper()
        for forbidden in (
            "INSERT INTO",
            "UPDATE ",
            "DELETE FROM",
            "DROP TABLE",
            "TRUNCATE",
        ):
            self.assertNotIn(forbidden, upper)


if __name__ == "__main__":
    unittest.main()
