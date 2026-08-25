from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings")

import django

django.setup()

from backend.django_adapter.runtime_history import _activity_type, _where_clause
from backend.django_adapter.urls import ROUTE_OPERATION_IDS, urlpatterns


class RuntimeHistorySurfaceTests(unittest.TestCase):
    def test_history_route_is_additive_and_does_not_mutate_frozen_stage21_set(self):
        self.assertNotIn("listHistory", ROUTE_OPERATION_IDS)
        self.assertEqual(len(ROUTE_OPERATION_IDS), 34)
        self.assertTrue(any(getattr(pattern, "name", None) == "listHistory" for pattern in urlpatterns))

    def test_history_filter_query_is_owner_scoped_and_uses_snapshot_lesson(self):
        user_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
        lesson_id = "22222222-2222-4222-8222-222222222222"
        request = SimpleNamespace(query_params={
            "mode": "TCF",
            "score": "STRONG",
            "lesson_id": lesson_id,
            "date_from": "2026-08-01",
            "date_to": "2026-08-25",
        })
        where_sql, params, filters = _where_clause(request, user_id)
        self.assertIn("ta.user_id = %s", where_sql)
        self.assertIn("ta.status = 'COMPLETED'", where_sql)
        self.assertIn("question_snapshot->>'lesson_id'", where_sql)
        self.assertIn("ta.score_pct >= 80", where_sql)
        self.assertEqual(params[0], user_id)
        self.assertEqual(filters["mode"], "TCF")
        self.assertEqual(filters["lesson_id"], lesson_id)

    def test_activity_type_maps_exam_and_review_modes_without_fabricated_status(self):
        self.assertEqual(_activity_type("TCF"), "TEST")
        self.assertEqual(_activity_type("REVIEW"), "REVIEW")
        self.assertEqual(_activity_type("ADAPTIVE"), "PRACTICE")
        self.assertEqual(_activity_type("CUSTOM"), "PRACTICE")


if __name__ == "__main__":
    unittest.main()
