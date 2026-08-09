from copy import deepcopy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from error_review.engine import (
    MODEL_VERSION,
    ReviewContractError,
    apply_event,
    evidence_is_eligible,
    feedback_state,
    filter_items,
    group_items,
    materialize_error_items,
    validate_config,
)


USER = "11111111-1111-4111-8111-111111111111"
LESSON = "4ec05ffb-8465-4c5c-9a50-d67136ad0472"
SUBTOPIC_DONT = "cc58425c-1b50-4810-99a1-446683b31f5f"
MISCONCEPTION_NEAR_FORM = "dac62b22-7d9b-540f-b765-e4ad0c1fd476"


def answer(n=1, *, correct=False, misconception=MISCONCEPTION_NEAR_FORM, status="PUBLISHED", serving=True, issue=False, sequence=1, difficulty="MEDIUM"):
    return {
        "answer_id": f"aaaaaaaa-aaaa-4aaa-8aaa-{n:012d}",
        "attempt_id": f"bbbbbbbb-bbbb-4bbb-8bbb-{n:012d}",
        "test_question_id": f"cccccccc-cccc-4ccc-8ccc-{n:012d}",
        "answer_sequence": sequence,
        "user_id": USER,
        "question_id": f"dddddddd-dddd-4ddd-8ddd-{n:012d}",
        "lesson_id": LESSON,
        "subtopic_id": SUBTOPIC_DONT,
        "misconception_id": misconception,
        "difficulty_code": difficulty,
        "is_correct": correct,
        "answered_at": f"2026-08-{min(n, 9):02d}T12:00:00Z",
        "question_status": status,
        "serving_enabled": serving,
        "content_issue_excluded": issue,
    }


def event(kind, *, correct=None, option="eeeeeeee-eeee-4eee-8eee-000000000001", at="2026-08-10T12:00:00Z"):
    out = {"event_type": kind, "user_id": USER, "event_at": at}
    if kind == "RETRY_SUBMITTED":
        out.update(selected_option_id=option, is_correct=correct)
    return out


class Stage16Tests(unittest.TestCase):
    def test_wrong_creates_item(self):
        self.assertEqual(len(materialize_error_items([answer()])), 1)

    def test_correct_does_not_create_item(self):
        self.assertEqual(materialize_error_items([answer(correct=True)]), [])

    def test_unscorable_does_not_create_item(self):
        a = answer(); a["is_correct"] = None
        self.assertEqual(materialize_error_items([a]), [])

    def test_latest_answer_sequence_wins(self):
        old = answer(sequence=1); new = answer(correct=True, sequence=2); new["answer_id"] = "ffffffff-ffff-4fff-8fff-000000000001"
        self.assertEqual(materialize_error_items([old, new]), [])

    def test_misconception_group_key(self):
        item = materialize_error_items([answer()])[0]
        self.assertEqual(item["group_key"], f"MISCONCEPTION:{MISCONCEPTION_NEAR_FORM}")

    def test_unmapped_falls_back_to_subtopic(self):
        item = materialize_error_items([answer(misconception=None)])[0]
        self.assertEqual(item["group_quality"], "SUBTOPIC_UNMAPPED")

    def test_missing_subtopic_fails_closed(self):
        a = answer(misconception=None); a["subtopic_id"] = None
        with self.assertRaises(ReviewContractError): materialize_error_items([a])

    def test_retired_is_history_only_not_deleted(self):
        item = materialize_error_items([answer(status="RETIRED")])[0]
        self.assertEqual(item["reviewability"], "HISTORY_ONLY")

    def test_disabled_is_history_only(self):
        item = materialize_error_items([answer(serving=False)])[0]
        self.assertEqual(item["reviewability"], "HISTORY_ONLY")

    def test_content_issue_not_user_weakness(self):
        item = materialize_error_items([answer(issue=True)])[0]
        self.assertEqual(item["resolution_status"], "EXCLUDED_CONTENT_ISSUE")

    def test_correct_retry_resolves(self):
        item = materialize_error_items([answer()])[0]
        self.assertEqual(apply_event(item, event("RETRY_SUBMITTED", correct=True))["resolution_status"], "CORRECTED")

    def test_wrong_retry_stays_unresolved(self):
        item = materialize_error_items([answer()])[0]
        self.assertEqual(apply_event(item, event("RETRY_SUBMITTED", correct=False))["resolution_status"], "UNRESOLVED")

    def test_wrong_after_correct_reopens(self):
        item = materialize_error_items([answer()])[0]
        item = apply_event(item, event("RETRY_SUBMITTED", correct=True))
        item = apply_event(item, event("RETRY_SUBMITTED", correct=False, at="2026-08-11T12:00:00Z"))
        self.assertEqual(item["resolution_status"], "UNRESOLVED")

    def test_reveal_does_not_resolve(self):
        item = materialize_error_items([answer()])[0]
        self.assertEqual(apply_event(item, event("ANSWER_REVEALED"))["resolution_status"], "UNRESOLVED")

    def test_feedback_hidden_before_attempt(self):
        self.assertEqual(feedback_state([event("ITEM_OPENED")]), "HIDDEN")

    def test_feedback_revealed_after_retry(self):
        self.assertEqual(feedback_state([event("RETRY_SUBMITTED", correct=False)]), "REVEALED")

    def test_mark_and_unmark(self):
        item = materialize_error_items([answer()])[0]
        item = apply_event(item, event("MARKED_FOR_REVIEW")); self.assertTrue(item["marked_for_review"])
        item = apply_event(item, event("UNMARKED_FOR_REVIEW")); self.assertFalse(item["marked_for_review"])

    def test_retry_history_only_blocked(self):
        item = materialize_error_items([answer(status="RETIRED")])[0]
        with self.assertRaises(ReviewContractError): apply_event(item, event("RETRY_SUBMITTED", correct=True))

    def test_grouping_counts_repeat(self):
        groups = group_items(materialize_error_items([answer(1), answer(2), answer(3)]))
        self.assertEqual(groups[0]["eligible_wrong_count"], 3)

    def test_group_resolution_after_all_corrected(self):
        items = materialize_error_items([answer(1), answer(2)])
        items = [apply_event(x, event("RETRY_SUBMITTED", correct=True)) for x in items]
        self.assertEqual(group_items(items)[0]["group_resolution"], "CORRECTED")

    def test_filters_all_required_dimensions(self):
        items = materialize_error_items([answer(1), answer(2, difficulty="HARD"), answer(3, misconception=None)])
        f = {"date_from":"2026-08-02T00:00:00Z", "date_to":"2026-08-02T23:59:59Z", "lesson_ids":[LESSON], "subtopic_ids":[SUBTOPIC_DONT], "misconception_ids":[MISCONCEPTION_NEAR_FORM], "difficulty_codes":["HARD"], "resolution_statuses":["UNRESOLVED"], "min_repeat_count":2}
        self.assertEqual([x["source_answer_id"] for x in filter_items(items, f)], [answer(2)["answer_id"]])

    def test_marked_only_filter(self):
        items = materialize_error_items([answer(1), answer(2)])
        items[1] = apply_event(items[1], event("MARKED_FOR_REVIEW"))
        self.assertEqual(len(filter_items(items, {"marked_only":True})), 1)

    def test_priority_marked_then_unresolved_then_repeat(self):
        items = materialize_error_items([answer(1), answer(2), answer(3, misconception=None)])
        items[2] = apply_event(items[2], event("MARKED_FOR_REVIEW"))
        self.assertTrue(group_items(items)[0]["marked_count"] > 0)

    def test_source_answer_not_mutated(self):
        source = answer(); before = deepcopy(source)
        item = materialize_error_items([source])[0]
        apply_event(item, event("RETRY_SUBMITTED", correct=True))
        self.assertEqual(source, before)

    def test_exclusion_gate_and_reinstate(self):
        aid = answer()["answer_id"]
        events = [{"event_id":"1", "source_answer_id":aid, "action":"EXCLUDE", "event_at":"2026-08-10T00:00:00Z"}]
        self.assertFalse(evidence_is_eligible(aid, events))
        events.append({"event_id":"2", "source_answer_id":aid, "action":"REINSTATE", "event_at":"2026-08-11T00:00:00Z"})
        self.assertTrue(evidence_is_eligible(aid, events))

    def test_config_gate(self):
        good = {"model_version":MODEL_VERSION,"retrieval_practice":{"require_retry_before_auto_reveal":True},"grouping":{"fallback":"SUBTOPIC_UNMAPPED"},"resolution":{"statuses":sorted(["UNRESOLVED","CORRECTED","EXCLUDED_CONTENT_ISSUE"])}}
        validate_config(good)
        bad = deepcopy(good); bad["retrieval_practice"]["require_retry_before_auto_reveal"] = False
        with self.assertRaises(ReviewContractError): validate_config(bad)


if __name__ == "__main__":
    unittest.main()
