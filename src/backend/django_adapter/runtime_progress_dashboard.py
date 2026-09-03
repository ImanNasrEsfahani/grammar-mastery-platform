from __future__ import annotations

"""Read-only progress analytics enrichment for the learner dashboard.

The core dashboard provider intentionally exposes canonical mastery/review state.
This additive provider keeps that behavior unchanged and enriches only the
learner-facing dashboard response with chart-ready analytics derived from
persisted attempts, answers, and frozen question snapshots.

No mock/fallback learning values are generated. When there is no persisted
learning evidence, the corresponding series remains empty.
"""

from datetime import timedelta
from decimal import Decimal
from typing import Any, Mapping
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter import runtime_review


PROGRESS_ANALYTICS_VERSION = "progress-analytics-v1.0.0"
PROGRESS_HISTORY_DAYS = 365
DIFFICULTY_ORDER = ("EASY", "MEDIUM", "HARD", "VERY_HARD")


def _float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _pct(correct: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(100.0 * int(correct) / int(total), 6)


def _load_progress_analytics(
    cursor,
    user_id: uuid.UUID,
    *,
    as_of,
) -> dict[str, Any]:
    """Build real chart data from persisted learner evidence.

    Study minutes use the same completed-attempt elapsed-time semantics already
    used by the attempt-result runtime (completed_at - started_at). Accuracy is
    derived from persisted user_answers. Difficulty comes from each frozen
    test-question snapshot, so later content edits cannot rewrite history.
    """

    since = as_of - timedelta(days=PROGRESS_HISTORY_DAYS)

    # Daily series for the Progress page. A FULL OUTER JOIN preserves days that
    # contain answer evidence even if no attempt completed on that exact day,
    # and vice versa.
    cursor.execute(
        """
        WITH answer_daily AS (
            SELECT
                (ua.answered_at AT TIME ZONE 'UTC')::date AS activity_date,
                count(*) AS questions_answered,
                count(*) FILTER (WHERE ua.is_correct IS TRUE) AS correct_answers
            FROM user_answers AS ua
            JOIN test_attempts AS ta
              ON ta.id = ua.attempt_id
            WHERE ta.user_id = %s
              AND ua.answered_at >= %s
              AND ua.answered_at <= %s
            GROUP BY 1
        ),
        attempt_daily AS (
            SELECT
                (ta.completed_at AT TIME ZONE 'UTC')::date AS activity_date,
                count(*) AS tests_completed,
                COALESCE(
                    SUM(
                        GREATEST(
                            EXTRACT(EPOCH FROM (ta.completed_at - ta.started_at)),
                            0.0
                        )
                    ) / 60.0,
                    0.0
                ) AS minutes_practiced
            FROM test_attempts AS ta
            WHERE ta.user_id = %s
              AND ta.status = 'COMPLETED'
              AND ta.started_at IS NOT NULL
              AND ta.completed_at IS NOT NULL
              AND ta.completed_at >= %s
              AND ta.completed_at <= %s
            GROUP BY 1
        )
        SELECT
            COALESCE(a.activity_date, t.activity_date) AS activity_date,
            COALESCE(t.minutes_practiced, 0.0) AS minutes_practiced,
            COALESCE(a.questions_answered, 0) AS questions_answered,
            COALESCE(a.correct_answers, 0) AS correct_answers,
            COALESCE(t.tests_completed, 0) AS tests_completed
        FROM answer_daily AS a
        FULL OUTER JOIN attempt_daily AS t
          ON t.activity_date = a.activity_date
        ORDER BY activity_date
        """,
        [user_id, since, as_of, user_id, since, as_of],
    )

    daily: list[dict[str, Any]] = []
    for (
        activity_date,
        minutes_practiced,
        questions_answered,
        correct_answers,
        tests_completed,
    ) in cursor.fetchall():
        question_count = int(questions_answered or 0)
        correct_count = int(correct_answers or 0)
        daily.append(
            {
                "date": activity_date.isoformat(),
                "minutes_practiced": round(max(0.0, _float(minutes_practiced)), 2),
                "questions_answered": question_count,
                "correct_answers": correct_count,
                "accuracy_pct": _pct(correct_count, question_count),
                "tests_completed": int(tests_completed or 0),
            }
        )

    # All-time activity totals. These are additive aliases for the current
    # dashboard activity projection and also populate the existing Progress UI.
    cursor.execute(
        """
        SELECT
            (
                SELECT count(*)
                FROM user_answers AS ua
                JOIN test_attempts AS ta
                  ON ta.id = ua.attempt_id
                WHERE ta.user_id = %s
            ) AS questions_answered,
            (
                SELECT count(*)
                FROM user_answers AS ua
                JOIN test_attempts AS ta
                  ON ta.id = ua.attempt_id
                WHERE ta.user_id = %s
                  AND ua.is_correct IS TRUE
            ) AS correct_answers,
            (
                SELECT count(*)
                FROM test_attempts AS ta
                WHERE ta.user_id = %s
                  AND ta.status = 'COMPLETED'
            ) AS tests_completed,
            (
                SELECT COALESCE(
                    SUM(
                        GREATEST(
                            EXTRACT(EPOCH FROM (ta.completed_at - ta.started_at)),
                            0.0
                        )
                    ) / 60.0,
                    0.0
                )
                FROM test_attempts AS ta
                WHERE ta.user_id = %s
                  AND ta.status = 'COMPLETED'
                  AND ta.started_at IS NOT NULL
                  AND ta.completed_at IS NOT NULL
            ) AS minutes_practiced
        """,
        [user_id, user_id, user_id, user_id],
    )
    (
        total_questions,
        total_correct,
        total_tests,
        total_minutes,
    ) = cursor.fetchone()
    total_questions = int(total_questions or 0)
    total_correct = int(total_correct or 0)
    total_tests = int(total_tests or 0)
    overall_accuracy = _pct(total_correct, total_questions)

    # Accuracy by canonical difficulty code, based on the frozen snapshot served
    # in the historical attempt. This keeps analytics audit-safe if bank content
    # is edited or republished later.
    cursor.execute(
        """
        SELECT
            UPPER(
                COALESCE(
                    NULLIF(tq.question_snapshot->>'difficulty', ''),
                    'UNKNOWN'
                )
            ) AS difficulty,
            count(*) AS total,
            count(*) FILTER (WHERE ua.is_correct IS TRUE) AS correct
        FROM user_answers AS ua
        JOIN test_attempts AS ta
          ON ta.id = ua.attempt_id
        JOIN test_questions AS tq
          ON tq.id = ua.test_question_id
         AND tq.test_id = ta.test_id
        WHERE ta.user_id = %s
        GROUP BY 1
        """,
        [user_id],
    )

    difficulty_rows = []
    for difficulty, total, correct in cursor.fetchall():
        total_value = int(total or 0)
        correct_value = int(correct or 0)
        difficulty_rows.append(
            {
                "difficulty": str(difficulty),
                "total": total_value,
                "correct": correct_value,
                "incorrect": max(0, total_value - correct_value),
                "accuracy_pct": _pct(correct_value, total_value),
            }
        )

    order = {name: index for index, name in enumerate(DIFFICULTY_ORDER)}
    difficulty_rows.sort(
        key=lambda row: (
            order.get(str(row["difficulty"]), len(order)),
            str(row["difficulty"]),
        )
    )

    # ProgressClient currently renders three learner-facing difficulty bands.
    # Preserve the canonical four-code breakdown separately, while presenting
    # HARD + VERY_HARD as one ADVANCED band for that existing UI.
    by_code = {str(row["difficulty"]): row for row in difficulty_rows}
    ui_difficulty: list[dict[str, Any]] = []
    for label, codes in (
        ("BEGINNER", ("EASY",)),
        ("INTERMEDIATE", ("MEDIUM",)),
        ("ADVANCED", ("HARD", "VERY_HARD")),
    ):
        total_value = sum(int(by_code.get(code, {}).get("total", 0)) for code in codes)
        correct_value = sum(int(by_code.get(code, {}).get("correct", 0)) for code in codes)
        if total_value <= 0:
            continue
        ui_difficulty.append(
            {
                "difficulty": label,
                "total": total_value,
                "correct": correct_value,
                "incorrect": max(0, total_value - correct_value),
                "accuracy_pct": _pct(correct_value, total_value),
            }
        )

    return {
        "analytics_version": PROGRESS_ANALYTICS_VERSION,
        "daily": daily,
        "accuracy_pct": overall_accuracy,
        "difficulty_breakdown": ui_difficulty,
        "raw_difficulty_breakdown": difficulty_rows,
        "questions_answered": total_questions,
        "correct_answers": total_correct,
        "tests_completed": total_tests,
        "minutes_practiced": round(max(0.0, _float(total_minutes)), 2),
    }


def dashboard_request(request) -> Response:
    """Return the canonical dashboard plus real chart analytics."""

    response = runtime_review.dashboard_request(request)
    body = getattr(response, "data", None)
    if response.status_code != 200 or not isinstance(body, Mapping):
        return response

    dashboard_data = body.get("data")
    if not isinstance(dashboard_data, Mapping):
        return response

    principal = runtime_review._principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    as_of = timezone.now()

    with connection.cursor() as cursor:
        analytics = _load_progress_analytics(
            cursor,
            user_id,
            as_of=as_of,
        )

    mutable_body = dict(body)
    mutable_data = dict(dashboard_data)

    trend = dict(mutable_data.get("trend") or {})
    trend.update(
        {
            "analytics_version": analytics["analytics_version"],
            "daily": analytics["daily"],
            # The existing ProgressClient recognizes this key for its Accuracy KPI.
            "recent_accuracy": analytics["accuracy_pct"],
            "accuracy_pct": analytics["accuracy_pct"],
            "difficulty_breakdown": analytics["difficulty_breakdown"],
        }
    )

    activity = dict(mutable_data.get("activity") or {})
    activity.update(
        {
            "analytics_version": analytics["analytics_version"],
            "questions_answered": analytics["questions_answered"],
            "correct_answers": analytics["correct_answers"],
            "tests_completed": analytics["tests_completed"],
            # Alias already recognized by ProgressClient's activity metrics.
            "completed_attempts": analytics["tests_completed"],
            "minutes_practiced": analytics["minutes_practiced"],
            "accuracy_pct": analytics["accuracy_pct"],
            "difficulty_breakdown": analytics["difficulty_breakdown"],
        }
    )

    mutable_data["trend"] = trend
    mutable_data["activity"] = activity
    mutable_body["data"] = mutable_data
    response.data = mutable_body
    return response
