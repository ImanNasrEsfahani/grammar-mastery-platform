from __future__ import annotations

"""Runtime provider for learner Review / Spaced Repetition.

This module is intentionally additive. It delegates the existing Stage21
learning/dashboard providers and binds the previously deferred Review runtime
without rewriting the large canonical runtime modules.
"""

from typing import Any, Mapping
import hashlib
import json
import uuid

from django.db import connection, transaction
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter import runtime_dashboard, runtime_learning
from backend.errors import APIError, not_found
from backend.idempotency import InMemoryIdempotencyRegistry, request_hash
from backend.pagination import query_fingerprint
from spaced_repetition.review_policy import (
    POLICY_VERSION as REVIEW_POLICY_VERSION,
    apply_review_outcome,
)

# Reuse the validated Stage21 helpers rather than duplicating security,
# pagination, projection, snapshot and idempotency logic.
_principal = runtime_learning._principal
_uuid = runtime_learning._uuid
_meta = runtime_learning._meta
_json_object = runtime_learning._json_object
_float = runtime_learning._float
_iso = runtime_learning._iso
_validation = runtime_learning._validation
_body_uuid = runtime_learning._body_uuid
_candidate_rows = runtime_learning._candidate_rows
_fetch_snapshot = runtime_learning._fetch_snapshot
_answer_feedback = runtime_learning._answer_feedback
_begin_idempotency = runtime_learning._begin_idempotency
_complete_idempotency = runtime_learning._complete_idempotency
_parse_page_size = runtime_learning._parse_page_size
_pagination_codec = runtime_learning._pagination_codec


def list_reviews_request(request) -> Response:
    """Use the concept clock for learner-facing due review.

    Non-due/history/filter views keep delegating to the original Stage21 list
    implementation. filter[due]=true intentionally returns only active
    subtopic schedules whose due_at has arrived; raw Stage16 mistake rows no
    longer bypass the SRS clock.
    """
    due_raw = request.query_params.get("filter[due]")
    if str(due_raw or "").lower() != "true":
        return runtime_learning.list_reviews_request(request)

    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    page_size = _parse_page_size(request)
    cursor_value = request.query_params.get("page[after]")
    kind = request.query_params.get("filter[kind]")
    sort = request.query_params.get("sort", "due_at")
    order_sql = {
        "due_at": "rq.due_at ASC, rq.id ASC",
        "-due_at": "rq.due_at DESC, rq.id ASC",
    }.get(sort)
    if order_sql is None:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The sort parameter is invalid.",
            {"sort": ["Use due_at or -due_at."]},
        )

    # Explicit due+MISTAKE has no rows by policy; mistake history is still
    # available through the original non-due filters.
    if kind not in (None, "", "SPACED", "MISTAKE"):
        raise APIError(400, "QUERY_PARAMETER_INVALID", "The review kind is invalid.")

    filters = {"kind": kind or None, "due": True}
    fingerprint = query_fingerprint(filters, sort)
    codec = _pagination_codec()
    offset = codec.decode(cursor_value, fingerprint) if cursor_value else 0

    if kind == "MISTAKE":
        rows = []
    else:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                    rq.id,
                    CASE
                        WHEN u.locale = 'fa-IR'
                        THEN COALESCE(NULLIF(gs.title_fa, ''), gs.title_fr)
                        ELSE gs.title_fr
                    END AS title,
                    rq.due_at
                FROM review_queue AS rq
                JOIN grammar_subtopics AS gs ON gs.id = rq.subtopic_id
                JOIN users AS u ON u.id = rq.user_id
                WHERE rq.user_id = %s
                  AND rq.target_type = 'SUBTOPIC'
                  AND rq.subtopic_id IS NOT NULL
                  AND rq.learning_state IS NOT NULL
                  AND rq.learning_state <> 'SUSPENDED'
                  AND rq.status <> 'COMPLETED'
                  AND rq.due_at <= now()
                ORDER BY {order_sql}
                LIMIT %s OFFSET %s
                """,
                [user_id, page_size + 1, offset],
            )
            rows = cursor.fetchall()

    has_more = len(rows) > page_size
    selected = rows[:page_size]
    data = [
        {
            "id": str(row[0]),
            "kind": "SPACED",
            "status": "DUE",
            "title": str(row[1]),
            "group_key": None,
            "repeat_count": 0,
            "due_at": _iso(row[2]),
            "marked": False,
        }
        for row in selected
    ]
    next_offset = offset + len(selected)
    return Response(
        {
            "data": data,
            "page": {
                "page_size": page_size,
                "has_more": has_more,
                "next_cursor": (
                    codec.encode(next_offset, fingerprint) if has_more else None
                ),
            },
            "meta": _meta(request),
        },
        status=200,
    )


def _review_public_question(
    snapshot: Mapping[str, Any],
    *,
    projection_id: Any | None = None,
) -> dict[str, Any]:
    options = snapshot.get("options")
    if not isinstance(options, list) or len(options) != 4:
        raise APIError(500, "INTERNAL_ERROR", "The stored review options are invalid.")
    return {
        # The frozen AttemptQuestion contract requires test_question_id and
        # position. For concept review there is no test_questions row, so the
        # owner-scoped review id is used as the opaque projection id.
        "test_question_id": str(projection_id or snapshot["question_revision_id"]),
        "question_revision_id": str(snapshot["question_revision_id"]),
        "position": 1,
        "stem": str(snapshot["stem"]),
        "stem_locale": str(snapshot["stem_locale"]),
        "question_type": str(snapshot["question_type"]),
        "difficulty": str(snapshot["difficulty"]),
        "options": [
            {
                "id": str(option["id"]),
                "position": str(option["position"]),
                "text": str(option["text"]),
            }
            for option in options
            if isinstance(option, Mapping)
        ],
        "media": [],
    }


def _review_schedule_projection(
    *,
    status: str,
    learning_state: str | None,
    due_at: Any,
    interval_days: float,
    consecutive_correct_reviews: int,
    graduated: bool,
    scheduler_version: str,
) -> dict[str, Any]:
    return {
        "status": status,
        "learning_state": learning_state,
        "due_at": _iso(due_at) if not isinstance(due_at, str) else due_at,
        "interval_days": float(interval_days),
        "consecutive_correct_reviews": int(consecutive_correct_reviews),
        "graduated": bool(graduated),
        "scheduler_version": str(scheduler_version),
    }


def _load_error_review_item(cursor, user_id: uuid.UUID, review_id: uuid.UUID, *, lock: bool):
    cursor.execute(
        f"""
        SELECT
            eri.id,
            eri.resolution_status,
            eri.reviewability,
            eri.marked_for_review,
            eri.test_question_id,
            eri.subtopic_id,
            eri.review_model_version,
            ua.selected_option_id,
            tq.question_snapshot,
            tq.option_snapshot,
            EXISTS (
                SELECT 1
                FROM error_review_events AS ere
                WHERE ere.review_item_id = eri.id
                  AND ere.event_type IN ('RETRY_SUBMITTED','ANSWER_REVEALED')
            ) AS feedback_revealed
        FROM error_review_items AS eri
        JOIN user_answers AS ua ON ua.id = eri.source_answer_id
        JOIN test_questions AS tq ON tq.id = eri.test_question_id
        WHERE eri.id = %s
          AND eri.user_id = %s
        {"FOR UPDATE OF eri" if lock else ""}
        """,
        [review_id, user_id],
    )
    return cursor.fetchone()


def _load_spaced_review_row(cursor, user_id: uuid.UUID, review_id: uuid.UUID, *, lock: bool):
    cursor.execute(
        f"""
        SELECT
            rq.id,
            rq.subtopic_id,
            rq.status::text,
            rq.learning_state,
            rq.due_at,
            rq.interval_days,
            rq.success_streak,
            rq.lapse_count,
            rq.scheduler_version,
            rq.scheduler_metadata
        FROM review_queue AS rq
        WHERE rq.id = %s
          AND rq.user_id = %s
          AND rq.target_type = 'SUBTOPIC'
          AND rq.subtopic_id IS NOT NULL
          AND rq.learning_state IS NOT NULL
        {"FOR UPDATE" if lock else ""}
        """,
        [review_id, user_id],
    )
    return cursor.fetchone()


def _select_spaced_review_snapshot(
    cursor,
    *,
    queue_id: uuid.UUID,
    subtopic_id: uuid.UUID,
    scheduler_metadata: Any,
) -> dict[str, Any]:
    metadata = _json_object(scheduler_metadata or {})
    recent = [
        str(value)
        for value in metadata.get("recent_review_question_uids", [])
        if value
    ][:3]
    candidates = [
        row
        for row in _candidate_rows(cursor)
        if row.get("subtopic_id") == str(subtopic_id)
        and row.get("serving_enabled")
    ]
    if not candidates:
        raise APIError(
            409,
            "REVIEW_SAFE_POOL_EMPTY",
            "No safe published question is available for this review concept.",
        )
    ranked = sorted(
        candidates,
        key=lambda row: (
            1 if row.get("question_uid") in recent else 0,
            hashlib.sha256(
                f"review|{queue_id}|{row['question_revision_id']}".encode("utf-8")
            ).hexdigest(),
        ),
    )
    selected = ranked[0]
    return _fetch_snapshot(cursor, selected, f"review:{queue_id}")


def _direct_review_schedule(
    cursor,
    *,
    user_id: uuid.UUID,
    subtopic_id: uuid.UUID,
    is_correct: bool,
    event_at,
    question_revision_id: str,
    question_uid: str,
    selected_option_id: str,
    source_kind: str,
    queue_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    if queue_id is None:
        cursor.execute(
            """
            SELECT
                id, learning_state, interval_days, due_at, success_streak,
                lapse_count, scheduler_metadata
            FROM review_queue
            WHERE user_id = %s
              AND target_type = 'SUBTOPIC'
              AND subtopic_id = %s
              AND learning_state IS NOT NULL
            FOR UPDATE
            """,
            [user_id, subtopic_id],
        )
    else:
        cursor.execute(
            """
            SELECT
                id, learning_state, interval_days, due_at, success_streak,
                lapse_count, scheduler_metadata
            FROM review_queue
            WHERE id = %s
              AND user_id = %s
              AND target_type = 'SUBTOPIC'
              AND subtopic_id = %s
              AND learning_state IS NOT NULL
            FOR UPDATE
            """,
            [queue_id, user_id, subtopic_id],
        )
    current_row = cursor.fetchone()

    previous_state = None
    previous_interval = 0.0
    previous_due = None
    lapse_count = 0
    metadata: dict[str, Any] = {}
    active_queue_id = None
    if current_row is not None:
        (
            active_queue_id,
            previous_state,
            previous_interval,
            previous_due,
            _success_streak,
            lapse_count,
            raw_metadata,
        ) = current_row
        previous_interval = _float(previous_interval)
        lapse_count = int(lapse_count or 0)
        metadata = _json_object(raw_metadata or {})

    review_streak = int(metadata.get("review_correct_streak", 0) or 0)
    outcome = apply_review_outcome(
        current_interval_days=previous_interval,
        consecutive_correct_reviews=review_streak,
        lapse_count=lapse_count,
        is_correct=is_correct,
        event_at=event_at,
    )
    metadata.update(
        {
            "review_policy_version": REVIEW_POLICY_VERSION,
            "review_correct_streak": outcome["consecutive_correct_reviews"],
            "transition_reason": outcome["transition_reason"],
            "graduated": outcome["graduated"],
        }
    )
    recent = [
        str(question_uid),
        *[
            str(value)
            for value in metadata.get("recent_review_question_uids", [])
            if value and str(value) != str(question_uid)
        ],
    ][:3]
    metadata["recent_review_question_uids"] = recent
    if outcome["graduated"]:
        metadata["graduated_at"] = _iso(event_at)

    if active_queue_id is None:
        cursor.execute(
            """
            INSERT INTO review_queue (
                user_id, target_type, subtopic_id, status, due_at, interval_days,
                strength, lapse_count, scheduler_version, last_answer_id, updated_at,
                learning_state, success_streak, state_before_suspend, suspended_reason,
                last_scheduled_at, scheduler_metadata
            )
            VALUES (
                %s, 'SUBTOPIC', %s, %s::learning_review_status, %s, %s,
                NULL, %s, %s, NULL, now(), %s, %s, NULL, NULL, %s, %s::jsonb
            )
            RETURNING id
            """,
            [
                user_id,
                subtopic_id,
                outcome["status"],
                outcome["due_at"],
                outcome["interval_days"],
                outcome["lapse_count"],
                REVIEW_POLICY_VERSION,
                outcome["learning_state"],
                outcome["consecutive_correct_reviews"],
                event_at,
                json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
            ],
        )
        active_queue_id = cursor.fetchone()[0]
    else:
        cursor.execute(
            """
            UPDATE review_queue
            SET status = %s::learning_review_status,
                due_at = %s,
                interval_days = %s,
                lapse_count = %s,
                scheduler_version = %s,
                updated_at = now(),
                learning_state = %s,
                success_streak = %s,
                state_before_suspend = NULL,
                suspended_reason = NULL,
                last_scheduled_at = %s,
                scheduler_metadata = %s::jsonb
            WHERE id = %s
            """,
            [
                outcome["status"],
                outcome["due_at"],
                outcome["interval_days"],
                outcome["lapse_count"],
                REVIEW_POLICY_VERSION,
                outcome["learning_state"],
                outcome["consecutive_correct_reviews"],
                event_at,
                json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                active_queue_id,
            ],
        )

    cursor.execute(
        """
        INSERT INTO spaced_review_events (
            review_queue_id, user_id, subtopic_id, source_answer_id, event_type,
            from_state, to_state, interval_before_days, interval_after_days,
            due_before, due_after, mastery_band, mastery_confidence,
            mastery_model_version, scheduler_version, event_at, event_metadata
        )
        VALUES (
            %s, %s, %s, NULL, 'ANSWER_SCHEDULED',
            %s, %s, %s, %s, %s, %s,
            NULL, NULL, NULL, %s, %s, %s::jsonb
        )
        """,
        [
            active_queue_id,
            user_id,
            subtopic_id,
            previous_state,
            outcome["learning_state"],
            previous_interval,
            outcome["interval_days"],
            previous_due,
            outcome["due_at"],
            REVIEW_POLICY_VERSION,
            event_at,
            json.dumps(
                {
                    "source": "DIRECT_REVIEW",
                    "source_kind": source_kind,
                    "question_revision_id": question_revision_id,
                    "question_uid": question_uid,
                    "selected_option_id": selected_option_id,
                    "is_correct": bool(is_correct),
                    "graduated": outcome["graduated"],
                    "review_correct_streak": outcome["consecutive_correct_reviews"],
                    "transition_reason": outcome["transition_reason"],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        ],
    )
    return _review_schedule_projection(
        status=outcome["status"],
        learning_state=outcome["learning_state"],
        due_at=outcome["due_at"],
        interval_days=outcome["interval_days"],
        consecutive_correct_reviews=outcome["consecutive_correct_reviews"],
        graduated=outcome["graduated"],
        scheduler_version=REVIEW_POLICY_VERSION,
    )


def _current_schedule_for_subtopic(
    cursor,
    *,
    user_id: uuid.UUID,
    subtopic_id: uuid.UUID,
) -> dict[str, Any] | None:
    cursor.execute(
        """
        SELECT
            status::text, learning_state, due_at, interval_days,
            success_streak, scheduler_version, scheduler_metadata
        FROM review_queue
        WHERE user_id = %s
          AND target_type = 'SUBTOPIC'
          AND subtopic_id = %s
          AND learning_state IS NOT NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        """,
        [user_id, subtopic_id],
    )
    row = cursor.fetchone()
    if row is None:
        return None
    metadata = _json_object(row[6] or {})
    return _review_schedule_projection(
        status=str(row[0]),
        learning_state=None if row[1] is None else str(row[1]),
        due_at=row[2],
        interval_days=_float(row[3]),
        consecutive_correct_reviews=int(metadata.get("review_correct_streak", 0) or 0),
        graduated=False,
        scheduler_version=str(row[5]),
    )


def _graduated_schedule_for_correct_normal_answer(
    cursor,
    *,
    user_id: uuid.UUID,
    subtopic_id: uuid.UUID,
) -> dict[str, Any] | None:
    """Keep a graduated concept out of review after later correct normal evidence."""
    cursor.execute(
        """
        SELECT due_at, interval_days, scheduler_version, scheduler_metadata
        FROM review_queue
        WHERE user_id = %s
          AND target_type = 'SUBTOPIC'
          AND subtopic_id = %s
          AND status = 'COMPLETED'
          AND learning_state IS NULL
          AND scheduler_metadata->>'graduated' = 'true'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        """,
        [user_id, subtopic_id],
    )
    row = cursor.fetchone()
    if row is None:
        return None
    metadata = _json_object(row[3] or {})
    return _review_schedule_projection(
        status="COMPLETED",
        learning_state=None,
        due_at=row[0],
        interval_days=_float(row[1]),
        consecutive_correct_reviews=int(
            metadata.get("review_correct_streak", 0) or 0
        ),
        graduated=True,
        scheduler_version=str(row[2]),
    )


def _error_review_projection(
    row,
    *,
    question_snapshot: Mapping[str, Any],
    schedule: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "kind": "MISTAKE",
        "resolution_status": str(row[1]),
        "reviewability": str(row[2]),
        "marked": bool(row[3]),
        "feedback_state": "REVEALED" if bool(row[10]) else "HIDDEN",
        "previous_selected_option_id": None if row[7] is None else str(row[7]),
        "schedule": schedule,
        "question": _review_public_question(
            question_snapshot, projection_id=row[4]
        ),
    }


def get_review_item_request(request, review_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_review_id = _uuid(review_id, "reviewId")
    meta = _meta(request)

    with transaction.atomic():
        with connection.cursor() as cursor:
            error_row = _load_error_review_item(
                cursor, user_id, parsed_review_id, lock=False
            )
            if error_row is not None:
                snapshot = _json_object(error_row[8])
                schedule = _current_schedule_for_subtopic(
                    cursor,
                    user_id=user_id,
                    subtopic_id=uuid.UUID(str(error_row[5])),
                )
                cursor.execute(
                    """
                    INSERT INTO error_review_events (
                        review_item_id, user_id, event_type, selected_option_id,
                        is_correct, event_at, event_metadata, review_model_version
                    )
                    VALUES (%s, %s, 'ITEM_OPENED', NULL, NULL, now(), '{}'::jsonb, %s)
                    """,
                    [parsed_review_id, user_id, error_row[6]],
                )
                return Response(
                    {
                        "data": _error_review_projection(
                            error_row,
                            question_snapshot=snapshot,
                            schedule=schedule,
                        ),
                        "meta": meta,
                    },
                    status=200,
                )

            spaced = _load_spaced_review_row(
                cursor, user_id, parsed_review_id, lock=False
            )
            if spaced is None:
                raise not_found()
            (
                queue_id,
                subtopic_id,
                status,
                learning_state,
                due_at,
                interval_days,
                success_streak,
                _lapse_count,
                scheduler_version,
                scheduler_metadata,
            ) = spaced
            if str(learning_state) == "SUSPENDED":
                raise APIError(
                    409,
                    "REVIEW_SUSPENDED",
                    "This review concept is temporarily suspended.",
                )
            if due_at > timezone.now():
                raise APIError(
                    409,
                    "REVIEW_NOT_DUE",
                    "This concept is not due for review yet.",
                )
            snapshot = _select_spaced_review_snapshot(
                cursor,
                queue_id=queue_id,
                subtopic_id=subtopic_id,
                scheduler_metadata=scheduler_metadata,
            )
            metadata = _json_object(scheduler_metadata or {})
            schedule = _review_schedule_projection(
                status="DUE",
                learning_state=str(learning_state),
                due_at=due_at,
                interval_days=_float(interval_days),
                consecutive_correct_reviews=int(
                    metadata.get("review_correct_streak", 0) or 0
                ),
                graduated=False,
                scheduler_version=str(scheduler_version),
            )
            return Response(
                {
                    "data": {
                        "id": str(queue_id),
                        "kind": "SPACED",
                        "resolution_status": "UNRESOLVED",
                        "reviewability": "RETRY_ALLOWED",
                        "marked": False,
                        "feedback_state": "HIDDEN",
                        "previous_selected_option_id": None,
                        "schedule": schedule,
                        "question": _review_public_question(
                            snapshot, projection_id=queue_id
                        ),
                    },
                    "meta": meta,
                },
                status=200,
            )


def _validate_review_grade_payload(raw: Any) -> dict[str, str]:
    if not isinstance(raw, Mapping):
        raise _validation({"body": ["Use a JSON object."]})
    if set(raw) != {"selected_option_id"}:
        raise _validation(
            {"body": ["Provide only selected_option_id for a review retry."]}
        )
    return {
        "selected_option_id": _body_uuid(
            raw.get("selected_option_id"), "selected_option_id"
        )
    }


def grade_review_request(request, review_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_review_id = _uuid(review_id, "reviewId")
    payload = _validate_review_grade_payload(request.data)
    selected_option_id = uuid.UUID(payload["selected_option_id"])
    key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(key)
    meta = _meta(request)

    with transaction.atomic():
        with connection.cursor() as cursor:
            idem = _begin_idempotency(
                cursor,
                user_id=user_id,
                operation_id="gradeReview",
                key=key,
                fingerprint=request_hash(
                    {"reviewId": str(parsed_review_id)}, payload
                ),
                request_id=meta["request_id"],
            )
            if idem.get("replayed"):
                response = Response(idem["body"], status=idem["status"])
                response["Idempotent-Replayed"] = "true"
                return response

            error_row = _load_error_review_item(
                cursor, user_id, parsed_review_id, lock=True
            )
            if error_row is not None:
                if str(error_row[2]) != "RETRY_ALLOWED":
                    raise APIError(
                        409,
                        "REVIEW_HISTORY_ONLY",
                        "This historical review item cannot be retried.",
                    )
                snapshot = _json_object(error_row[8])
                feedback = _answer_feedback(snapshot, str(selected_option_id))
                cursor.execute(
                    """
                    INSERT INTO error_review_events (
                        review_item_id, user_id, event_type, selected_option_id,
                        is_correct, event_at, event_metadata, review_model_version
                    )
                    VALUES (
                        %s, %s, 'RETRY_SUBMITTED', %s, %s, now(),
                        %s::jsonb, %s
                    )
                    """,
                    [
                        parsed_review_id,
                        user_id,
                        selected_option_id,
                        feedback["is_correct"],
                        json.dumps(
                            {"srs_advances_under_policy": REVIEW_POLICY_VERSION},
                            separators=(",", ":"),
                        ),
                        error_row[6],
                    ],
                )
                if feedback["is_correct"]:
                    cursor.execute(
                        """
                        UPDATE error_review_items
                        SET resolution_status = 'CORRECTED',
                            corrected_at = now(),
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [parsed_review_id],
                    )
                else:
                    cursor.execute(
                        """
                        UPDATE error_review_items
                        SET resolution_status = 'UNRESOLVED',
                            corrected_at = NULL,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [parsed_review_id],
                    )
                schedule = _direct_review_schedule(
                    cursor,
                    user_id=user_id,
                    subtopic_id=uuid.UUID(str(error_row[5])),
                    is_correct=feedback["is_correct"],
                    event_at=timezone.now(),
                    question_revision_id=str(snapshot["question_revision_id"]),
                    question_uid=str(snapshot["question_uid"]),
                    selected_option_id=str(selected_option_id),
                    source_kind="MISTAKE",
                )
                refreshed = _load_error_review_item(
                    cursor, user_id, parsed_review_id, lock=False
                )
                assert refreshed is not None
                refreshed = list(refreshed)
                refreshed[10] = True
                review_item = _error_review_projection(
                    refreshed,
                    question_snapshot=snapshot,
                    schedule=schedule,
                )
            else:
                spaced = _load_spaced_review_row(
                    cursor, user_id, parsed_review_id, lock=True
                )
                if spaced is None:
                    raise not_found()
                (
                    queue_id,
                    subtopic_id,
                    _status,
                    learning_state,
                    due_at,
                    _interval_days,
                    _success_streak,
                    _lapse_count,
                    _scheduler_version,
                    _scheduler_metadata,
                ) = spaced
                if str(learning_state) == "SUSPENDED":
                    raise APIError(
                        409,
                        "REVIEW_SUSPENDED",
                        "This review concept is temporarily suspended.",
                    )
                if due_at > timezone.now():
                    raise APIError(
                        409,
                        "REVIEW_NOT_DUE",
                        "This concept is not due for review yet.",
                    )
                # Recompute the same deterministic due question that GET served.
                # This binds grading to the displayed question instead of accepting
                # an arbitrary safe option from the same subtopic.
                snapshot = _select_spaced_review_snapshot(
                    cursor,
                    queue_id=queue_id,
                    subtopic_id=subtopic_id,
                    scheduler_metadata=_scheduler_metadata,
                )
                feedback = _answer_feedback(snapshot, str(selected_option_id))
                event_at = timezone.now()
                schedule = _direct_review_schedule(
                    cursor,
                    user_id=user_id,
                    subtopic_id=subtopic_id,
                    is_correct=feedback["is_correct"],
                    event_at=event_at,
                    question_revision_id=str(snapshot["question_revision_id"]),
                    question_uid=str(snapshot["question_uid"]),
                    selected_option_id=str(selected_option_id),
                    source_kind="SPACED",
                    queue_id=queue_id,
                )
                review_item = {
                    "id": str(queue_id),
                    "kind": "SPACED",
                    "resolution_status": (
                        "CORRECTED" if feedback["is_correct"] else "UNRESOLVED"
                    ),
                    "reviewability": (
                        "HISTORY_ONLY" if schedule["graduated"] else "RETRY_ALLOWED"
                    ),
                    "marked": False,
                    "feedback_state": "REVEALED",
                    "previous_selected_option_id": None,
                    "schedule": schedule,
                    "question": _review_public_question(
                        snapshot, projection_id=queue_id
                    ),
                }

            body = {
                "data": {
                    "review_item": review_item,
                    "feedback": feedback,
                    "schedule": schedule,
                },
                "meta": meta,
            }
            _complete_idempotency(
                cursor,
                record_id=idem["record_id"],
                status=200,
                body=body,
                resource_type="REVIEW",
                resource_id=parsed_review_id,
            )

    response = Response(body, status=200)
    response["Idempotent-Replayed"] = "false"
    return response


def reveal_review_answer_request(request, review_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_review_id = _uuid(review_id, "reviewId")
    meta = _meta(request)
    with transaction.atomic():
        with connection.cursor() as cursor:
            row = _load_error_review_item(
                cursor, user_id, parsed_review_id, lock=True
            )
            if row is None:
                raise APIError(
                    409,
                    "REVEAL_NOT_SUPPORTED_FOR_SPACED_REVIEW",
                    "Spaced review requires a retrieval attempt before feedback.",
                )
            snapshot = _json_object(row[8])
            if row[7] is None:
                raise APIError(
                    409,
                    "REVIEW_SOURCE_ANSWER_MISSING",
                    "The historical selected option is unavailable.",
                )
            feedback = _answer_feedback(snapshot, str(row[7]))
            cursor.execute(
                """
                INSERT INTO error_review_events (
                    review_item_id, user_id, event_type, selected_option_id,
                    is_correct, event_at, event_metadata, review_model_version
                )
                VALUES (
                    %s, %s, 'ANSWER_REVEALED', NULL, NULL, now(),
                    '{}'::jsonb, %s
                )
                """,
                [parsed_review_id, user_id, row[6]],
            )
            refreshed = list(row)
            refreshed[10] = True
            schedule = _current_schedule_for_subtopic(
                cursor,
                user_id=user_id,
                subtopic_id=uuid.UUID(str(row[5])),
            )
            review_item = _error_review_projection(
                refreshed,
                question_snapshot=snapshot,
                schedule=schedule,
            )
    return Response(
        {
            "data": {
                "review_item": review_item,
                "feedback": feedback,
                "schedule": schedule,
            },
            "meta": meta,
        },
        status=200,
    )


def set_review_mark_request(request, review_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_review_id = _uuid(review_id, "reviewId")
    if not isinstance(request.data, Mapping) or set(request.data) != {"marked"}:
        raise _validation({"marked": ["Provide a single boolean marked field."]})
    marked = request.data.get("marked")
    if not isinstance(marked, bool):
        raise _validation({"marked": ["Use true or false."]})

    with transaction.atomic():
        with connection.cursor() as cursor:
            row = _load_error_review_item(
                cursor, user_id, parsed_review_id, lock=True
            )
            if row is None:
                raise APIError(
                    409,
                    "MARK_NOT_SUPPORTED_FOR_SPACED_REVIEW",
                    "Only mistake-review items can be marked.",
                )
            cursor.execute(
                """
                UPDATE error_review_items
                SET marked_for_review = %s, updated_at = now()
                WHERE id = %s
                """,
                [marked, parsed_review_id],
            )
            cursor.execute(
                """
                INSERT INTO error_review_events (
                    review_item_id, user_id, event_type, selected_option_id,
                    is_correct, event_at, event_metadata, review_model_version
                )
                VALUES (%s, %s, %s, NULL, NULL, now(), '{}'::jsonb, %s)
                """,
                [
                    parsed_review_id,
                    user_id,
                    "MARKED_FOR_REVIEW" if marked else "UNMARKED_FOR_REVIEW",
                    row[6],
                ],
            )
            refreshed = _load_error_review_item(
                cursor, user_id, parsed_review_id, lock=False
            )
            assert refreshed is not None
            snapshot = _json_object(refreshed[8])
            schedule = _current_schedule_for_subtopic(
                cursor,
                user_id=user_id,
                subtopic_id=uuid.UUID(str(refreshed[5])),
            )
            data = _error_review_projection(
                refreshed,
                question_snapshot=snapshot,
                schedule=schedule,
            )
    return Response({"data": data, "meta": _meta(request)}, status=200)

def _graduated_before_normal_answer(request, attempt_id: Any):
    """Return preserved graduation state when a normal answer is correct.

    This preflight is read-only. It is used only so a later correct normal-test
    answer does not accidentally re-open a concept that has already graduated.
    A later wrong normal-test answer is deliberately allowed to reactivate it.
    """
    try:
        principal = _principal(request)
        user_id = uuid.UUID(str(principal.user_id))
        parsed_attempt_id = _uuid(attempt_id, "attemptId")
        if not isinstance(request.data, Mapping):
            return None
        test_question_id = uuid.UUID(str(request.data.get("test_question_id")))
        selected_option_id = uuid.UUID(str(request.data.get("selected_option_id")))
    except (ValueError, TypeError, AttributeError):
        return None

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT tq.question_snapshot
            FROM test_attempts AS ta
            JOIN test_questions AS tq ON tq.test_id = ta.test_id
            WHERE ta.id = %s
              AND ta.user_id = %s
              AND tq.id = %s
            """,
            [parsed_attempt_id, user_id, test_question_id],
        )
        row = cursor.fetchone()
        if row is None:
            return None
        snapshot = _json_object(row[0])
        if str(snapshot.get("correct_option_id")) != str(selected_option_id):
            return None
        subtopic_id = uuid.UUID(str(snapshot["subtopic_id"]))
        cursor.execute(
            """
            SELECT 1
            FROM review_queue
            WHERE user_id = %s
              AND target_type = 'SUBTOPIC'
              AND subtopic_id = %s
              AND learning_state IS NOT NULL
            LIMIT 1
            """,
            [user_id, subtopic_id],
        )
        if cursor.fetchone() is not None:
            return None
        cursor.execute(
            """
            SELECT id, due_at, interval_days, scheduler_version, scheduler_metadata
            FROM review_queue
            WHERE user_id = %s
              AND target_type = 'SUBTOPIC'
              AND subtopic_id = %s
              AND status = 'COMPLETED'
              AND learning_state IS NULL
              AND scheduler_metadata->>'graduated' = 'true'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            [user_id, subtopic_id],
        )
        graduated = cursor.fetchone()
        if graduated is None:
            return None
        return {
            "user_id": user_id,
            "subtopic_id": subtopic_id,
            "source_queue_id": graduated[0],
            "due_at": graduated[1],
            "interval_days": _float(graduated[2]),
            "scheduler_version": str(graduated[3]),
            "metadata": _json_object(graduated[4] or {}),
        }


def submit_attempt_answer_request(request, attempt_id: Any) -> Response:
    preserved = _graduated_before_normal_answer(request, attempt_id)
    response = runtime_learning.submit_attempt_answer_request(request, attempt_id)
    if preserved is None or response.status_code != 200:
        return response

    body = getattr(response, "data", None)
    if not isinstance(body, Mapping):
        return response
    data = body.get("data")
    if not isinstance(data, Mapping):
        return response
    feedback = data.get("feedback")
    if not isinstance(feedback, Mapping) or feedback.get("is_correct") is not True:
        return response

    answer_id = uuid.UUID(str(data["answer_id"]))
    user_id = preserved["user_id"]
    subtopic_id = preserved["subtopic_id"]
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, learning_state, interval_days, due_at, scheduler_metadata
                FROM review_queue
                WHERE user_id = %s
                  AND target_type = 'SUBTOPIC'
                  AND subtopic_id = %s
                  AND learning_state IS NOT NULL
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                FOR UPDATE
                """,
                [user_id, subtopic_id],
            )
            active = cursor.fetchone()
            if active is None:
                return response
            queue_id, from_state, from_interval, from_due, raw_metadata = active
            metadata = _json_object(raw_metadata or {})
            metadata.update(preserved["metadata"])
            metadata.update(
                {
                    "review_policy_version": REVIEW_POLICY_VERSION,
                    "graduated": True,
                    "graduation_preserved_by_correct_normal_evidence": True,
                    "last_correct_normal_answer_id": str(answer_id),
                }
            )
            cursor.execute(
                """
                UPDATE review_queue
                SET status = 'COMPLETED'::learning_review_status,
                    due_at = %s,
                    interval_days = %s,
                    scheduler_version = %s,
                    learning_state = NULL,
                    state_before_suspend = NULL,
                    suspended_reason = NULL,
                    updated_at = now(),
                    scheduler_metadata = %s::jsonb
                WHERE id = %s
                """,
                [
                    preserved["due_at"],
                    preserved["interval_days"],
                    REVIEW_POLICY_VERSION,
                    json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                    queue_id,
                ],
            )
            cursor.execute(
                """
                INSERT INTO spaced_review_events (
                    review_queue_id, user_id, subtopic_id, source_answer_id,
                    event_type, from_state, to_state, interval_before_days,
                    interval_after_days, due_before, due_after, mastery_band,
                    mastery_confidence, mastery_model_version, scheduler_version,
                    event_at, event_metadata
                )
                VALUES (
                    %s, %s, %s, %s, 'EVIDENCE_REPLAY_ADJUSTED', %s, NULL,
                    %s, %s, %s, %s, NULL, NULL, NULL, %s, now(), %s::jsonb
                )
                """,
                [
                    queue_id,
                    user_id,
                    subtopic_id,
                    answer_id,
                    from_state,
                    _float(from_interval),
                    preserved["interval_days"],
                    from_due,
                    preserved["due_at"],
                    REVIEW_POLICY_VERSION,
                    json.dumps(
                        {
                            "source": "NORMAL_TEST_CORRECT",
                            "reason": "PRESERVE_DIRECT_REVIEW_GRADUATION",
                            "graduated_source_queue_id": str(preserved["source_queue_id"]),
                        },
                        separators=(",", ":"),
                    ),
                ],
            )

    mutable = dict(body)
    mutable_data = dict(data)
    mutable_data["review_schedule"] = {
        "learning_state": None,
        "due_at": _iso(preserved["due_at"]),
        "interval_days": preserved["interval_days"],
        "status": "COMPLETED",
        "scheduler_version": REVIEW_POLICY_VERSION,
        "graduated": True,
    }
    mutable["data"] = mutable_data
    response.data = mutable
    return response


def _fallback_next_action_from_dashboard_data(request, dashboard_data: Mapping[str, Any]):
    snapshot = dict(dashboard_data)
    queue = dict(snapshot.get("review_queue") or {})
    errors = dict(snapshot.get("error_review") or {})
    if int(queue.get("due_count", 0) or 0) > 0:
        return None
    errors["unresolved_group_count"] = 0
    snapshot["error_review"] = errors
    principal = _principal(request)
    with connection.cursor() as cursor:
        cursor.execute("SELECT locale FROM users WHERE id = %s", [uuid.UUID(str(principal.user_id))])
        row = cursor.fetchone()
    snapshot["profile_locale"] = row[0] if row else "en-CA"
    return runtime_dashboard._select_next_action(snapshot)


def dashboard_request(request) -> Response:
    response = runtime_dashboard.dashboard_request(request)
    body = getattr(response, "data", None)
    if response.status_code != 200 or not isinstance(body, Mapping):
        return response
    data = body.get("data")
    if not isinstance(data, Mapping):
        return response
    if str(data.get("next_action")) != "DUE_REVIEW":
        return response
    replacement = _fallback_next_action_from_dashboard_data(request, data)
    if replacement is None:
        return response
    mutable = dict(body)
    mutable_data = dict(data)
    mutable_data["next_action"] = replacement.code
    mutable["data"] = mutable_data
    response.data = mutable
    return response


def next_action_request(request) -> Response:
    response = runtime_dashboard.next_action_request(request)
    body = getattr(response, "data", None)
    if response.status_code != 200 or not isinstance(body, Mapping):
        return response
    data = body.get("data")
    if not isinstance(data, Mapping) or str(data.get("code")) != "DUE_REVIEW":
        return response

    dashboard = runtime_dashboard.dashboard_request(request)
    dashboard_body = getattr(dashboard, "data", None)
    if dashboard.status_code != 200 or not isinstance(dashboard_body, Mapping):
        return response
    dashboard_data = dashboard_body.get("data")
    if not isinstance(dashboard_data, Mapping):
        return response
    replacement = _fallback_next_action_from_dashboard_data(request, dashboard_data)
    if replacement is None:
        return response
    mutable = dict(body)
    mutable["data"] = {
        "code": replacement.code,
        "destination": replacement.destination,
        "reason": replacement.reason,
    }
    response.data = mutable
    return response

