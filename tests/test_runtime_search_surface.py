from __future__ import annotations

import inspect
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings")

import django

django.setup()

from backend.django_adapter import runtime_search
from backend.django_adapter.runtime_search import (
    _like_pattern,
    _normalize_kind,
    _normalize_search_query,
    _result_sort_key,
)
from backend.django_adapter.urls import ROUTE_OPERATION_IDS, urlpatterns
from backend.errors import APIError


class RuntimeGrammarSearchSurfaceTests(unittest.TestCase):
    def test_search_route_is_additive_and_preserves_frozen_stage21_contract(self):
        self.assertNotIn("searchGrammar", ROUTE_OPERATION_IDS)
        self.assertEqual(len(ROUTE_OPERATION_IDS), 34)
        self.assertTrue(any(getattr(pattern, "name", None) == "searchGrammar" for pattern in urlpatterns))

    def test_query_and_kind_are_normalized_and_like_metacharacters_are_escaped(self):
        self.assertEqual(_normalize_search_query("  dont   relatif  "), "dont relatif")
        self.assertEqual(_normalize_kind("rule"), "RULE")
        self.assertEqual(_like_pattern(r"100%_x"), r"%100\%\_x%")
        with self.assertRaises(APIError):
            _normalize_kind("QUESTION")

    def test_search_runtime_uses_canonical_curriculum_and_owner_scoped_learning_evidence(self):
        source = inspect.getsource(runtime_search)
        for table in (
            "grammar_lessons",
            "grammar_subtopics",
            "grammar_categories",
            "user_mastery",
            "error_review_items",
            "misconceptions",
        ):
            self.assertIn(table, source)
        self.assertIn("eri.user_id = %s", source)
        self.assertIn("scope_type = 'LESSON'", source)
        self.assertIn("scope_type = 'SUBTOPIC'", source)
        self.assertIn("scope_type = 'CATEGORY'", source)

    def test_rule_is_a_projection_of_subtopic_text_not_a_parallel_taxonomy_entity(self):
        source = inspect.getsource(runtime_search)
        self.assertIn("CANONICAL_SUBTOPIC_RULE_TEXT", source)
        self.assertIn("short_definition_fa", source)
        self.assertIn("teaching_note_fa", source)
        self.assertNotIn("grammar_rules", source)

    def test_result_sort_is_stable_across_kind_and_lesson(self):
        lesson = {"rank": 1, "kind": "LESSON", "lesson_no": 32, "title_fr": "LES RELATIFS"}
        rule = {"rank": 1, "kind": "RULE", "lesson_no": 32, "title_fr": "Relatif dont"}
        self.assertLess(_result_sort_key(lesson), _result_sort_key(rule))


if __name__ == "__main__":
    unittest.main()
