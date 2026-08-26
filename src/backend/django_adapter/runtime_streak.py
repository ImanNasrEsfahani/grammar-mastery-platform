from __future__ import annotations

"""Daily Goal / Streak provider based only on real accepted answers.

ACTIVE_DAY is an application-local calendar day with at least one accepted
user answer. Login, dashboard visits and notification views never extend the
streak. If yesterday was active and today has not yet been active, the streak
is AT_RISK_TODAY rather than prematurely broken.
"""

from datetime import date, datetime, time, timedelta
from typing import Any, Iterable
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter import runtime_dashboard


STREAK_RUNTIME_VERSION = "postgres-streak-detail-provider-v1.0.1"
MILESTONES = (7, 14, 30, 60)
WINDOW_DAYS = 30
WEEK_DAYS = 7

_principal = runtime_dashboard._principal
_uuid = runtime_dashboard._uuid
_api_meta = runtime_dashboard._api_meta


def _date_series(start: date, end: date) -> list[date]:
    if end < start:
        return []
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def _streak_metrics(active_dates: Iterable[date], today: date) -> dict[str, Any]:
    ordered = sorted(set(active_dates))
    active = set(ordered)

    if today in active:
        anchor = today
        status = "ACTIVE_TODAY"
    elif today - timedelta(days=1) in active:
        anchor = today - timedelta(days=1)
        status = "AT_RISK_TODAY"
    else:
        anchor = None
        status = "BROKEN"

    current = 0
    cursor = anchor
    while cursor is not None and cursor in active:
        current += 1
        cursor -= timedelta(days=1)

    longest = 0
    running = 0
    previous: date | None = None
    for item in ordered:
        if previous is not None and item == previous + timedelta(days=1):
            running += 1
        else:
            running = 1
        longest = max(longest, running)
        previous = item

    achieved = [days for days in MILESTONES if current >= days]
    next_days = next((days for days in MILESTONES if current < days), None)
    if next_days is None:
        remaining = 0
        progress_pct = 100
    else:
        remaining = max(0, next_days - current)
        progress_pct = min(100, round((current / next_days) * 100))

    return {
        "current_streak_days": current,
        "longest_streak_days": longest,
        "streak_status": status,
        "milestones": {
            "achieved_days": achieved,
            "next_days": next_days,
            "remaining_days": remaining,
            "progress_pct": progress_pct,
        },
    }


def _activity_by_day(user_id: uuid.UUID, *, start: date, end: date) -> dict[date, dict[str, int]]:
    tz = timezone.get_current_timezone()
    tz_name = timezone.get_current_timezone_name()
    lower = timezone.make_aware(datetime.combine(start, time.min), tz)
    upper = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), tz)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                timezone(%s, ua.answered_at)::date AS activity_date,
                count(*) AS questions_answered,
                COALESCE(sum(COALESCE(ua.response_ms, 0)), 0) AS response_ms,
                count(ua.response_ms) AS timed_answer_count
            FROM user_answers AS ua
            JOIN test_attempts AS ta ON ta.id = ua.attempt_id
            WHERE ta.user_id = %s
              AND ua.answered_at IS NOT NULL
              AND ua.answered_at >= %s
              AND ua.answered_at < %s
            GROUP BY 1
            ORDER BY 1
            """,
            [tz_name, user_id, lower, upper],
        )
        rows = cursor.fetchall()

    return {
        row[0]: {
            "questions_answered": int(row[1] or 0),
            "practice_seconds": max(0, round(int(row[2] or 0) / 1000)),
            "timed_answer_count": int(row[3] or 0),
        }
        for row in rows
    }


def _all_active_dates(user_id: uuid.UUID) -> list[date]:
    tz_name = timezone.get_current_timezone_name()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT timezone(%s, ua.answered_at)::date AS activity_date
            FROM user_answers AS ua
            JOIN test_attempts AS ta ON ta.id = ua.attempt_id
            WHERE ta.user_id = %s
              AND ua.answered_at IS NOT NULL
            ORDER BY 1
            """,
            [tz_name, user_id],
        )
        return [row[0] for row in cursor.fetchall() if row[0] is not None]


def _day_projection(item: date, aggregate: dict[date, dict[str, int]]) -> dict[str, Any]:
    stored = aggregate.get(item)
    if stored is None:
        return {"date": item.isoformat(), "questions_answered": 0, "practice_seconds": 0, "timed_answer_count": 0, "active": False}
    return {
        "date": item.isoformat(),
        "questions_answered": stored["questions_answered"],
        "practice_seconds": stored["practice_seconds"],
        "timed_answer_count": stored["timed_answer_count"],
        "active": stored["questions_answered"] > 0,
    }


def _streak_projection(user_id: uuid.UUID, *, as_of: datetime | None = None) -> dict[str, Any]:
    timestamp = as_of or timezone.now()
    local_today = timezone.localdate(timestamp)
    start_30 = local_today - timedelta(days=WINDOW_DAYS - 1)
    aggregate = _activity_by_day(user_id, start=start_30, end=local_today)
    active_dates = _all_active_dates(user_id)
    streak = _streak_metrics(active_dates, local_today)

    calendar_days = [_day_projection(item, aggregate) for item in _date_series(start_30, local_today)]
    active_30 = sum(1 for item in calendar_days if item["active"])
    today_row = calendar_days[-1]
    yesterday_row = calendar_days[-2] if len(calendar_days) >= 2 else None
    today_questions = int(today_row["questions_answered"])
    yesterday_questions = int(yesterday_row["questions_answered"]) if yesterday_row else 0
    timed_today = int(today_row["timed_answer_count"])
    coverage = None if today_questions == 0 else timed_today / today_questions

    week_days = calendar_days[-WEEK_DAYS:]
    average_seconds = round(sum(int(item["practice_seconds"]) for item in week_days) / max(1, len(week_days)))

    return {
        "as_of": timestamp.isoformat(),
        "timezone": timezone.get_current_timezone_name(),
        "provider_version": STREAK_RUNTIME_VERSION,
        "policy": {
            "streak_rule": "ACTIVE_DAY",
            "active_day_definition": "at least one accepted user answer in the application-local calendar day",
        },
        **streak,
        "today": {
            "questions_answered": today_questions,
            "question_delta_vs_yesterday": today_questions - yesterday_questions,
            "practice_seconds": int(today_row["practice_seconds"]),
            "timed_answer_count": timed_today,
            "timing_coverage_ratio": coverage,
        },
        "consistency_30d": {
            "active_days": active_30,
            "total_days": len(calendar_days),
            "rate_pct": round((active_30 / len(calendar_days)) * 100) if calendar_days else 0,
            "days": calendar_days,
        },
        "week": {"days": week_days, "average_practice_seconds": average_seconds},
    }


def streak_detail_request(request) -> Response:
    principal = _principal(request)
    data = _streak_projection(_uuid(principal.user_id))
    return Response({"data": data, "meta": _api_meta(request)}, status=200)
