from __future__ import annotations

from copy import deepcopy
import csv
from decimal import Decimal
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from backend.application import LearningApplication
from backend.errors import APIError
from backend.import_pipeline.validator import validate_row
from mastery.engine import compute_subtopic_mastery
from spaced_repetition.scheduler import transition
from test_generator.generator import generate_plan, largest_remainder

from stage24_fixtures import REFERENCE, lookup_catalog, question_snapshot, valid_import_row


NOW = REFERENCE["now"]


class Stage24UnitTests(unittest.TestCase):
    def test_weight_model_is_exactly_100_and_rounding_is_deterministic(self):
        with (ROOT / "data/planning/stage3_lesson_weights_v1.0.csv").open(
            encoding="utf-8-sig", newline=""
        ) as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 52)
        self.assertEqual(sum(Decimal(row["final_weight_pct"]) for row in rows), Decimal("100.00"))
        self.assertEqual(
            largest_remainder(37, {"L01": 1, "L02": 1, "L03": 1}, ["L01", "L02", "L03"]),
            {"L01": 13, "L02": 12, "L03": 12},
        )

    def test_question_requires_four_positions_and_one_valid_correct_option(self):
        normalized = LearningApplication._normalize_snapshot(question_snapshot(), 1)
        self.assertEqual(len(normalized["options"]), 4)
        self.assertEqual(
            sum(option["id"] == normalized["correct_option_id"] for option in normalized["options"]),
            1,
        )

        invalid = question_snapshot()
        invalid["correct_option_id"] = "99999999-9999-4999-8999-999999999999"
        with self.assertRaises(APIError) as caught:
            LearningApplication._normalize_snapshot(invalid, 1)
        self.assertEqual(caught.exception.code, "VALIDATION_ERROR")

        ambiguous_import = valid_import_row()
        ambiguous_import["correct_option"] = "A|B"
        codes = {error.code for error in validate_row(ambiguous_import, 2, lookup_catalog())}
        self.assertIn("ENUM_INVALID", codes)

    def test_generator_quotas_have_exact_count_and_composition(self):
        lessons = ["L01", "L02", "L03"]
        candidates = [
            {
                "question_revision_id": f"q-{lesson}",
                "lesson_id": lesson,
                "subtopic_id": f"s-{lesson}",
                "difficulty": "MEDIUM",
                "question_type_code": "CLOZE",
                "status": "PUBLISHED",
                "serving_enabled": True,
                "is_current_revision": True,
                "blocked_not_scorable": False,
                "compatibility_status": "ALLOWED",
            }
            for lesson in lessons
        ]
        config = {
            "schema_version": "test-config-schema-v0.9.0",
            "mode": "custom",
            "question_count": 37,
            "seed": "stage24-quota-seed",
            "scope": {
                "combine": "OR",
                "clauses": [{"dimension": "LESSON", "ids": lessons}],
            },
            "lesson_allocation": {
                "strategy": "EXPLICIT_PCT",
                "mix_pct": {"L01": 50, "L02": 30, "L03": 20},
            },
            "difficulty_mix_pct": {"EASY": 30, "MEDIUM": 40, "HARD": 25, "VERY_HARD": 5},
            "type_allocation": {
                "strategy": "EXPLICIT_PCT",
                "mix_pct": {"CLOZE": 70, "MCQ": 30},
            },
        }
        plan = generate_plan(config, candidates)
        self.assertEqual(sum(plan["lesson_quotas"].values()), 37)
        self.assertEqual(sum(plan["difficulty_quotas"].values()), 37)
        self.assertEqual(sum(plan["type_quotas"].values()), 37)
        self.assertEqual(sum(plan["strata"].values()), 37)
        self.assertEqual(plan["lesson_quotas"], {"L01": 19, "L02": 11, "L03": 7})
        self.assertEqual(plan["difficulty_quotas"], {"EASY": 11, "MEDIUM": 15, "HARD": 9, "VERY_HARD": 2})
        self.assertEqual(plan["type_quotas"], {"CLOZE": 26, "MCQ": 11})

    def test_mastery_has_a_fixed_numeric_example(self):
        snapshot = question_snapshot()
        evidence = [
            {
                "attempt_id": "attempt-1",
                "test_question_id": snapshot["test_question_id"],
                "answer_sequence": 1,
                "answer_id": "answer-1",
                "is_correct": False,
                "difficulty_code": "MEDIUM",
                "misconception_id": snapshot["options"][1]["misconception_id"],
                "answered_at": NOW,
                "response_ms": 1200,
            }
        ]
        actual = compute_subtopic_mastery(evidence, NOW)
        expected = REFERENCE["fixed_mastery_wrong_medium"]
        for field, value in expected.items():
            self.assertEqual(actual[field], value, field)

    def test_srs_due_interval_and_lapse_fields_are_fixed(self):
        mastery = REFERENCE["fixed_mastery_wrong_medium"]
        actual = transition(
            None,
            {
                "kind": "ANSWER",
                "event_at": NOW,
                "is_correct": False,
                "answer_id": "answer-1",
                "mastery_band": mastery["mastery_band"],
                "mastery_confidence": mastery["confidence"],
                "mastery_provider_contract_version": "mastery-provider-contract-v0.9.0",
            },
        )
        for field, value in REFERENCE["fixed_srs_wrong_first_answer"].items():
            self.assertEqual(actual[field], value, field)


if __name__ == "__main__":
    unittest.main()
