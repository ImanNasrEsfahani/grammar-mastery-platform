"""Versioned direct-review scheduling policy for the learner review runner.

Rules implemented by the product decision:
- wrong direct review -> due again exactly one day later;
- correct direct review -> advance through 1, 3, 7, 14, 30, 60 days;
- graduate from the active queue after at least three consecutive correct direct
  reviews when the computed next interval is greater than 30 days;
- graduation keeps history, but removes the concept from the active queue by
  storing status=COMPLETED and learning_state=NULL.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

POLICY_VERSION = "review-practice-policy-v1.0.0"
INTERVAL_STEPS_DAYS = (1.0, 3.0, 7.0, 14.0, 30.0, 60.0)
GRADUATION_THRESHOLD_DAYS = 30.0
MIN_CONSECUTIVE_CORRECT_REVIEWS = 3


def _as_utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def next_interval_days(current_interval_days: float) -> float:
    """Return the next strictly longer configured interval."""
    current = max(0.0, float(current_interval_days or 0.0))
    for step in INTERVAL_STEPS_DAYS:
        if step > current + 1e-9:
            return step
    return min(max(current * 2.0, INTERVAL_STEPS_DAYS[-1]), 365.0)


def apply_review_outcome(
    *,
    current_interval_days: float,
    consecutive_correct_reviews: int,
    lapse_count: int,
    is_correct: bool,
    event_at: Any,
) -> Dict[str, Any]:
    """Compute one direct-review transition without mutating persisted state."""
    at = _as_utc(event_at)
    current = max(0.0, float(current_interval_days or 0.0))
    streak = max(0, int(consecutive_correct_reviews or 0))
    lapses = max(0, int(lapse_count or 0))

    if not is_correct:
        interval = 1.0
        return {
            "learning_state": "LAPSED",
            "status": "SCHEDULED",
            "due_at": _iso(at + timedelta(days=interval)),
            "interval_days": interval,
            "consecutive_correct_reviews": 0,
            "lapse_count": lapses + 1,
            "graduated": False,
            "transition_reason": "DIRECT_REVIEW_WRONG_DUE_TOMORROW",
            "policy_version": POLICY_VERSION,
        }

    streak += 1
    interval = next_interval_days(current)
    graduated = (
        interval > GRADUATION_THRESHOLD_DAYS
        and streak >= MIN_CONSECUTIVE_CORRECT_REVIEWS
    )
    return {
        "learning_state": None if graduated else "REVIEW",
        "status": "COMPLETED" if graduated else "SCHEDULED",
        "due_at": _iso(at + timedelta(days=interval)),
        "interval_days": interval,
        "consecutive_correct_reviews": streak,
        "lapse_count": lapses,
        "graduated": graduated,
        "transition_reason": (
            "DIRECT_REVIEW_GRADUATED_OVER_ONE_MONTH"
            if graduated
            else "DIRECT_REVIEW_CORRECT_EXPAND_INTERVAL"
        ),
        "policy_version": POLICY_VERSION,
    }
