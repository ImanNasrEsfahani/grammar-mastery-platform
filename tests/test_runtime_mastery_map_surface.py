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

from backend.django_adapter.runtime_mastery_map import (
    CANONICAL_BANDS,
    CANONICAL_SCOPES,
    _aggregate,
    _public_mastery,
)
from backend.django_adapter.urls import ROUTE_OPERATION_IDS, urlpatterns


class RuntimeMasteryMapSurfaceTests(unittest.TestCase):
    def test_mastery_map_route_is_additive_and_frozen_stage21_operation_set_stays_unchanged(self):
        self.assertNotIn("getMasteryMap", ROUTE_OPERATION_IDS)
        self.assertEqual(len(ROUTE_OPERATION_IDS), 34)
        self.assertTrue(any(getattr(pattern, "name", None) == "getMasteryMap" for pattern in urlpatterns))

    def test_canonical_bands_and_scopes_are_not_redefined_by_ui(self):
        self.assertEqual(
            CANONICAL_BANDS,
            ("NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG"),
        )
        self.assertEqual(CANONICAL_SCOPES, ("SUBTOPIC", "LESSON", "CATEGORY"))
        self.assertNotIn("MASTERED", CANONICAL_BANDS)
        self.assertNotIn("SUBCATEGORY", CANONICAL_SCOPES)

    def test_subcategory_projection_is_explicitly_display_only(self):
        child_a = {
            "evidence_score_pct": 80.0,
            "mastery_score_pct": 72.0,
            "confidence": 0.65,
            "evidence_count": 8,
            "effective_evidence": 7.0,
            "stability": 0.8,
            "coverage_ratio": 1.0,
            "mastery_band": "DEVELOPING",
            "model_version": "mastery-evidence-v0.9.0",
        }
        child_b = {
            "evidence_score_pct": 50.0,
            "mastery_score_pct": 50.0,
            "confidence": 0.0,
            "evidence_count": 0,
            "effective_evidence": 0.0,
            "stability": 0.5,
            "coverage_ratio": 0.0,
            "mastery_band": "NO_EVIDENCE",
            "model_version": "mastery-evidence-v0.9.0",
        }
        aggregate = _aggregate([child_a, child_b], [3.0, 1.0])
        public = _public_mastery(
            aggregate,
            source="DERIVED_SUBCATEGORY_FOR_UI",
            canonical_scope=False,
            derived_for_ui=True,
        )
        self.assertFalse(public["canonical_scope"])
        self.assertTrue(public["derived_for_ui"])
        self.assertEqual(public["source"], "DERIVED_SUBCATEGORY_FOR_UI")
        self.assertIn(public["mastery_band"], CANONICAL_BANDS)
        self.assertGreater(public["evidence_count"], 0)


if __name__ == "__main__":
    unittest.main()
