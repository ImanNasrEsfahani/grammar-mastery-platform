from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.django_adapter.runtime_lesson_detail import load_lesson_detail_enrichment


USER_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "22222222-2222-4222-8222-222222222222"
SUBTOPIC_1 = "33333333-3333-4333-8333-333333333333"
SUBTOPIC_2 = "44444444-4444-4444-8444-444444444444"
REVIEW_ID = "55555555-5555-4555-8555-555555555555"
MISCONCEPTION_ID = "66666666-6666-4666-8666-666666666666"
ATTEMPT_ID = "77777777-7777-4777-8777-777777777777"
TEST_ID = "88888888-8888-4888-8888-888888888888"


class ScriptedCursor:
    def __init__(self, steps):
        self.steps = list(steps)
        self.current = None
        self.executed = []

    def execute(self, sql, params):
        if not self.steps:
            raise AssertionError(f"Unexpected SQL: {sql}")
        self.current = self.steps.pop(0)
        self.executed.append((sql, params))
        expected = self.current.get("contains")
        if expected and expected not in sql:
            raise AssertionError(f"Expected SQL containing {expected!r}, got: {sql}")

    def fetchone(self):
        if self.current is None:
            raise AssertionError("fetchone without execute")
        return self.current.get("one")

    def fetchall(self):
        if self.current is None:
            raise AssertionError("fetchall without execute")
        return self.current.get("all", [])


class LessonDetailInsightsTests(unittest.TestCase):
    def test_builds_lesson_scoped_learning_snapshot_from_canonical_tables(self):
        now = datetime(2026, 8, 24, 18, 0, tzinfo=timezone.utc)
        started = now - timedelta(minutes=11)
        cursor = ScriptedCursor(
            [
                {"contains": "FROM grammar_lessons", "one": ("140-147", "152-159")},
                {
                    "contains": "scope_type = 'SUBTOPIC'",
                    "all": [
                        (
                            SUBTOPIC_1,
                            42.0,
                            0.6,
                            5,
                            "mastery-evidence-v0.9.0",
                            30.0,
                            4.2,
                            0.8,
                            1.0,
                            "WEAK",
                        )
                    ],
                },
                {"contains": "scope_type = 'LESSON'", "one": None},
                {
                    "contains": "GROUP BY q.primary_subtopic_id",
                    "all": [(SUBTOPIC_1, 42), (SUBTOPIC_2, 28)],
                },
                {
                    "contains": "FROM error_review_items",
                    "all": [(SUBTOPIC_1, 3), (SUBTOPIC_2, 1)],
                },
                {"contains": "eri.reviewability = 'RETRY_ALLOWED'", "one": (REVIEW_ID,)},
                {
                    "contains": "JOIN misconceptions",
                    "all": [
                        (
                            MISCONCEPTION_ID,
                            "RELATIVE_PRONOUN",
                            "que / dont",
                            "انتخاب ضمیر موصولی نادرست",
                            "وابستگی به ساخت متمم بررسی شود.",
                            SUBTOPIC_1,
                            "Relatif « que »",
                            None,
                            3,
                            now,
                        )
                    ],
                },
                {
                    "contains": "WITH latest_answers",
                    "all": [
                        (ATTEMPT_ID, TEST_ID, "adaptive", started, now, 18, 18, 12)
                    ],
                },
            ]
        )

        result = load_lesson_detail_enrichment(
            cursor,
            user_id=USER_ID,
            lesson_id=LESSON_ID,
            subtopics=[
                {"id": SUBTOPIC_1, "code": "L32-ST01"},
                {"id": SUBTOPIC_2, "code": "L32-ST02"},
            ],
            as_of=now,
        )

        self.assertEqual(result["book_reference"]["book_pages"], "140-147")
        learning = result["learning"]
        self.assertEqual(learning["overview"]["source"], "AGGREGATED_SUBTOPICS")
        self.assertEqual(learning["overview"]["coverage_ratio"], 0.5)
        self.assertEqual(learning["unresolved_mistake_count"], 4)
        self.assertEqual(learning["review_item_id"], REVIEW_ID)
        self.assertEqual(learning["subtopics"][0]["question_count"], 42)
        self.assertEqual(learning["subtopics"][0]["mastery"]["mastery_band"], "WEAK")
        self.assertEqual(learning["subtopics"][1]["mastery"]["mastery_band"], "NO_EVIDENCE")
        self.assertEqual(learning["misconceptions"][0]["repeat_count"], 3)
        self.assertEqual(learning["recent_activity"][0]["accuracy_pct"], 66.7)
        self.assertEqual(learning["recent_activity"][0]["duration_seconds"], 660)
        self.assertFalse(cursor.steps)

    def test_runtime_lesson_route_is_wired_to_enrichment_helper(self):
        source = (ROOT / "src/backend/django_adapter/runtime_learning.py").read_text(encoding="utf-8")
        self.assertIn("load_lesson_detail_enrichment", source)
        self.assertIn("data.update(enrichment)", source)

    def test_prefers_persisted_lesson_mastery_when_available(self):
        now = datetime(2026, 8, 24, 18, 0, tzinfo=timezone.utc)
        cursor = ScriptedCursor(
            [
                {"contains": "FROM grammar_lessons", "one": (None, None)},
                {"contains": "scope_type = 'SUBTOPIC'", "all": []},
                {
                    "contains": "scope_type = 'LESSON'",
                    "one": (72.0, 0.8, 20, "mastery-evidence-v0.9.0", 77.5, 18.0, 0.9, 0.75, "DEVELOPING"),
                },
                {"contains": "GROUP BY q.primary_subtopic_id", "all": []},
                {"contains": "FROM error_review_items", "all": []},
                {"contains": "eri.reviewability = 'RETRY_ALLOWED'", "one": None},
                {"contains": "JOIN misconceptions", "all": []},
                {"contains": "WITH latest_answers", "all": []},
            ]
        )
        result = load_lesson_detail_enrichment(
            cursor,
            user_id=USER_ID,
            lesson_id=LESSON_ID,
            subtopics=[{"id": SUBTOPIC_1, "code": "L32-ST01"}],
            as_of=now,
        )
        overview = result["learning"]["overview"]
        self.assertEqual(overview["source"], "PERSISTED_LESSON")
        self.assertEqual(overview["mastery_score_pct"], 72.0)
        self.assertEqual(overview["confidence"], 0.8)
        self.assertEqual(overview["coverage_ratio"], 0.75)


if __name__ == "__main__":
    unittest.main()
