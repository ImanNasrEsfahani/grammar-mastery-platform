import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mastery.engine import (
    DEFAULT_CONFIG,
    aggregate_mastery,
    compute_subtopic_mastery,
    stage14_provider_payload,
)


AS_OF = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)


def event(i, correct, difficulty="MEDIUM", misconception=None, age_minutes=None):
    minutes = i if age_minutes is None else age_minutes
    return {
        "answer_id": f"a-{i}",
        "attempt_id": f"attempt-{i}",
        "test_question_id": f"question-{i}",
        "answer_sequence": 1,
        "is_correct": correct,
        "difficulty_code": difficulty,
        "answered_at": (AS_OF - timedelta(minutes=minutes)).isoformat(),
        "misconception_id": misconception,
    }


class MasteryZeroOriginV1Tests(unittest.TestCase):
    def test_model_version_and_prior_are_versioned(self):
        self.assertEqual(DEFAULT_CONFIG["model_version"], "mastery-evidence-v1.0.0")
        self.assertEqual(DEFAULT_CONFIG["prior_score_pct"], 0.0)

    def test_no_evidence_is_zero_but_semantically_no_evidence(self):
        result = compute_subtopic_mastery([], AS_OF)
        self.assertEqual(result["evidence_score_pct"], 0.0)
        self.assertEqual(result["mastery_score_pct"], 0.0)
        self.assertEqual(result["confidence"], 0.0)
        self.assertEqual(result["mastery_band"], "NO_EVIDENCE")

    def test_fresh_correct_answer_moves_mastery_above_zero(self):
        result = compute_subtopic_mastery([event(1, True)], AS_OF)
        self.assertGreater(result["mastery_score_pct"], 0.0)
        self.assertLess(result["mastery_score_pct"], 100.0)

    def test_more_correct_answers_raise_mastery(self):
        scores = []
        evidence = []
        for i in range(1, 16):
            evidence.append(event(i, True))
            scores.append(compute_subtopic_mastery(evidence, AS_OF)["mastery_score_pct"])
        self.assertTrue(all(b > a for a, b in zip(scores, scores[1:])))

    def test_wrong_answer_reduces_mastery(self):
        for correct_count in (1, 3, 5, 10, 20):
            before = [event(i, True) for i in range(1, correct_count + 1)]
            before_score = compute_subtopic_mastery(before, AS_OF)["mastery_score_pct"]
            wrong = event(
                1000 + correct_count,
                False,
                difficulty="MEDIUM",
                age_minutes=0,
            )
            after_score = compute_subtopic_mastery(before + [wrong], AS_OF)[
                "mastery_score_pct"
            ]
            self.assertLess(
                after_score,
                before_score,
                f"wrong answer did not lower mastery after {correct_count} correct answers",
            )

    def test_correct_answer_after_errors_raises_mastery(self):
        before = [
            event(1, True),
            event(2, False),
            event(3, False, misconception="m"),
        ]
        before_score = compute_subtopic_mastery(before, AS_OF)["mastery_score_pct"]
        after_score = compute_subtopic_mastery(
            before + [event(100, True, "HARD", age_minutes=0)],
            AS_OF,
        )["mastery_score_pct"]
        self.assertGreater(after_score, before_score)

    def test_repeated_misconception_is_penalized_more(self):
        correct = [event(i, True) for i in range(1, 9)]
        generic_wrong = [
            event(20 + i, False, misconception=f"m-{i}") for i in range(3)
        ]
        repeated_wrong = [
            event(30 + i, False, misconception="same-misconception") for i in range(3)
        ]
        generic = compute_subtopic_mastery(correct + generic_wrong, AS_OF)
        repeated = compute_subtopic_mastery(correct + repeated_wrong, AS_OF)
        self.assertLess(
            repeated["mastery_score_pct"],
            generic["mastery_score_pct"],
        )

    def test_difficulty_weight_still_matters(self):
        hard_correct = compute_subtopic_mastery(
            [
                event(1, True, "HARD"),
                event(2, False, "MEDIUM"),
            ],
            AS_OF,
        )
        easy_correct = compute_subtopic_mastery(
            [
                event(3, True, "EASY"),
                event(4, False, "MEDIUM"),
            ],
            AS_OF,
        )
        self.assertGreater(
            hard_correct["mastery_score_pct"],
            easy_correct["mastery_score_pct"],
        )

    def test_old_evidence_loses_confidence_and_visible_mastery(self):
        fresh = compute_subtopic_mastery(
            [event(i, True, age_minutes=i) for i in range(1, 11)],
            AS_OF,
        )
        old = compute_subtopic_mastery(
            [
                event(i, True, age_minutes=(90 * 24 * 60) + i)
                for i in range(1, 11)
            ],
            AS_OF,
        )
        self.assertLess(old["confidence"], fresh["confidence"])
        self.assertLess(old["mastery_score_pct"], fresh["mastery_score_pct"])

    def test_existing_stage15_weighting_contract_remains_compatible(self):
        evidence = [event(i, True, "EASY") for i in range(1, 9)]
        evidence += [
            event(20 + i, False, "HARD", misconception="same")
            for i in range(4)
        ]
        result = compute_subtopic_mastery(evidence, AS_OF)
        self.assertLess(result["evidence_score_pct"], 66.6667)
        self.assertEqual(
            stage14_provider_payload(result)["mastery_score_pct"],
            result["evidence_score_pct"],
        )

    def test_existing_coverage_semantics_remain_compatible(self):
        practised = compute_subtopic_mastery(
            [event(i, True) for i in range(1, 15)],
            AS_OF,
        )
        empty = compute_subtopic_mastery([], AS_OF)
        aggregate = aggregate_mastery([practised, empty, empty, empty])
        self.assertEqual(aggregate["coverage_ratio"], 0.25)

    def test_empty_aggregate_starts_at_zero(self):
        result = aggregate_mastery([])
        self.assertEqual(result["mastery_score_pct"], 0.0)
        self.assertEqual(result["mastery_band"], "NO_EVIDENCE")

    def test_stage14_provider_contract_avoids_double_shrinkage(self):
        result = compute_subtopic_mastery(
            [event(i, True) for i in range(1, 6)],
            AS_OF,
        )
        payload = stage14_provider_payload(result)
        self.assertEqual(
            payload["mastery_score_pct"],
            result["evidence_score_pct"],
        )
        self.assertEqual(
            payload["stage15_final_mastery_score_pct"],
            result["mastery_score_pct"],
        )
        self.assertEqual(
            payload["mastery_model_version"],
            "mastery-evidence-v1.0.0",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
