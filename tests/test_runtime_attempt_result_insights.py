from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings")

import django

django.setup()

from backend.django_adapter import runtime_attempt_result, views
from types import SimpleNamespace
from unittest.mock import patch


class AttemptResultInsightHelperTests(unittest.TestCase):
    def test_accuracy_is_null_without_questions(self):
        self.assertIsNone(runtime_attempt_result._pct(0, 0))
        self.assertEqual(runtime_attempt_result._pct(3, 4), 75.0)

    def test_difficulty_analysis_keeps_all_four_controlled_levels(self):
        rows = runtime_attempt_result._analysis_rows(
            [
                {"difficulty": "EASY", "is_correct": True},
                {"difficulty": "MEDIUM", "is_correct": False},
                {"difficulty": "MEDIUM", "is_correct": True},
            ],
            key_field="difficulty",
            ordered_keys=runtime_attempt_result.DIFFICULTY_ORDER,
        )
        self.assertEqual([row["key"] for row in rows[:4]], list(runtime_attempt_result.DIFFICULTY_ORDER))
        self.assertEqual(rows[0]["accuracy_pct"], 100.0)
        self.assertEqual(rows[1]["accuracy_pct"], 50.0)
        self.assertIsNone(rows[3]["accuracy_pct"])

    def test_strength_and_weakness_labels_are_session_performance_only(self):
        rows = [
            {"subtopic_id": "a", "total": 4, "correct": 4, "incorrect": 0, "accuracy_pct": 100.0},
            {"subtopic_id": "b", "total": 4, "correct": 1, "incorrect": 3, "accuracy_pct": 25.0},
        ]
        strengths, weaknesses = runtime_attempt_result._strengths_and_weaknesses(rows)
        self.assertEqual(strengths[0]["subtopic_id"], "a")
        self.assertEqual(weaknesses[0]["subtopic_id"], "b")

    def test_mastery_impact_does_not_invent_delta_for_first_evidence(self):
        summary = runtime_attempt_result._mastery_impact_summary(
            [
                {"new_evidence": True, "mastery_delta_pct": None},
                {"new_evidence": False, "mastery_delta_pct": 4.5},
                {"new_evidence": False, "mastery_delta_pct": -2.0},
            ]
        )
        self.assertEqual(summary["new_evidence_subtopic_count"], 1)
        self.assertEqual(summary["improved_subtopic_count"], 1)
        self.assertEqual(summary["declined_subtopic_count"], 1)
        self.assertAlmostEqual(summary["average_delta_pct"], 1.25)

    def test_result_operation_routes_to_enriched_provider(self):
        request = SimpleNamespace(method="GET")
        view = views.ContractEndpointView()
        view.operations = {"GET": "getAttemptResult"}
        expected = SimpleNamespace(status_code=200)
        attempt_id = "11111111-1111-4111-8111-111111111111"
        with patch.object(runtime_attempt_result, "attempt_result_request", return_value=expected) as handler:
            result = view._dispatch_contract(request, attemptId=attempt_id)
        self.assertIs(result, expected)
        handler.assert_called_once_with(request, attempt_id=attempt_id)

    def test_selected_option_uses_frozen_snapshot_mapping(self):
        snapshot = {"options": [{"id": "a", "misconception_id": "m1"}, {"id": "b", "misconception_id": None}]}
        selected = runtime_attempt_result._selected_snapshot_option(snapshot, "a")
        self.assertEqual(selected["misconception_id"], "m1")


if __name__ == "__main__":
    unittest.main()
