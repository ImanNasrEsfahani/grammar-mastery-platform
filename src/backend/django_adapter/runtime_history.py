from __future__ import annotations

"""Read-only learner activity history for the Stage 19 History surface.

This provider is intentionally additive to the frozen Stage 21 OpenAPI contract.
It reads existing immutable attempt / answer / question-snapshot evidence and does
not change scoring, mastery, Error Review, SRS, or test-selection state.
"""

from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from typing import Any
import math
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.errors import APIError
from backend.security import Principal


HISTORY_RUNTIME_VERSION = "history-runtime-v1.0.0"
DEFAULT_PAGE_SIZE = 5
ALLOWED_PAGE_SIZES = {5, 10, 20}
SCORE_FILTERS = {"ALL", "STRONG", "DEVELOPING", "NEEDS_WORK"}


def _principal(request) -> Principal:
    principal = getattr(request, "auth", None)
    if not isinstance(principal, Principal):
        raise APIError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
    return principal


def _meta(request) -> dict[str, str]:
    return {
        "request_id": str(getattr(request, "request_id", "") or uuid.uuid4()),
        "api_version": "v1",
    }


def _float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, dt_timezone.utc)
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _positive_int(raw: Any, *, field: str, default: int, maximum: int) -> int:
    if raw in (None, ""):
        return default
    try:
        value = int(str(raw))
    except (TypeError, ValueError) as exc:
        raise APIError(400, "BAD_QUERY", f"{field} must be an integer.") from exc
    if value < 1 or value > maximum:
        raise APIError(400, "BAD_QUERY", f"{field} must be between 1 and {maximum}.")
    return value


def _parse_uuid(raw: Any, *, field: str) -> uuid.UUID | None:
    if raw in (None, "", "ALL"):
        return None
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError, AttributeError) as exc:
        raise APIError(400, "BAD_QUERY", f"{field} must be a UUID.") from exc


def _parse_date(raw: Any, *, field: str) -> date | None:
    if raw in (None, ""):
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError as exc:
        raise APIError(400, "BAD_QUERY", f"{field} must use YYYY-MM-DD.") from exc


def _utc_day_start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=dt_timezone.utc)


def _duration_seconds(started_at: datetime | None, completed_at: datetime | None) -> int | None:
    if started_at is None or completed_at is None:
        return None
    return max(0, int(round((completed_at - started_at).total_seconds())))


def _activity_type(mode: str) -> str:
    normalized = mode.upper()
    if normalized in {"TCF", "EXAM", "TOPIC_TEST"}:
        return "TEST"
    if normalized in {"REVIEW", "MISTAKES", "SPACED"}:
        return "REVIEW"
    return "PRACTICE"


def _where_clause(request, user_id: uuid.UUID) -> tuple[str, list[Any], dict[str, Any]]:
    query = request.query_params
    mode = str(query.get("mode") or "ALL").upper()
    score_filter = str(query.get("score") or "ALL").upper()
    if score_filter not in SCORE_FILTERS:
        raise APIError(400, "BAD_QUERY", "score must be ALL, STRONG, DEVELOPING, or NEEDS_WORK.")

    lesson_id = _parse_uuid(query.get("lesson_id"), field="lesson_id")
    date_from = _parse_date(query.get("date_from"), field="date_from")
    date_to = _parse_date(query.get("date_to"), field="date_to")
    if date_from and date_to and date_from > date_to:
        raise APIError(400, "BAD_QUERY", "date_from must be on or before date_to.")

    conditions = ["ta.user_id = %s", "ta.status = 'COMPLETED'"]
    params: list[Any] = [user_id]

    if mode != "ALL":
        conditions.append("t.mode::text = %s")
        params.append(mode)

    if lesson_id is not None:
        conditions.append(
            "EXISTS ("
            " SELECT 1 FROM test_questions AS tq_filter"
            " WHERE tq_filter.test_id = ta.test_id"
            "   AND tq_filter.question_snapshot->>'lesson_id' = %s"
            ")"
        )
        params.append(str(lesson_id))

    if score_filter == "STRONG":
        conditions.append("ta.score_pct >= 80")
    elif score_filter == "DEVELOPING":
        conditions.append("ta.score_pct >= 60 AND ta.score_pct < 80")
    elif score_filter == "NEEDS_WORK":
        conditions.append("ta.score_pct < 60")

    if date_from is not None:
        conditions.append("ta.completed_at >= %s")
        params.append(_utc_day_start(date_from))
    if date_to is not None:
        conditions.append("ta.completed_at < %s")
        params.append(_utc_day_start(date_to + timedelta(days=1)))

    filters = {
        "mode": mode,
        "lesson_id": None if lesson_id is None else str(lesson_id),
        "score": score_filter,
        "date_from": None if date_from is None else date_from.isoformat(),
        "date_to": None if date_to is None else date_to.isoformat(),
    }
    return " AND ".join(conditions), params, filters


def _available_lessons(cursor, user_id: uuid.UUID) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT DISTINCT
            gl.id,
            gl.lesson_no,
            gl.title_fr_official
        FROM test_attempts AS ta
        JOIN test_questions AS tq ON tq.test_id = ta.test_id
        JOIN grammar_lessons AS gl
          ON gl.id::text = tq.question_snapshot->>'lesson_id'
        WHERE ta.user_id = %s
          AND ta.status = 'COMPLETED'
        ORDER BY gl.lesson_no, gl.title_fr_official, gl.id
        """,
        [user_id],
    )
    return [
        {"id": str(row[0]), "lesson_no": int(row[1]), "title_fr": str(row[2])}
        for row in cursor.fetchall()
    ]


def history_request(request) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    query = request.query_params
    page = _positive_int(query.get("page"), field="page", default=1, maximum=100000)
    page_size = _positive_int(
        query.get("page_size"), field="page_size", default=DEFAULT_PAGE_SIZE, maximum=20
    )
    if page_size not in ALLOWED_PAGE_SIZES:
        raise APIError(400, "BAD_QUERY", "page_size must be one of 5, 10, or 20.")

    where_sql, where_params, filters = _where_clause(request, user_id)
    offset = (page - 1) * page_size
    now = timezone.now()

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT count(*)
            FROM test_attempts AS ta
            JOIN tests AS t ON t.id = ta.test_id
            WHERE {where_sql}
            """,
            where_params,
        )
        total_count = int(cursor.fetchone()[0] or 0)
        total_pages = max(1, math.ceil(total_count / page_size))

        cursor.execute(
            f"""
            SELECT
                count(*) AS total_sessions,
                avg(ta.score_pct) AS average_score_pct,
                avg(EXTRACT(EPOCH FROM (ta.completed_at - ta.started_at))) AS average_duration_seconds,
                max(ta.score_pct) AS best_score_pct
            FROM test_attempts AS ta
            JOIN tests AS t ON t.id = ta.test_id
            WHERE {where_sql}
            """,
            where_params,
        )
        summary_row = cursor.fetchone()

        cursor.execute(
            """
            SELECT COALESCE(sum(EXTRACT(EPOCH FROM (ta.completed_at - ta.started_at))), 0)
            FROM test_attempts AS ta
            WHERE ta.user_id = %s
              AND ta.status = 'COMPLETED'
              AND ta.completed_at >= %s
              AND ta.completed_at < %s
            """,
            [
                user_id,
                _utc_day_start(now.date()),
                _utc_day_start(now.date() + timedelta(days=1)),
            ],
        )
        today_duration_seconds = int(round(float(cursor.fetchone()[0] or 0)))

        cursor.execute(
            f"""
            SELECT
                ta.id,
                ta.test_id,
                ta.status::text,
                ta.started_at,
                ta.completed_at,
                ta.score_raw,
                ta.score_pct,
                t.mode::text,
                t.title
            FROM test_attempts AS ta
            JOIN tests AS t ON t.id = ta.test_id
            WHERE {where_sql}
            ORDER BY ta.completed_at DESC, ta.id DESC
            LIMIT %s OFFSET %s
            """,
            [*where_params, page_size, offset],
        )
        attempt_rows = cursor.fetchall()

        test_ids = [row[1] for row in attempt_rows]
        attempt_ids = [row[0] for row in attempt_rows]

        question_counts: dict[str, int] = {}
        lessons_by_test: dict[str, list[dict[str, Any]]] = {}
        answers_by_attempt: dict[str, tuple[int, int]] = {}

        if test_ids:
            placeholders = ",".join(["%s"] * len(test_ids))
            cursor.execute(
                f"""
                SELECT test_id, count(*)
                FROM test_questions
                WHERE test_id IN ({placeholders})
                GROUP BY test_id
                """,
                test_ids,
            )
            question_counts = {str(row[0]): int(row[1]) for row in cursor.fetchall()}

            cursor.execute(
                f"""
                SELECT DISTINCT
                    tq.test_id,
                    gl.id,
                    gl.lesson_no,
                    gl.title_fr_official
                FROM test_questions AS tq
                JOIN grammar_lessons AS gl
                  ON gl.id::text = tq.question_snapshot->>'lesson_id'
                WHERE tq.test_id IN ({placeholders})
                ORDER BY tq.test_id, gl.lesson_no, gl.title_fr_official
                """,
                test_ids,
            )
            for test_id, lesson_id, lesson_no, title_fr in cursor.fetchall():
                lessons_by_test.setdefault(str(test_id), []).append(
                    {
                        "id": str(lesson_id),
                        "lesson_no": int(lesson_no),
                        "title_fr": str(title_fr),
                    }
                )

        if attempt_ids:
            placeholders = ",".join(["%s"] * len(attempt_ids))
            cursor.execute(
                f"""
                SELECT
                    attempt_id,
                    count(*) AS answered_count,
                    count(*) FILTER (WHERE is_correct IS TRUE) AS correct_count
                FROM user_answers
                WHERE attempt_id IN ({placeholders})
                GROUP BY attempt_id
                """,
                attempt_ids,
            )
            answers_by_attempt = {
                str(row[0]): (int(row[1] or 0), int(row[2] or 0))
                for row in cursor.fetchall()
            }

        cursor.execute(
            f"""
            SELECT
                ta.completed_at::date AS activity_date,
                avg(ta.score_pct) AS score_pct
            FROM test_attempts AS ta
            JOIN tests AS t ON t.id = ta.test_id
            WHERE {where_sql}
            GROUP BY ta.completed_at::date
            ORDER BY activity_date DESC
            LIMIT 7
            """,
            where_params,
        )
        trend_rows = list(cursor.fetchall())
        trend_rows.reverse()

        available_lessons = _available_lessons(cursor, user_id)

    items: list[dict[str, Any]] = []
    for row in attempt_rows:
        (
            attempt_id,
            test_id,
            status,
            started_at,
            completed_at,
            score_raw,
            score_pct,
            mode,
            title,
        ) = row
        attempt_key = str(attempt_id)
        test_key = str(test_id)
        question_count = question_counts.get(test_key, 0)
        answered_count, correct_count = answers_by_attempt.get(attempt_key, (0, 0))
        accuracy_pct = (
            None
            if answered_count <= 0
            else round(100.0 * correct_count / answered_count, 6)
        )
        items.append(
            {
                "attempt_id": attempt_key,
                "test_id": test_key,
                "activity_type": _activity_type(str(mode)),
                "mode": str(mode),
                "title": None if title is None else str(title),
                "status": str(status),
                "started_at": _iso(started_at),
                "completed_at": _iso(completed_at),
                "duration_seconds": _duration_seconds(started_at, completed_at),
                "question_count": question_count,
                "answered_count": answered_count,
                "correct_count": correct_count,
                "score_raw": _float(score_raw),
                "score_pct": _float(score_pct),
                "accuracy_pct": accuracy_pct,
                "lessons": lessons_by_test.get(test_key, []),
            }
        )

    summary = {
        "total_sessions": int(summary_row[0] or 0),
        "average_score_pct": (
            None if summary_row[1] is None else round(float(summary_row[1]), 2)
        ),
        "average_duration_seconds": (
            None if summary_row[2] is None else int(round(float(summary_row[2])))
        ),
        "best_score_pct": (
            None if summary_row[3] is None else round(float(summary_row[3]), 2)
        ),
        "today_duration_seconds": today_duration_seconds,
        "daily_goal_minutes": 20,
    }

    data = {
        "items": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": page < total_pages,
        },
        "summary": summary,
        "trend": [
            {"date": row[0].isoformat(), "score_pct": round(float(row[1]), 2)}
            for row in trend_rows
            if row[0] is not None and row[1] is not None
        ],
        "available_lessons": available_lessons,
        "filters": filters,
        "as_of": _iso(now),
        "runtime_version": HISTORY_RUNTIME_VERSION,
    }
    return Response({"data": data, "meta": _meta(request)}, status=200)
