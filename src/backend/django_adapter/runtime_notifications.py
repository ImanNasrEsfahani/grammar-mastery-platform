from __future__ import annotations

"""Persisted, user-scoped notifications for learner surfaces.

The provider intentionally stays outside the frozen Stage 21 operation set.
It never fabricates engagement data. Streak milestone notifications are derived
from runtime_streak, whose ACTIVE_DAY rule is based on accepted user answers.
"""

from datetime import datetime, timedelta
from typing import Any
import uuid

from django.db import connection, transaction
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter import runtime_dashboard, runtime_streak


NOTIFICATIONS_RUNTIME_VERSION = "real-notifications-v1.0.0"
STREAK_MILESTONES = (7, 14, 30, 60)
MAX_ITEMS = 100

_principal = runtime_dashboard._principal
_uuid = runtime_dashboard._uuid
_api_meta = runtime_dashboard._api_meta


def _serialize_row(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "kind": row[1],
        "tone": row[2],
        "action_required": bool(row[3]),
        "title_fa": row[4],
        "title_en": row[5],
        "body_fa": row[6],
        "body_en": row[7],
        "href": row[8],
        "cta_fa": row[9],
        "cta_en": row[10],
        "french_scope": row[11],
        "source_type": row[12],
        "source_key": row[13],
        "payload": row[14] or {},
        "seen_at": row[15].isoformat() if row[15] else None,
        "read_at": row[16].isoformat() if row[16] else None,
        "created_at": row[17].isoformat(),
        "unread": row[16] is None,
    }


def _insert_streak_milestone(user_id: uuid.UUID, days: int, achieved_on: str) -> None:
    source_key = f"streak:{days}:{achieved_on}"
    payload = {"days": days, "achieved_on": achieved_on}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO user_notifications (
              user_id, kind, tone, action_required,
              title_fa, title_en, body_fa, body_en,
              href, cta_fa, cta_en,
              source_type, source_key, payload
            )
            VALUES (
              %s, 'general', 'streak', false,
              %s, %s, %s, %s,
              '/streak', %s, %s,
              'STREAK_MILESTONE', %s, %s::jsonb
            )
            ON CONFLICT(user_id, source_type, source_key) DO NOTHING
            """,
            [
                user_id,
                f"{days} روز متوالی!",
                f"{days}-day streak!",
                f"زنجیرهٔ واقعی تمرین شما به {days} روز رسید.",
                f"Your real learning streak has reached {days} days.",
                "مشاهده Streak",
                "View streak",
                source_key,
                __import__("json").dumps(payload),
            ],
        )


def _sync_fact_notifications(user_id: uuid.UUID, *, as_of: datetime | None = None) -> None:
    """Materialize notifications only from current, queryable learning facts.

    This is deliberately idempotent. It never creates a 7-day notification
    until the real streak projection says the learner has reached that milestone.
    """
    projection = runtime_streak._streak_projection(user_id, as_of=as_of)
    current = int(projection.get("current_streak_days") or 0)
    if current <= 0:
        return

    local_today = timezone.localdate(as_of or timezone.now())
    status = projection.get("streak_status")
    anchor = local_today if status == "ACTIVE_TODAY" else local_today - timedelta(days=1)
    for days in STREAK_MILESTONES:
        if current >= days:
            # The source date is the calendar day on which this streak run
            # actually crossed the milestone. This prevents a 7-day alert from
            # being recreated on days 8, 9, 10... of the same run.
            achieved_on = (anchor - timedelta(days=current - days)).isoformat()
            _insert_streak_milestone(user_id, days, achieved_on)


def _unread_count(user_id: uuid.UUID) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM user_notifications WHERE user_id=%s AND read_at IS NULL",
            [user_id],
        )
        return int(cursor.fetchone()[0] or 0)


def list_notifications_request(request) -> Response:
    principal = _principal(request)
    user_id = _uuid(principal.user_id)
    _sync_fact_notifications(user_id)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, kind, tone, action_required,
                   title_fa, title_en, body_fa, body_en,
                   href, cta_fa, cta_en, french_scope,
                   source_type, source_key, payload,
                   seen_at, read_at, created_at
              FROM user_notifications
             WHERE user_id=%s
             ORDER BY created_at DESC, id DESC
             LIMIT %s
            """,
            [user_id, MAX_ITEMS],
        )
        items = [_serialize_row(row) for row in cursor.fetchall()]

    return Response(
        {
            "data": {
                "items": items,
                "unread_count": sum(1 for item in items if item["unread"]),
                "provider_version": NOTIFICATIONS_RUNTIME_VERSION,
            },
            "meta": _api_meta(request),
        },
        status=200,
    )


def unread_count_request(request) -> Response:
    principal = _principal(request)
    user_id = _uuid(principal.user_id)
    _sync_fact_notifications(user_id)
    return Response(
        {
            "data": {"unread_count": _unread_count(user_id)},
            "meta": _api_meta(request),
        },
        status=200,
    )


def mark_seen_request(request) -> Response:
    principal = _principal(request)
    user_id = _uuid(principal.user_id)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_notifications
               SET seen_at=COALESCE(seen_at, now()), updated_at=now()
             WHERE user_id=%s AND seen_at IS NULL
            """,
            [user_id],
        )
    return Response(
        {"data": {"unread_count": _unread_count(user_id)}, "meta": _api_meta(request)},
        status=200,
    )


def mark_all_read_request(request) -> Response:
    principal = _principal(request)
    user_id = _uuid(principal.user_id)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_notifications
               SET seen_at=COALESCE(seen_at, now()),
                   read_at=COALESCE(read_at, now()),
                   updated_at=now()
             WHERE user_id=%s AND read_at IS NULL
            """,
            [user_id],
        )
    return Response(
        {"data": {"unread_count": 0}, "meta": _api_meta(request)},
        status=200,
    )


def mark_read_request(request, *, notification_id: str | None) -> Response:
    principal = _principal(request)
    user_id = _uuid(principal.user_id)
    try:
        parsed_id = uuid.UUID(str(notification_id))
    except (TypeError, ValueError, AttributeError):
        return Response(
            {"error": {"code": "NOTIFICATION_NOT_FOUND", "message": "Notification was not found.", "fields": {}, "request_id": _api_meta(request)["request_id"]}},
            status=404,
        )

    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE user_notifications
               SET seen_at=COALESCE(seen_at, now()),
                   read_at=COALESCE(read_at, now()),
                   updated_at=now()
             WHERE id=%s AND user_id=%s
            RETURNING id
            """,
            [parsed_id, user_id],
        )
        updated = cursor.fetchone()

    if updated is None:
        return Response(
            {"error": {"code": "NOTIFICATION_NOT_FOUND", "message": "Notification was not found.", "fields": {}, "request_id": _api_meta(request)["request_id"]}},
            status=404,
        )

    return Response(
        {"data": {"id": str(updated[0]), "read": True, "unread_count": _unread_count(user_id)}, "meta": _api_meta(request)},
        status=200,
    )
