from datetime import datetime, timezone

from spaced_repetition.review_policy import (
    POLICY_VERSION,
    apply_review_outcome,
    next_interval_days,
)

NOW = datetime(2026, 8, 22, 17, 0, tzinfo=timezone.utc)


def test_wrong_review_is_due_tomorrow_and_resets_streak():
    out = apply_review_outcome(
        current_interval_days=30,
        consecutive_correct_reviews=4,
        lapse_count=2,
        is_correct=False,
        event_at=NOW,
    )
    assert out["learning_state"] == "LAPSED"
    assert out["status"] == "SCHEDULED"
    assert out["interval_days"] == 1.0
    assert out["consecutive_correct_reviews"] == 0
    assert out["lapse_count"] == 3
    assert out["due_at"] == "2026-08-23T17:00:00Z"
    assert out["policy_version"] == POLICY_VERSION


def test_correct_review_expands_interval():
    out = apply_review_outcome(
        current_interval_days=7,
        consecutive_correct_reviews=1,
        lapse_count=0,
        is_correct=True,
        event_at=NOW,
    )
    assert out["interval_days"] == 14.0
    assert out["consecutive_correct_reviews"] == 2
    assert out["graduated"] is False
    assert out["learning_state"] == "REVIEW"


def test_third_spaced_success_graduates_when_next_interval_exceeds_month():
    out = apply_review_outcome(
        current_interval_days=30,
        consecutive_correct_reviews=2,
        lapse_count=0,
        is_correct=True,
        event_at=NOW,
    )
    assert out["interval_days"] == 60.0
    assert out["consecutive_correct_reviews"] == 3
    assert out["graduated"] is True
    assert out["status"] == "COMPLETED"
    assert out["learning_state"] is None


def test_interval_steps_are_monotonic():
    assert [next_interval_days(x) for x in (0, 1, 3, 7, 14, 30)] == [
        1.0, 3.0, 7.0, 14.0, 30.0, 60.0
    ]
