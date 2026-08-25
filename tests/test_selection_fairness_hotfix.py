from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from adaptive.selector import select_adaptive, score_candidate
from test_generator.generator import generate_plan, lesson_quotas


LESSONS = [f"L{i:02d}" for i in range(1, 53)]


def lesson_config(mode: str, count: int, seed: str, strategy: str):
    return {
        "schema_version": "test-config-schema-v0.9.0",
        "mode": mode,
        "question_count": count,
        "scope": {"combine": "AND", "clauses": [{"dimension": "LESSON", "ids": LESSONS}]},
        "lesson_allocation": {"strategy": strategy},
        "difficulty_mix_pct": {"EASY": 20, "MEDIUM": 40, "HARD": 30, "VERY_HARD": 10},
        "type_allocation": {"strategy": "EXPLICIT_PCT", "mix_pct": {"TYPE": 100}},
        "seed": seed,
    }


def candidate(
    revision: str,
    uid: str,
    *,
    lesson: str,
    score: str = "high",
    seen: float | None = 30,
    question_type: str = "TYPE",
):
    if score == "high":
        tcf_weight, mastery, overdue, repeats = 2.48, 20, 14, 3
    else:
        tcf_weight, mastery, overdue, repeats = 0.0, 95, 0, 0
    return {
        "question_revision_id": revision,
        "question_uid": uid,
        "lesson_id": lesson,
        "question_type_code": question_type,
        "difficulty": "MEDIUM",
        "tcf_weight_pct": tcf_weight,
        "mastery_score_pct": mastery,
        "mastery_confidence": 1.0,
        "days_overdue": overdue,
        "days_since_seen": seen,
        "misconception_repeat_count": repeats,
        "status": "PUBLISHED",
        "is_current_revision": True,
        "serving_enabled": True,
        "in_scope": True,
        "blocked_not_scorable": False,
        "compatibility_status": "ALLOWED",
        "conditional_guardrail_passed": False,
    }


class SelectionFairnessHotfixTests(unittest.TestCase):

    def test_generate_plan_uses_seeded_lesson_allocation(self):
        candidates = [
            {
                "question_revision_id": f"q-{lesson}",
                "question_uid": f"u-{lesson}",
                "lesson_id": lesson,
                "status": "PUBLISHED",
                "serving_enabled": True,
                "is_current_revision": True,
                "blocked_not_scorable": False,
                "compatibility_status": "ALLOWED",
                "conditional_guardrail_passed": False,
                "tag_ids": [],
            }
            for lesson in LESSONS
        ]
        cfg_a = lesson_config("custom", 10, "plan-a", "UNIFORM")
        cfg_a["difficulty_mix_pct"] = {"EASY": 100, "MEDIUM": 0, "HARD": 0, "VERY_HARD": 0}
        cfg_b = lesson_config("custom", 10, "plan-b", "UNIFORM")
        cfg_b["difficulty_mix_pct"] = dict(cfg_a["difficulty_mix_pct"])
        plan_a = generate_plan(cfg_a, candidates)
        plan_b = generate_plan(cfg_b, candidates)
        self.assertEqual(sum(plan_a["lesson_quotas"].values()), 10)
        self.assertNotEqual(plan_a["lesson_quotas"], plan_b["lesson_quotas"])
        self.assertEqual(plan_a["lesson_remainder_policy"], "SEEDED_WEIGHTED_WITHOUT_REPLACEMENT")

    def test_uniform_short_test_is_seeded_and_exact(self):
        a = lesson_quotas(lesson_config("custom", 10, "alpha", "UNIFORM"), LESSONS, seed="alpha")
        b = lesson_quotas(lesson_config("custom", 10, "alpha", "UNIFORM"), LESSONS, seed="alpha")
        c = lesson_quotas(lesson_config("custom", 10, "beta", "UNIFORM"), LESSONS, seed="beta")
        self.assertEqual(a, b)
        self.assertEqual(sum(a.values()), 10)
        self.assertEqual(sum(value == 1 for value in a.values()), 10)
        self.assertTrue(all(value in {0, 1} for value in a.values()))
        self.assertNotEqual(
            {key for key, value in a.items() if value},
            {key for key, value in c.items() if value},
        )

    def test_uniform_long_run_has_no_fixed_uuid_subset(self):
        frequency = Counter()
        for index in range(1000):
            seed = f"uniform-{index}"
            quota = lesson_quotas(
                lesson_config("custom", 10, seed, "UNIFORM"),
                LESSONS,
                seed=seed,
            )
            frequency.update({lesson: amount for lesson, amount in quota.items() if amount})
        self.assertEqual(len(frequency), 52)
        # Expected frequency is ~192.3. This broad band catches starvation/fixed-first-10
        # regressions while remaining robust to deterministic pseudo-random variation.
        self.assertGreater(min(frequency.values()), 130)
        self.assertLess(max(frequency.values()), 260)

    def test_uniform_52_questions_gives_every_lesson_one(self):
        quota = lesson_quotas(
            lesson_config("custom", 52, "all-once", "UNIFORM"),
            LESSONS,
            seed="all-once",
        )
        self.assertEqual(set(quota.values()), {1})

    def test_tcf_weighted_short_test_varies_across_seeds_and_tracks_weights(self):
        weights = {lesson: float(index) for index, lesson in enumerate(LESSONS, start=1)}
        frequency = Counter()
        signatures = set()
        for index in range(3000):
            seed = f"tcf-{index}"
            quota = lesson_quotas(
                lesson_config("tcf", 10, seed, "TCF_WEIGHTED"),
                LESSONS,
                weights,
                seed=seed,
            )
            selected = tuple(sorted(lesson for lesson, amount in quota.items() if amount))
            signatures.add(selected)
            frequency.update(selected)
        self.assertGreater(len(signatures), 100)
        self.assertEqual(len(frequency), 52)
        low_quartile = sum(frequency[lesson] for lesson in LESSONS[:13])
        high_quartile = sum(frequency[lesson] for lesson in LESSONS[-13:])
        self.assertGreater(high_quartile, low_quartile * 2)

    def test_tcf_same_seed_replays_exactly(self):
        weights = {lesson: float(index) for index, lesson in enumerate(LESSONS, start=1)}
        cfg = lesson_config("tcf", 10, "replay", "TCF_WEIGHTED")
        self.assertEqual(
            lesson_quotas(cfg, LESSONS, weights, seed="replay"),
            lesson_quotas(cfg, LESSONS, weights, seed="replay"),
        )

    def test_adaptive_default_ten_has_two_real_exploration_selections(self):
        pool = [
            candidate(f"q-{i}", f"u-{i}", lesson=f"L{(i % 8) + 1:02d}", score="high" if i < 8 else "low", question_type=f"T{i % 4}")
            for i in range(40)
        ]
        result = select_adaptive({"question_count": 10, "seed": "adaptive-ten"}, pool)
        reasons = [item["selection_meta"]["selection_reason"] for item in result["selected"]]
        self.assertEqual(result["exploration_count"], 2)
        self.assertEqual(reasons.count("EXPLORE"), 2)
        self.assertEqual(len(result["selected"]), 10)

    def test_explore_candidate_is_chosen_independently_of_adaptive_score(self):
        low = candidate("low", "u-low", lesson="L01", score="low")
        high = candidate("high", "u-high", lesson="L01", score="high")
        self.assertGreater(score_candidate(high)["adjusted_score"], score_candidate(low)["adjusted_score"])
        result = select_adaptive(
            {
                "question_count": 1,
                "seed": "seed-0",
                "exploration": {"share": 1.0},
                "diversity": {"max_lesson_share": 1.0, "max_type_share": 1.0},
            },
            [low, high],
        )
        self.assertEqual(result["selected"][0]["question_revision_id"], "low")
        self.assertEqual(result["selected"][0]["selection_meta"]["selection_reason"], "EXPLORE")

    def test_adaptive_same_seed_is_replayable(self):
        pool = [
            candidate(f"q-{i}", f"u-{i}", lesson=f"L{(i % 6) + 1:02d}", question_type=f"T{i % 3}")
            for i in range(30)
        ]
        config = {"question_count": 8, "seed": "same-seed"}
        first = select_adaptive(config, pool)
        second = select_adaptive(config, pool)
        self.assertEqual(first["selection_digest"], second["selection_digest"])
        self.assertEqual(first["selected"], second["selected"])

    def test_adaptive_cooldown_still_blocks_recent_high_score_item(self):
        recent_high = candidate("recent", "u-recent", lesson="L01", score="high", seen=1)
        cool_low = candidate("cool", "u-cool", lesson="L02", score="low", seen=30)
        result = select_adaptive(
            {
                "question_count": 1,
                "seed": "cooldown",
                "exploration": {"share": 0.0},
                "diversity": {"max_lesson_share": 1.0, "max_type_share": 1.0},
            },
            [recent_high, cool_low],
        )
        self.assertEqual(result["selected"][0]["question_revision_id"], "cool")

    def test_adaptive_deduplicates_logical_question_uid(self):
        first_revision = candidate("q1", "same-uid", lesson="L01", score="high", question_type="T1")
        second_revision = candidate("q2", "same-uid", lesson="L02", score="high", question_type="T2")
        other = candidate("q3", "other-uid", lesson="L03", score="low", question_type="T3")
        result = select_adaptive(
            {
                "question_count": 2,
                "seed": "uid-dedupe",
                "exploration": {"share": 0.0},
                "diversity": {"max_lesson_share": 1.0, "max_type_share": 1.0},
            },
            [first_revision, second_revision, other],
        )
        uids = [item["question_uid"] for item in result["selected"]]
        self.assertEqual(len(uids), len(set(uids)))
        self.assertIn("other-uid", uids)

    def test_adaptive_preserves_runtime_candidate_fields(self):
        item = candidate("q-runtime", "u-runtime", lesson="L01", question_type="CLOZE_SINGLE")
        item["compatibility_status"] = "PREFERRED"
        result = select_adaptive(
            {
                "question_count": 1,
                "seed": "runtime-fields",
                "exploration": {"share": 0.0},
                "diversity": {"max_lesson_share": 1.0, "max_type_share": 1.0},
            },
            [item],
        )
        selected = result["selected"][0]
        self.assertEqual(selected["question_type_code"], "CLOZE_SINGLE")
        self.assertEqual(selected["compatibility_status"], "PREFERRED")
        self.assertEqual(
            selected["selection_meta"]["score"]["adjusted_score"],
            selected["selection_meta"]["adjusted_score"],
        )
        self.assertEqual(
            selected["selection_meta"]["selector_version"],
            "adaptive-selector-v0.9.1",
        )
        self.assertNotIn("_score", selected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
