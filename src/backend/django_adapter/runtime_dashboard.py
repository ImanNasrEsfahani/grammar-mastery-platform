from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from typing import Any
import uuid

from django.db import connection, transaction
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter.middleware import create_request_id
from backend.errors import APIError
from backend.security import Principal


DASHBOARD_RUNTIME_VERSION = "postgres-dashboard-provider-v1.0.0"
DASHBOARD_CONTRACT_VERSION = "dashboard-contract-v0.9.0"
CONFIDENCE_GATE = 0.45
MASTERY_BANDS = {"NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG"}


@dataclass(frozen=True)
class NextAction:
    code: str
    destination: str
    reason: str


def _api_meta(request) -> dict[str, str]:
    return {
        "request_id": create_request_id(getattr(request, "request_id", None)),
        "api_version": "v1",
    }


def _principal(request) -> Principal:
    principal = getattr(request, "auth", None)
    if not isinstance(principal, Principal):
        raise APIError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
        )
    return principal


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise APIError(
            401,
            "TOKEN_INVALID",
            "The access token is invalid or expired.",
        ) from exc


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, dt_timezone.utc)
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _safe_mastery_band(
    stored_band: Any,
    *,
    evidence_count: int,
    confidence: float,
) -> str:
    band = str(stored_band) if stored_band is not None else ""
    if band in MASTERY_BANDS:
        return band
    if evidence_count <= 0:
        return "NO_EVIDENCE"
    # Never infer a weakness label when the persisted Stage 15 band is missing.
    # UNCERTAIN is the conservative contract-preserving fallback.
    return "UNCERTAIN"


def _locale_prefix(profile_locale: str | None) -> str:
    return "fa" if str(profile_locale or "").lower().startswith("fa") else "en"


def _reason(
    code: str,
    *,
    locale_prefix: str,
    due_count: int = 0,
    unresolved_group_count: int = 0,
) -> str:
    fa = locale_prefix == "fa"
    messages = {
        "OVERDUE_REVIEW": (
            f"{due_count} مرور به زمان انجام رسیده و در اولویت است."
            if fa
            else f"{due_count} review item(s) are due and take priority."
        ),
        "DUE_REVIEW": (
            f"{unresolved_group_count} گروه خطای حل‌نشده برای مرور وجود دارد."
            if fa
            else f"{unresolved_group_count} unresolved error group(s) are ready for review."
        ),
        "CRITICAL_CONFIDENT_LESSON": (
            "یک درس با شواهد کافی، تسلط کمتر از ۴۰٪ دارد."
            if fa
            else "A lesson has sufficient evidence and mastery below 40%."
        ),
        "WEAK_CONFIDENT_LESSON": (
            "یک درس با شواهد کافی در بازه تسلط ضعیف قرار دارد."
            if fa
            else "A lesson has sufficient evidence and is in the weak mastery range."
        ),
        "DEVELOPING_LESSON": (
            "یک درس با شواهد کافی هنوز در حال توسعه است."
            if fa
            else "A lesson has sufficient evidence and is still developing."
        ),
        "BUILD_EVIDENCE": (
            "هنوز شواهد یادگیری کافی برای برچسب‌گذاری نقاط ضعف وجود ندارد."
            if fa
            else "There is not enough learning evidence yet to label weaknesses."
        ),
        "REGULAR_PRACTICE": (
            "مرور فوری یا ضعف مطمئن شناسایی نشده است؛ تمرین منظم ادامه یابد."
            if fa
            else "No urgent review or confident weakness is detected; continue regular practice."
        ),
    }
    return messages[code]


def _select_next_action(snapshot: dict[str, Any]) -> NextAction:
    locale_prefix = _locale_prefix(snapshot.get("profile_locale"))
    review_queue = snapshot["review_queue"]
    error_review = snapshot["error_review"]
    mastery = snapshot["mastery"]

    due_count = int(review_queue.get("due_count", 0))
    unresolved_group_count = int(error_review.get("unresolved_group_count", 0))

    if due_count > 0:
        return NextAction(
            code="OVERDUE_REVIEW",
            destination=f"/{locale_prefix}/review",
            reason=_reason(
                "OVERDUE_REVIEW",
                locale_prefix=locale_prefix,
                due_count=due_count,
            ),
        )

    if unresolved_group_count > 0:
        return NextAction(
            code="DUE_REVIEW",
            destination=f"/{locale_prefix}/review",
            reason=_reason(
                "DUE_REVIEW",
                locale_prefix=locale_prefix,
                unresolved_group_count=unresolved_group_count,
            ),
        )

    confident_lessons = [
        item
        for item in mastery
        if item.get("scope_type") == "LESSON"
        and _float(item.get("confidence")) >= CONFIDENCE_GATE
        and int(item.get("evidence_count", 0)) > 0
    ]
    confident_lessons.sort(
        key=lambda item: (
            _float(item.get("mastery_score_pct")),
            -_float(item.get("confidence")),
            str(item.get("scope_id", "")),
        )
    )

    if confident_lessons:
        weakest = confident_lessons[0]
        score = _float(weakest.get("mastery_score_pct"))
        lesson_id = str(weakest["scope_id"])
        if score < 40:
            code = "CRITICAL_CONFIDENT_LESSON"
        elif score < 55:
            code = "WEAK_CONFIDENT_LESSON"
        elif score < 80:
            code = "DEVELOPING_LESSON"
        else:
            code = "REGULAR_PRACTICE"

        if code != "REGULAR_PRACTICE":
            return NextAction(
                code=code,
                destination=f"/{locale_prefix}/lessons/{lesson_id}",
                reason=_reason(code, locale_prefix=locale_prefix),
            )

    has_learning_evidence = any(
        int(item.get("evidence_count", 0)) > 0
        or _float(item.get("confidence")) > 0
        or _float(item.get("coverage_ratio")) > 0
        for item in mastery
    )
    if not has_learning_evidence:
        return NextAction(
            code="BUILD_EVIDENCE",
            destination=f"/{locale_prefix}/tests/new",
            reason=_reason("BUILD_EVIDENCE", locale_prefix=locale_prefix),
        )

    return NextAction(
        code="REGULAR_PRACTICE",
        destination=f"/{locale_prefix}/tests/new",
        reason=_reason("REGULAR_PRACTICE", locale_prefix=locale_prefix),
    )


def _load_mastery(
    cursor,
    user_id: uuid.UUID,
    locale_prefix: str,
) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT
            um.scope_type,
            um.scope_id,
            CASE um.scope_type::text
                WHEN 'SUBTOPIC' THEN CASE
                    WHEN %s = 'fa' THEN COALESCE(gs.title_fa, gs.title_fr)
                    ELSE gs.title_fr
                END
                WHEN 'LESSON' THEN gl.title_fr_official
                WHEN 'CATEGORY' THEN CASE
                    WHEN %s = 'fa' THEN COALESCE(gc.display_name_fa, gc.display_name_fr)
                    ELSE gc.display_name_fr
                END
                WHEN 'TAG' THEN CASE
                    WHEN %s = 'fa' THEN COALESCE(t.display_name_fa, t.display_name_fr)
                    ELSE t.display_name_fr
                END
            END AS scope_title,
            um.mastery_score,
            um.confidence,
            um.coverage_ratio,
            um.evidence_count,
            um.mastery_band,
            um.updated_at
        FROM user_mastery AS um
        LEFT JOIN grammar_subtopics AS gs
          ON um.scope_type::text = 'SUBTOPIC' AND gs.id = um.scope_id
        LEFT JOIN grammar_lessons AS gl
          ON um.scope_type::text = 'LESSON' AND gl.id = um.scope_id
        LEFT JOIN grammar_categories AS gc
          ON um.scope_type::text = 'CATEGORY' AND gc.id = um.scope_id
        LEFT JOIN tags AS t
          ON um.scope_type::text = 'TAG' AND t.id = um.scope_id
        WHERE um.user_id = %s
        ORDER BY
            um.confidence DESC,
            um.coverage_ratio DESC NULLS LAST,
            um.updated_at DESC,
            um.scope_type,
            um.scope_id
        """,
        [locale_prefix, locale_prefix, locale_prefix, user_id],
    )
    items: list[dict[str, Any]] = []
    for (
        scope_type,
        scope_id,
        scope_title,
        mastery_score,
        confidence,
        coverage_ratio,
        evidence_count,
        mastery_band,
        _updated_at,
    ) in cursor.fetchall():
        confidence_value = _float(confidence)
        evidence_value = int(evidence_count or 0)
        items.append(
            {
                "scope_type": str(scope_type),
                "scope_id": str(scope_id),
                "scope_title": str(scope_title or scope_type),
                "mastery_score_pct": _float(mastery_score),
                "confidence": confidence_value,
                "coverage_ratio": _float(coverage_ratio),
                "evidence_count": evidence_value,
                "mastery_band": _safe_mastery_band(
                    mastery_band,
                    evidence_count=evidence_value,
                    confidence=confidence_value,
                ),
            }
        )
    return items


def _load_review_queue(
    cursor,
    user_id: uuid.UUID,
    as_of: datetime,
) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT
            count(*) FILTER (
                WHERE learning_state IS NOT NULL
                  AND learning_state <> 'SUSPENDED'
                  AND due_at <= %s
            ) AS due_count,
            count(*) FILTER (
                WHERE learning_state IS NOT NULL
                  AND learning_state <> 'SUSPENDED'
                  AND due_at < %s
            ) AS overdue_count,
            min(due_at) FILTER (
                WHERE learning_state IS NOT NULL
                  AND learning_state <> 'SUSPENDED'
                  AND due_at > %s
            ) AS next_due_at,
            count(*) FILTER (
                WHERE learning_state = 'SUSPENDED'
            ) AS suspended_concept_count
        FROM review_queue
        WHERE user_id = %s
          AND target_type = 'SUBTOPIC'
        """,
        [as_of, as_of, as_of, user_id],
    )
    due_count, overdue_count, next_due_at, suspended_count = cursor.fetchone()
    return {
        "due_count": int(due_count or 0),
        "overdue_count": int(overdue_count or 0),
        "next_due_at": _iso(next_due_at),
        "suspended_concept_count": int(suspended_count or 0),
    }


def _load_error_review(cursor, user_id: uuid.UUID) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT
            count(*) FILTER (WHERE unresolved_count > 0)
        FROM v_error_review_groups
        WHERE user_id = %s
        """,
        [user_id],
    )
    unresolved_group_count = int(cursor.fetchone()[0] or 0)

    cursor.execute(
        """
        SELECT count(*)
        FROM error_review_items
        WHERE user_id = %s
          AND resolution_status = 'CORRECTED'
        """,
        [user_id],
    )
    corrected_item_count = int(cursor.fetchone()[0] or 0)

    cursor.execute(
        """
        SELECT
            group_key,
            group_quality,
            misconception_id,
            unresolved_count,
            eligible_wrong_count,
            last_wrong_at
        FROM v_error_review_groups
        WHERE user_id = %s
          AND unresolved_count > 0
        ORDER BY unresolved_count DESC, last_wrong_at DESC, group_key
        LIMIT 3
        """,
        [user_id],
    )
    top_groups = []
    for (
        group_key,
        group_quality,
        misconception_id,
        unresolved_count,
        eligible_wrong_count,
        last_wrong_at,
    ) in cursor.fetchall():
        top_groups.append(
            {
                "group_key": str(group_key),
                "group_quality": str(group_quality),
                "misconception_id": (
                    None if misconception_id is None else str(misconception_id)
                ),
                "unresolved_count": int(unresolved_count or 0),
                "eligible_wrong_count": int(eligible_wrong_count or 0),
                "last_wrong_at": _iso(last_wrong_at),
            }
        )

    return {
        "unresolved_group_count": unresolved_group_count,
        "corrected_item_count": corrected_item_count,
        "top_misconception_groups": top_groups,
    }


def _load_recent_test(cursor, user_id: uuid.UUID) -> dict[str, Any] | None:
    cursor.execute(
        """
        SELECT
            ta.id,
            ta.test_id,
            t.mode::text,
            t.title,
            ta.score_raw,
            ta.score_pct,
            ta.completed_at
        FROM test_attempts AS ta
        JOIN tests AS t
          ON t.id = ta.test_id
        WHERE ta.user_id = %s
          AND ta.status = 'COMPLETED'
          AND ta.completed_at IS NOT NULL
        ORDER BY ta.completed_at DESC, ta.id DESC
        LIMIT 1
        """,
        [user_id],
    )
    row = cursor.fetchone()
    if row is None:
        return None
    (
        attempt_id,
        test_id,
        mode,
        title,
        score_raw,
        score_pct,
        completed_at,
    ) = row
    return {
        "attempt_id": str(attempt_id),
        "test_id": str(test_id),
        "mode": str(mode),
        "title": title,
        "score_raw": None if score_raw is None else _float(score_raw),
        "score_pct": None if score_pct is None else _float(score_pct),
        "completed_at": _iso(completed_at),
    }


def _load_in_progress_attempt(cursor, user_id: uuid.UUID) -> dict[str, Any] | None:
    cursor.execute(
        """
        SELECT
            ta.id,
            ta.test_id,
            t.mode::text,
            t.title,
            ta.started_at,
            count(DISTINCT tq.id) AS question_count,
            count(DISTINCT ua.test_question_id) AS answered_count
        FROM test_attempts AS ta
        JOIN tests AS t ON t.id = ta.test_id
        JOIN test_questions AS tq ON tq.test_id = ta.test_id
        LEFT JOIN user_answers AS ua
          ON ua.attempt_id = ta.id
         AND ua.test_question_id = tq.id
        WHERE ta.user_id = %s
          AND ta.status = 'IN_PROGRESS'
        GROUP BY ta.id, ta.test_id, t.mode, t.title, ta.started_at
        ORDER BY ta.started_at DESC, ta.id DESC
        LIMIT 1
        """,
        [user_id],
    )
    row = cursor.fetchone()
    if row is None:
        return None
    attempt_id, test_id, mode, title, started_at, question_count, answered_count = row
    return {
        "attempt_id": str(attempt_id),
        "test_id": str(test_id),
        "mode": str(mode),
        "title": title,
        "started_at": _iso(started_at),
        "question_count": int(question_count or 0),
        "answered_count": int(answered_count or 0),
    }


def _load_trend(cursor, user_id: uuid.UUID) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT
            scope_type,
            scope_id,
            mastery_score,
            confidence,
            coverage_ratio,
            evidence_count,
            mastery_band,
            captured_at
        FROM mastery_snapshots
        WHERE user_id = %s
        ORDER BY captured_at DESC, id DESC
        LIMIT 30
        """,
        [user_id],
    )
    raw_rows = cursor.fetchall()
    raw_rows.reverse()

    points = []
    for (
        scope_type,
        scope_id,
        mastery_score,
        confidence,
        coverage_ratio,
        evidence_count,
        mastery_band,
        captured_at,
    ) in raw_rows:
        confidence_value = _float(confidence)
        evidence_value = int(evidence_count or 0)
        points.append(
            {
                "scope_type": str(scope_type),
                "scope_id": str(scope_id),
                "mastery_score_pct": _float(mastery_score),
                "confidence": confidence_value,
                "coverage_ratio": _float(coverage_ratio),
                "evidence_count": evidence_value,
                "mastery_band": _safe_mastery_band(
                    mastery_band,
                    evidence_count=evidence_value,
                    confidence=confidence_value,
                ),
                "captured_at": _iso(captured_at),
            }
        )

    incomplete = len(points) == 1
    return {
        "points": points,
        "incomplete_data": incomplete,
        "warning": (
            "Only one persisted mastery snapshot is available; no trend is inferred."
            if incomplete
            else None
        ),
    }


def _load_activity(cursor, user_id: uuid.UUID) -> dict[str, int]:
    cursor.execute(
        """
        SELECT count(*)
        FROM user_answers AS ua
        JOIN test_attempts AS ta
          ON ta.id = ua.attempt_id
        WHERE ta.user_id = %s
        """,
        [user_id],
    )
    questions_answered = int(cursor.fetchone()[0] or 0)

    cursor.execute(
        """
        SELECT count(*)
        FROM test_attempts
        WHERE user_id = %s
          AND status = 'COMPLETED'
        """,
        [user_id],
    )
    tests_completed = int(cursor.fetchone()[0] or 0)

    cursor.execute(
        """
        SELECT count(*)
        FROM error_review_events
        WHERE user_id = %s
          AND event_type = 'RETRY_SUBMITTED'
        """,
        [user_id],
    )
    reviews_completed = int(cursor.fetchone()[0] or 0)

    return {
        "questions_answered": questions_answered,
        "tests_completed": tests_completed,
        "reviews_completed": reviews_completed,
    }


def _load_dashboard_snapshot(
    user_id: uuid.UUID,
    *,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    timestamp = as_of or timezone.now()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT locale
                FROM users
                WHERE id = %s
                  AND status = 'ACTIVE'
                """,
                [user_id],
            )
            user_row = cursor.fetchone()
            if user_row is None:
                raise APIError(
                    401,
                    "TOKEN_INVALID",
                    "The access token is invalid or expired.",
                )

            profile_locale = str(user_row[0])
            mastery = _load_mastery(cursor, user_id, _locale_prefix(profile_locale))
            review_queue = _load_review_queue(cursor, user_id, timestamp)
            error_review = _load_error_review(cursor, user_id)
            recent_test = _load_recent_test(cursor, user_id)
            in_progress_attempt = _load_in_progress_attempt(cursor, user_id)
            trend = _load_trend(cursor, user_id)
            activity = _load_activity(cursor, user_id)

    snapshot = {
        "as_of": _iso(timestamp),
        "profile_locale": profile_locale,
        "mastery": mastery,
        "review_queue": review_queue,
        "error_review": error_review,
        "recent_test": recent_test,
        "in_progress_attempt": in_progress_attempt,
        "trend": trend,
        "activity": activity,
    }
    action = _select_next_action(snapshot)
    snapshot["next_action"] = action.code
    return snapshot


def _dashboard_projection(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "as_of": snapshot["as_of"],
        "next_action": snapshot["next_action"],
        "mastery": snapshot["mastery"],
        "review_queue": snapshot["review_queue"],
        "error_review": snapshot["error_review"],
        "recent_test": snapshot["recent_test"],
        "in_progress_attempt": snapshot["in_progress_attempt"],
        "trend": snapshot["trend"],
        "activity": snapshot["activity"],
    }


def dashboard_request(request) -> Response:
    principal = _principal(request)
    snapshot = _load_dashboard_snapshot(_uuid(principal.user_id))
    return Response(
        {
            "data": _dashboard_projection(snapshot),
            "meta": _api_meta(request),
        },
        status=200,
    )


def next_action_request(request) -> Response:
    principal = _principal(request)
    snapshot = _load_dashboard_snapshot(_uuid(principal.user_id))
    action = _select_next_action(snapshot)
    return Response(
        {
            "data": {
                "code": action.code,
                "destination": action.destination,
                "reason": action.reason,
            },
            "meta": _api_meta(request),
        },
        status=200,
    )
