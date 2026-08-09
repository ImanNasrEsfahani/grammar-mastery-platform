import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from spaced_repetition.scheduler import (
    DEFAULT_CONFIG,
    build_question_selection_handoff,
    new_state,
    queue_status,
    rank_due,
    transition,
    validate_config,
)


PROVIDER = "mastery-provider-contract-v0.9.0"


def answer(correct, at="2026-08-09T10:00:00Z", band="UNCERTAIN", answer_id="a1"):
    return {
        "kind": "ANSWER",
        "is_correct": correct,
        "answered_at": at,
        "mastery_band": band,
        "mastery_provider_contract_version": PROVIDER,
        "answer_id": answer_id,
    }


class Stage17SchedulerTests(unittest.TestCase):
    def test_01_default_config_valid(self):
        validate_config(DEFAULT_CONFIG)

    def test_02_scope_must_be_subtopic(self):
        cfg = dict(DEFAULT_CONFIG, target_scope="QUESTION")
        with self.assertRaisesRegex(ValueError, "TARGET_SCOPE"):
            validate_config(cfg)

    def test_03_learning_intervals_ordered(self):
        cfg = dict(DEFAULT_CONFIG, learning_intervals_days=[3.0, 1.0])
        with self.assertRaisesRegex(ValueError, "LEARNING_INTERVALS"):
            validate_config(cfg)

    def test_04_new_wrong_enters_learning_one_day(self):
        s = transition(None, answer(False))
        self.assertEqual(s["learning_state"], "LEARNING")
        self.assertEqual(s["interval_days"], 1.0)

    def test_05_new_correct_unstable_enters_learning(self):
        s = transition(None, answer(True))
        self.assertEqual((s["learning_state"], s["success_streak"]), ("LEARNING", 1))

    def test_06_second_unstable_success_uses_three_days(self):
        s1 = transition(None, answer(True))
        s2 = transition(s1, answer(True, "2026-08-10T10:00:00Z", answer_id="a2"))
        self.assertEqual(s2["interval_days"], 3.0)

    def test_07_learning_stable_success_enters_review(self):
        s1 = transition(None, answer(True))
        s2 = transition(s1, answer(True, "2026-08-10T10:00:00Z", "STRONG", "a2"))
        self.assertEqual((s2["learning_state"], s2["interval_days"]), ("REVIEW", 7.0))

    def test_08_review_stable_success_expands_interval(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=7.0)
        out = transition(s, answer(True, band="STRONG"))
        self.assertEqual(out["interval_days"], 14.0)

    def test_09_review_interval_is_capped(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=120.0)
        out = transition(s, answer(True, band="STRONG"))
        self.assertEqual(out["interval_days"], 180.0)

    def test_10_review_wrong_enters_lapsed(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=20.0)
        out = transition(s, answer(False, band="DEVELOPING"))
        self.assertEqual(out["learning_state"], "LAPSED")
        self.assertEqual(out["interval_days"], 3.0)

    def test_11_lapse_count_increments_on_entry(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=8.0, lapse_count=2)
        out = transition(s, answer(False))
        self.assertEqual(out["lapse_count"], 3)

    def test_12_repeated_wrong_while_lapsed_not_double_counted(self):
        s = new_state()
        s.update(learning_state="LAPSED", interval_days=2.0, lapse_count=1)
        out = transition(s, answer(False))
        self.assertEqual(out["lapse_count"], 1)
        self.assertEqual(out["interval_days"], 1.0)

    def test_13_lapsed_stable_success_recovers_review(self):
        s = new_state()
        s.update(learning_state="LAPSED", interval_days=1.0, lapse_count=1)
        out = transition(s, answer(True, band="STRONG"))
        self.assertEqual((out["learning_state"], out["interval_days"]), ("REVIEW", 3.0))

    def test_14_lapsed_unstable_success_returns_learning(self):
        s = new_state()
        s.update(learning_state="LAPSED", interval_days=1.0, lapse_count=1)
        out = transition(s, answer(True, band="DEVELOPING"))
        self.assertEqual((out["learning_state"], out["interval_days"]), ("LEARNING", 1.0))

    def test_15_review_correct_but_unstable_returns_learning(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=14.0)
        out = transition(s, answer(True, band="DEVELOPING"))
        self.assertEqual((out["learning_state"], out["interval_days"]), ("LEARNING", 3.0))

    def test_16_unscorable_answer_is_ignored(self):
        s = new_state()
        out = transition(s, answer(None))
        self.assertEqual(out["learning_state"], "NEW")
        self.assertEqual(out["transition_reason"], "UNSCORABLE_ANSWER_IGNORED")

    def test_17_mastery_provider_mismatch_fails_closed(self):
        e = answer(True)
        e["mastery_provider_contract_version"] = "wrong"
        with self.assertRaisesRegex(ValueError, "PROVIDER_VERSION"):
            transition(None, e)

    def test_18_suspend_preserves_prior_state(self):
        s = new_state()
        s.update(learning_state="REVIEW", due_at="2026-08-15T10:00:00Z", interval_days=7.0)
        out = transition(s, {"kind": "SUSPEND", "event_at": "2026-08-09T11:00:00Z", "reason": "NO_ELIGIBLE_QUESTION_POOL"})
        self.assertEqual((out["learning_state"], out["state_before_suspend"]), ("SUSPENDED", "REVIEW"))

    def test_19_suspend_keeps_due_history(self):
        s = new_state()
        s.update(learning_state="LEARNING", due_at="2026-08-10T10:00:00Z", interval_days=1.0)
        out = transition(s, {"kind": "SUSPEND", "event_at": "2026-08-09T11:00:00Z"})
        self.assertEqual(out["due_at"], "2026-08-10T10:00:00Z")

    def test_20_resume_requires_safe_pool(self):
        s = new_state()
        s.update(learning_state="SUSPENDED", state_before_suspend="LEARNING")
        with self.assertRaisesRegex(ValueError, "SAFE_POOL"):
            transition(s, {"kind": "RESUME", "event_at": "2026-08-09T11:00:00Z", "eligible_question_count": 0})

    def test_21_resume_restores_state_and_due_now_if_overdue(self):
        s = new_state()
        s.update(learning_state="SUSPENDED", state_before_suspend="REVIEW", due_at="2026-08-01T00:00:00Z")
        out = transition(s, {"kind": "RESUME", "event_at": "2026-08-09T11:00:00Z", "eligible_question_count": 2})
        self.assertEqual(out["learning_state"], "REVIEW")
        self.assertEqual(out["due_at"], "2026-08-09T11:00:00Z")

    def test_22_answer_while_suspended_rejected(self):
        s = new_state()
        s.update(learning_state="SUSPENDED")
        with self.assertRaisesRegex(ValueError, "WHILE_SUSPENDED"):
            transition(s, answer(True))

    def test_23_content_replay_downgrade_is_not_lapse(self):
        s = new_state()
        s.update(learning_state="REVIEW", interval_days=14.0, due_at="2026-08-30T00:00:00Z", lapse_count=2)
        out = transition(s, {"kind": "EVIDENCE_REPLAYED", "event_at": "2026-08-09T00:00:00Z", "mastery_band": "DEVELOPING"})
        self.assertEqual(out["learning_state"], "LEARNING")
        self.assertEqual(out["lapse_count"], 2)

    def test_24_content_replay_does_not_auto_promote(self):
        s = new_state()
        s.update(learning_state="LEARNING", interval_days=1.0, due_at="2026-08-10T00:00:00Z")
        out = transition(s, {"kind": "EVIDENCE_REPLAYED", "event_at": "2026-08-09T00:00:00Z", "mastery_band": "STRONG"})
        self.assertEqual(out["learning_state"], "LEARNING")

    def test_25_queue_status_due_and_scheduled(self):
        item = {"learning_state": "LEARNING", "due_at": "2026-08-09T09:00:00Z"}
        self.assertEqual(queue_status(item, "2026-08-09T10:00:00Z"), "DUE")
        item["due_at"] = "2026-08-10T09:00:00Z"
        self.assertEqual(queue_status(item, "2026-08-09T10:00:00Z"), "SCHEDULED")

    def test_26_suspended_never_due(self):
        item = {"learning_state": "SUSPENDED", "due_at": "2020-01-01T00:00:00Z"}
        self.assertEqual(queue_status(item, "2026-08-09T10:00:00Z"), "SUSPENDED")

    def test_27_due_ranking_is_deterministic(self):
        rows = [
            {"subtopic_id": "b", "learning_state": "REVIEW", "due_at": "2026-08-09T09:00:00Z"},
            {"subtopic_id": "a", "learning_state": "LAPSED", "due_at": "2026-08-09T09:00:00Z"},
        ]
        ranked = rank_due(rows, "2026-08-09T10:00:00Z")
        self.assertEqual([x["subtopic_id"] for x in ranked], ["a", "b"])

    def test_28_future_and_suspended_excluded_from_due_rank(self):
        rows = [
            {"subtopic_id": "a", "learning_state": "REVIEW", "due_at": "2026-08-10T00:00:00Z"},
            {"subtopic_id": "b", "learning_state": "SUSPENDED", "due_at": "2020-01-01T00:00:00Z"},
        ]
        self.assertEqual(rank_due(rows, "2026-08-09T10:00:00Z"), [])

    def test_29_selection_handoff_is_concept_scoped(self):
        handoff = build_question_selection_handoff("sub-1", [])
        self.assertEqual((handoff["target_scope"], handoff["subtopic_id"]), ("SUBTOPIC", "sub-1"))

    def test_30_selection_handoff_avoids_recent_question_uids(self):
        history = [{"question_uid": "q1"}, {"question_uid": "q2"}, {"question_uid": "q1"}, {"question_uid": "q3"}, {"question_uid": "q4"}]
        handoff = build_question_selection_handoff("sub-1", history)
        self.assertEqual(handoff["soft_excluded_question_uids"], ["q1", "q2", "q3"])

    def test_31_safety_exclusions_are_never_relaxed(self):
        handoff = build_question_selection_handoff("sub-1", [])
        self.assertFalse(handoff["hard_exclusions_relaxable"])
        self.assertEqual(handoff["hard_requirements"]["question_status"], "PUBLISHED")

    def test_32_transition_does_not_mutate_input(self):
        s = new_state()
        before = dict(s)
        transition(s, answer(False))
        self.assertEqual(s, before)


if __name__ == "__main__":
    unittest.main()
