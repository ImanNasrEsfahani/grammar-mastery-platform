from datetime import date, timedelta

from backend.django_adapter.runtime_streak import _date_series, _streak_metrics


def test_date_series_is_inclusive():
    start = date(2026, 8, 1)
    end = date(2026, 8, 3)
    assert _date_series(start, end) == [
        date(2026, 8, 1),
        date(2026, 8, 2),
        date(2026, 8, 3),
    ]


def test_current_streak_counts_today_backwards():
    today = date(2026, 8, 26)
    active = [today - timedelta(days=offset) for offset in range(7)]
    result = _streak_metrics(active, today)
    assert result["current_streak_days"] == 7
    assert result["longest_streak_days"] == 7
    assert result["streak_status"] == "ACTIVE_TODAY"
    assert result["milestones"]["achieved_days"] == [7]
    assert result["milestones"]["next_days"] == 14
    assert result["milestones"]["remaining_days"] == 7
    assert result["milestones"]["progress_pct"] == 50


def test_streak_is_at_risk_until_today_ends():
    today = date(2026, 8, 26)
    active = [today - timedelta(days=offset) for offset in range(1, 8)]
    result = _streak_metrics(active, today)
    assert result["current_streak_days"] == 7
    assert result["streak_status"] == "AT_RISK_TODAY"


def test_streak_breaks_after_a_full_missed_day():
    today = date(2026, 8, 26)
    active = [today - timedelta(days=2), today - timedelta(days=3)]
    result = _streak_metrics(active, today)
    assert result["current_streak_days"] == 0
    assert result["longest_streak_days"] == 2
    assert result["streak_status"] == "BROKEN"


def test_longest_streak_is_all_time_not_just_current_chain():
    today = date(2026, 8, 26)
    old_start = date(2026, 7, 1)
    active = [old_start + timedelta(days=offset) for offset in range(18)]
    active.extend([today - timedelta(days=offset) for offset in range(7)])
    result = _streak_metrics(active, today)
    assert result["current_streak_days"] == 7
    assert result["longest_streak_days"] == 18
