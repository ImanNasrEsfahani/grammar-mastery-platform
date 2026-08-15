from __future__ import annotations

from datetime import timedelta, timezone as dt_timezone
from decimal import Decimal
from typing import Any, Mapping
import hashlib
import hmac
import json
import math
import uuid

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.response import Response

from adaptive.selector import AdaptiveSelectionError, SELECTOR_VERSION, select_adaptive
from backend.django_adapter.middleware import create_request_id
from backend.errors import APIError, not_found
from backend.idempotency import InMemoryIdempotencyRegistry, request_hash
from backend.pagination import CursorCodec, query_fingerprint
from backend.security import Principal
from error_review.engine import materialize_error_items
from mastery.engine import (
    DEFAULT_CONFIG as MASTERY_CONFIG,
    compute_subtopic_mastery,
)
from spaced_repetition.scheduler import (
    DEFAULT_CONFIG as SRS_CONFIG,
    queue_status,
    transition,
)
from test_generator.generator import (
    CONFIG_SCHEMA_VERSION as STAGE13_CONFIG_SCHEMA_VERSION,
    GENERATOR_VERSION,
    GeneratorError,
    generate_plan,
)


LEARNING_RUNTIME_VERSION = "postgres-lessons-tests-provider-v1.0.0"
ADAPTIVE_CONFIG_SCHEMA_VERSION = "adaptive-selection-config-v0.9.0"
IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
SUPPORTED_TEST_MODES = {"custom", "tcf", "adaptive", "review", "mistakes"}
DIFFICULTIES = ("EASY", "MEDIUM", "HARD", "VERY_HARD")
_SCOPE_DIMENSIONS = {"LESSON", "SUBTOPIC", "CATEGORY", "SUBCATEGORY", "TAG"}
_ALLOWED_TEST_FIELDS = {
    "schema_version",
    "mode",
    "question_count",
    "scope",
    "difficulty_mix_pct",
    "lesson_allocation",
    "type_allocation",
    "seed",
}
_ALLOWED_ANSWER_FIELDS = {
    "test_question_id",
    "selected_option_id",
    "response_ms",
}


def _meta(request) -> dict[str, str]:
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


def _uuid(value: Any, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "A query or path parameter is invalid.",
            {field: ["Use a valid UUID."]},
        ) from exc


def _body_uuid(value: Any, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise _validation({field: ["Use a valid UUID."]}) from exc


def _float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _iso(value) -> str:
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _validation(fields: Mapping[str, list[str] | str]) -> APIError:
    return APIError(
        422,
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        fields,
    )


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        decoded = json.loads(value)
        if isinstance(decoded, Mapping):
            return dict(decoded)
    raise APIError(500, "INTERNAL_ERROR", "A stored question snapshot is invalid.")


def _attempt_projection(row) -> dict[str, Any]:
    attempt_id, test_id, status, started_at, completed_at, score_raw, score_pct = row
    return {
        "id": str(attempt_id),
        "test_id": str(test_id),
        "status": str(status),
        "started_at": _iso(started_at),
        "completed_at": None if completed_at is None else _iso(completed_at),
        "score_raw": None if score_raw is None else _float(score_raw),
        "score_pct": None if score_pct is None else _float(score_pct),
    }


def _public_attempt_question(
    test_question_id: Any,
    position: int,
    question_snapshot: Any,
    option_snapshot: Any,
) -> dict[str, Any]:
    snapshot = _json_object(question_snapshot)
    stored_options = option_snapshot
    if isinstance(stored_options, str):
        stored_options = json.loads(stored_options)
    if not isinstance(stored_options, list):
        stored_options = snapshot.get("options")
    if not isinstance(stored_options, list) or len(stored_options) != 4:
        raise APIError(500, "INTERNAL_ERROR", "A stored option snapshot is invalid.")
    options = []
    for option in stored_options:
        if not isinstance(option, Mapping):
            raise APIError(500, "INTERNAL_ERROR", "A stored option snapshot is invalid.")
        options.append(
            {
                "id": str(option["id"]),
                "position": str(option["position"]),
                "text": str(option["text"]),
            }
        )
    return {
        "test_question_id": str(test_question_id),
        "question_revision_id": str(snapshot["question_revision_id"]),
        "position": int(position),
        "stem": str(snapshot["stem"]),
        "stem_locale": str(snapshot["stem_locale"]),
        "question_type": str(snapshot["question_type"]),
        "difficulty": str(snapshot["difficulty"]),
        "options": options,
        "media": [],
    }


def _answer_feedback(snapshot: Mapping[str, Any], selected_option_id: str) -> dict[str, Any]:
    options = snapshot.get("options")
    if not isinstance(options, list):
        raise APIError(500, "INTERNAL_ERROR", "A stored option snapshot is invalid.")
    by_id = {
        str(option.get("id")): option
        for option in options
        if isinstance(option, Mapping) and option.get("id") is not None
    }
    correct_option_id = str(snapshot.get("correct_option_id"))
    selected = by_id.get(str(selected_option_id))
    correct = by_id.get(correct_option_id)
    if selected is None:
        raise _validation(
            {"selected_option_id": ["Use an option from this frozen question."]}
        )
    if correct is None:
        raise APIError(500, "INTERNAL_ERROR", "The stored answer key is invalid.")
    return {
        "is_correct": str(selected_option_id) == correct_option_id,
        "selected_option_id": str(selected_option_id),
        "correct_option_id": correct_option_id,
        "selected_option_explanation": selected.get("explanation"),
        "correct_option_explanation": correct.get("explanation"),
        "full_explanation": snapshot.get("full_explanation"),
    }


def _pagination_codec() -> CursorCodec:
    raw = str(getattr(settings, "STAGE21_JWT_SIGNING_KEY", "") or "").encode("utf-8")
    if len(raw) < 32:
        raise APIError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "The pagination signing dependency is not configured.",
        )
    derived = hmac.new(
        raw,
        b"grammar-mastery:stage21:pagination:v1",
        hashlib.sha256,
    ).digest()
    return CursorCodec(derived)


def _parse_page_size(request) -> int:
    raw = request.query_params.get("page[size]", "25")
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The page size is invalid.",
            {"page[size]": ["Use a value between 1 and 100."]},
        ) from exc
    if not 1 <= value <= 100:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The page size is invalid.",
            {"page[size]": ["Use a value between 1 and 100."]},
        )
    return value


def _lesson_projection(row) -> dict[str, Any]:
    (
        lesson_id,
        lesson_no,
        title_fr,
        short_title,
        category_id,
        subcategory_id,
        category_title_fr,
        category_title_fa,
        subcategory_title_fr,
        subcategory_title_fa,
        tcf_weight,
        active,
        question_count,
    ) = row
    return {
        "id": str(lesson_id),
        "lesson_no": int(lesson_no),
        "title_fr": str(title_fr),
        "short_title": str(short_title),
        "category_id": str(category_id),
        "subcategory_id": str(subcategory_id),
        "category_title_fr": str(category_title_fr),
        "category_title_fa": None if category_title_fa is None else str(category_title_fa),
        "subcategory_title_fr": str(subcategory_title_fr),
        "subcategory_title_fa": None if subcategory_title_fa is None else str(subcategory_title_fa),
        "tcf_weight": _float(tcf_weight),
        "active": bool(active),
        "question_count": int(question_count or 0),
    }


def list_lessons_request(request) -> Response:
    _principal(request)

    page_size = _parse_page_size(request)
    cursor_value = request.query_params.get("page[after]")
    sort = request.query_params.get("sort", "lesson_no")
    sort_sql = {
        "lesson_no": "gl.lesson_no ASC, gl.id ASC",
        "-lesson_no": "gl.lesson_no DESC, gl.id ASC",
        "title_fr": "gl.title_fr_official ASC, gl.id ASC",
        "-title_fr": "gl.title_fr_official DESC, gl.id ASC",
        "tcf_weight": "gl.tcf_weight ASC, gl.lesson_no ASC, gl.id ASC",
        "-tcf_weight": "gl.tcf_weight DESC, gl.lesson_no ASC, gl.id ASC",
    }.get(sort)
    if sort_sql is None:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The sort parameter is invalid.",
            {
                "sort": [
                    "Use lesson_no, -lesson_no, title_fr, -title_fr, "
                    "tcf_weight or -tcf_weight."
                ]
            },
        )

    category_raw = request.query_params.get("filter[category_id]")
    tag_raw = request.query_params.get("filter[tag_id]")
    category_id = (
        None if category_raw in (None, "") else _uuid(category_raw, "filter[category_id]")
    )
    tag_id = None if tag_raw in (None, "") else _uuid(tag_raw, "filter[tag_id]")

    filters = {
        "category_id": None if category_id is None else str(category_id),
        "tag_id": None if tag_id is None else str(tag_id),
        "active": True,
    }
    fingerprint = query_fingerprint(filters, sort)
    codec = _pagination_codec()
    offset = codec.decode(cursor_value, fingerprint) if cursor_value else 0

    where = ["gl.active = TRUE"]
    params: list[Any] = []
    if category_id is not None:
        where.append("gl.category_id = %s")
        params.append(category_id)
    if tag_id is not None:
        where.append(
            """
            EXISTS (
                SELECT 1
                FROM lesson_tags AS lt
                WHERE lt.lesson_id = gl.id
                  AND lt.tag_id = %s
            )
            """
        )
        params.append(tag_id)

    sql = f"""
        SELECT
            gl.id,
            gl.lesson_no,
            gl.title_fr_official,
            gl.system_short_title,
            gl.category_id,
            gl.subcategory_id,
            gc.display_name_fr,
            gc.display_name_fa,
            gsc.display_name_fr,
            gsc.display_name_fa,
            gl.tcf_weight,
            gl.active,
            COALESCE(question_counts.question_count, 0)
        FROM grammar_lessons AS gl
        JOIN grammar_categories AS gc ON gc.id = gl.category_id
        JOIN grammar_categories AS gsc ON gsc.id = gl.subcategory_id
        LEFT JOIN (
            SELECT q.lesson_id, count(*) AS question_count
            FROM questions AS q
            WHERE q.status = 'PUBLISHED'
              AND q.retired_at IS NULL
              AND q.correct_option_id IS NOT NULL
              AND (SELECT count(*) FROM question_options AS qo WHERE qo.question_id = q.id) = 4
              AND NOT EXISTS (
                  SELECT 1 FROM questions AS newer
                  WHERE newer.question_uid = q.question_uid
                    AND newer.revision > q.revision
              )
            GROUP BY q.lesson_id
        ) AS question_counts ON question_counts.lesson_id = gl.id
        WHERE {" AND ".join(where)}
        ORDER BY {sort_sql}
        LIMIT %s OFFSET %s
    """
    params.extend([page_size + 1, offset])

    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    has_more = len(rows) > page_size
    selected = rows[:page_size]
    next_offset = offset + len(selected)
    body = {
        "data": [_lesson_projection(row) for row in selected],
        "page": {
            "page_size": page_size,
            "has_more": has_more,
            "next_cursor": (
                codec.encode(next_offset, fingerprint) if has_more else None
            ),
        },
        "meta": _meta(request),
    }
    return Response(body, status=200)


def lesson_detail_request(request, lesson_id: Any) -> Response:
    _principal(request)
    parsed = _uuid(lesson_id, "lessonId")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                gl.id,
                gl.lesson_no,
                gl.title_fr_official,
                gl.system_short_title,
                gl.category_id,
                gl.subcategory_id,
                gc.display_name_fr,
                gc.display_name_fa,
                gsc.display_name_fr,
                gsc.display_name_fa,
                gl.tcf_weight,
                gl.active,
                COALESCE(question_counts.question_count, 0)
            FROM grammar_lessons AS gl
            JOIN grammar_categories AS gc ON gc.id = gl.category_id
            JOIN grammar_categories AS gsc ON gsc.id = gl.subcategory_id
            LEFT JOIN (
                SELECT q.lesson_id, count(*) AS question_count
                FROM questions AS q
                WHERE q.status = 'PUBLISHED'
                  AND q.retired_at IS NULL
                  AND q.correct_option_id IS NOT NULL
                  AND (SELECT count(*) FROM question_options AS qo WHERE qo.question_id = q.id) = 4
                  AND NOT EXISTS (
                      SELECT 1 FROM questions AS newer
                      WHERE newer.question_uid = q.question_uid
                        AND newer.revision > q.revision
                  )
                GROUP BY q.lesson_id
            ) AS question_counts ON question_counts.lesson_id = gl.id
            WHERE gl.id = %s
              AND gl.active = TRUE
            """,
            [parsed],
        )
        lesson_row = cursor.fetchone()
        if lesson_row is None:
            raise not_found()

        cursor.execute(
            """
            SELECT
                gs.id,
                gs.subtopic_code,
                gs.title_fr,
                gs.title_fa,
                gs.short_definition_fa,
                gs.active
            FROM grammar_subtopics AS gs
            WHERE gs.lesson_id = %s
              AND gs.active = TRUE
            ORDER BY gs.subtopic_code ASC, gs.id ASC
            """,
            [parsed],
        )
        subtopics = [
            {
                "id": str(row[0]),
                "code": str(row[1]),
                "title_fr": str(row[2]),
                "title_fa": row[3],
                "short_definition_fa": row[4],
                "active": bool(row[5]),
            }
            for row in cursor.fetchall()
        ]

    data = _lesson_projection(lesson_row)
    data["subtopics"] = subtopics
    return Response({"data": data, "meta": _meta(request)}, status=200)


def _optional_boolean_query(request, name: str) -> bool | None:
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return None
    normalized = str(raw).lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise APIError(
        400,
        "QUERY_PARAMETER_INVALID",
        "A query parameter is invalid.",
        {name: ["Use true or false."]},
    )


def list_reviews_request(request) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    page_size = _parse_page_size(request)
    cursor_value = request.query_params.get("page[after]")
    kind = request.query_params.get("filter[kind]")
    resolution = request.query_params.get("filter[resolution_status]")
    marked = _optional_boolean_query(request, "filter[marked]")
    due = _optional_boolean_query(request, "filter[due]")
    sort = request.query_params.get("sort", "due_at")

    if kind not in (None, "", "MISTAKE", "SPACED"):
        raise APIError(400, "QUERY_PARAMETER_INVALID", "The review kind is invalid.")
    if resolution not in (
        None,
        "",
        "UNRESOLVED",
        "CORRECTED",
        "EXCLUDED_CONTENT_ISSUE",
    ):
        raise APIError(400, "QUERY_PARAMETER_INVALID", "The resolution status is invalid.")
    order_sql = {
        "due_at": "COALESCE(due_at, sort_at) ASC, id ASC",
        "-due_at": "COALESCE(due_at, sort_at) DESC, id ASC",
    }.get(sort)
    if order_sql is None:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The sort parameter is invalid.",
            {"sort": ["Use due_at or -due_at."]},
        )

    filters = {
        "kind": kind or None,
        "resolution_status": resolution or None,
        "marked": marked,
        "due": due,
    }
    fingerprint = query_fingerprint(filters, sort)
    codec = _pagination_codec()
    offset = codec.decode(cursor_value, fingerprint) if cursor_value else 0
    where = ["TRUE"]
    params: list[Any] = [user_id, user_id]
    if kind:
        where.append("kind = %s")
        params.append(kind)
    if resolution:
        where.append("kind = 'MISTAKE' AND status = %s")
        params.append(resolution)
    if marked is not None:
        where.append("marked = %s")
        params.append(marked)
    if due is True:
        where.append("((kind = 'MISTAKE' AND status = 'UNRESOLVED') OR (due_at <= now() AND status <> 'SUSPENDED'))")
    elif due is False:
        where.append("kind = 'SPACED' AND due_at > now() AND status <> 'SUSPENDED'")

    sql = f"""
        WITH mistake_groups AS (
            SELECT DISTINCT ON (eri.group_key)
                eri.id,
                'MISTAKE'::text AS kind,
                eri.resolution_status::text AS status,
                COALESCE(NULLIF(tq.question_snapshot->>'stem', ''), q.stem) AS title,
                eri.group_key,
                count(*) OVER (PARTITION BY eri.group_key)::int AS repeat_count,
                NULL::timestamptz AS due_at,
                eri.marked_for_review AS marked,
                eri.wrong_at AS sort_at
            FROM error_review_items AS eri
            JOIN test_questions AS tq ON tq.id = eri.test_question_id
            JOIN questions AS q ON q.id = eri.question_id
            WHERE eri.user_id = %s
            ORDER BY eri.group_key, eri.wrong_at DESC, eri.id DESC
        ),
        spaced_concepts AS (
            SELECT
                rq.id,
                'SPACED'::text AS kind,
                CASE
                    WHEN rq.learning_state = 'SUSPENDED' THEN 'SUSPENDED'
                    WHEN rq.due_at <= now() THEN 'DUE'
                    ELSE 'SCHEDULED'
                END AS status,
                CASE
                    WHEN u.locale = 'fa-IR' THEN COALESCE(NULLIF(gs.title_fa, ''), gs.title_fr)
                    ELSE gs.title_fr
                END AS title,
                NULL::text AS group_key,
                0::int AS repeat_count,
                rq.due_at,
                FALSE AS marked,
                rq.updated_at AS sort_at
            FROM review_queue AS rq
            JOIN grammar_subtopics AS gs ON gs.id = rq.subtopic_id
            JOIN users AS u ON u.id = rq.user_id
            WHERE rq.user_id = %s
              AND rq.target_type = 'SUBTOPIC'
              AND rq.learning_state IS NOT NULL
        ),
        review_rows AS (
            SELECT * FROM mistake_groups
            UNION ALL
            SELECT * FROM spaced_concepts
        )
        SELECT id, kind, status, title, group_key, repeat_count, due_at, marked
        FROM review_rows
        WHERE {" AND ".join(where)}
        ORDER BY {order_sql}
        LIMIT %s OFFSET %s
    """
    params.extend([page_size + 1, offset])
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    has_more = len(rows) > page_size
    selected = rows[:page_size]
    data = [
        {
            "id": str(row[0]),
            "kind": str(row[1]),
            "status": str(row[2]),
            "title": str(row[3]),
            "group_key": row[4],
            "repeat_count": int(row[5] or 0),
            "due_at": None if row[6] is None else _iso(row[6]),
            "marked": bool(row[7]),
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
                "next_cursor": codec.encode(next_offset, fingerprint) if has_more else None,
            },
            "meta": _meta(request),
        },
        status=200,
    )


def _validate_test_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise _validation({"non_field_errors": ["A JSON object is required."]})
    payload = dict(raw)
    unexpected = sorted(set(payload) - _ALLOWED_TEST_FIELDS)
    if unexpected:
        raise _validation(
            {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}."]}
        )

    mode = str(payload.get("mode", ""))
    if mode not in SUPPORTED_TEST_MODES:
        raise _validation({"mode": ["Use custom, tcf, adaptive, review or mistakes."]})

    try:
        question_count = int(payload.get("question_count"))
    except (TypeError, ValueError) as exc:
        raise _validation({"question_count": ["Use an integer between 1 and 100."]}) from exc
    if not 1 <= question_count <= 100:
        raise _validation({"question_count": ["Use an integer between 1 and 100."]})

    schema_version = str(payload.get("schema_version", ""))
    expected_schema = (
        ADAPTIVE_CONFIG_SCHEMA_VERSION if mode == "adaptive" else STAGE13_CONFIG_SCHEMA_VERSION
    )
    if schema_version != expected_schema:
        raise _validation(
            {
                "schema_version": [
                    f"{mode} mode requires {expected_schema}."
                ]
            }
        )

    scope = payload.get("scope")
    if not isinstance(scope, Mapping) or not scope:
        raise _validation({"scope": ["Provide a non-empty scope object."]})

    mix = payload.get("difficulty_mix_pct")
    if not isinstance(mix, Mapping) or set(mix) != set(DIFFICULTIES):
        raise _validation(
            {
                "difficulty_mix_pct": [
                    "Provide EASY, MEDIUM, HARD and VERY_HARD percentages."
                ]
            }
        )
    try:
        values = {key: float(mix[key]) for key in DIFFICULTIES}
    except (TypeError, ValueError) as exc:
        raise _validation(
            {"difficulty_mix_pct": ["Difficulty percentages must be numeric."]}
        ) from exc
    if any(value < 0 or value > 100 for value in values.values()) or not math.isclose(
        sum(values.values()), 100.0, abs_tol=1e-9
    ):
        raise _validation(
            {"difficulty_mix_pct": ["Difficulty percentages must total exactly 100."]}
        )

    seed = payload.get("seed")
    if seed is not None and (not isinstance(seed, str) or len(seed) > 256):
        raise _validation({"seed": ["Use a string of at most 256 characters."]})

    payload["mode"] = mode
    payload["question_count"] = question_count
    payload["difficulty_mix_pct"] = values
    return payload


def _active_lesson_ids(cursor) -> list[str]:
    cursor.execute(
        """
        SELECT id
        FROM grammar_lessons
        WHERE active = TRUE
        ORDER BY lesson_no, id
        """
    )
    return [str(row[0]) for row in cursor.fetchall()]


def _normalize_scope(scope: Mapping[str, Any], active_lessons: list[str]) -> dict[str, Any]:
    if scope.get("all_active_lessons") is True:
        return {
            "combine": "AND",
            "clauses": [{"dimension": "LESSON", "ids": list(active_lessons)}],
        }

    if "lesson_ids" in scope:
        raw_ids = scope.get("lesson_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise _validation({"scope.lesson_ids": ["Provide at least one lesson UUID."]})
        return {
            "combine": "AND",
            "clauses": [
                {
                    "dimension": "LESSON",
                    "ids": [_body_uuid(value, "scope.lesson_ids") for value in raw_ids],
                }
            ],
        }

    combine = str(scope.get("combine", ""))
    clauses = scope.get("clauses")
    if combine not in {"AND", "OR"} or not isinstance(clauses, list) or not clauses:
        raise _validation(
            {
                "scope": [
                    "Use all_active_lessons, lesson_ids, or canonical combine+clauses."
                ]
            }
        )

    normalized_clauses = []
    for index, clause in enumerate(clauses):
        if not isinstance(clause, Mapping):
            raise _validation({f"scope.clauses[{index}]": ["Use an object."]})
        dimension = str(clause.get("dimension", ""))
        if dimension not in _SCOPE_DIMENSIONS:
            raise _validation(
                {
                    f"scope.clauses[{index}].dimension": [
                        "Use LESSON, SUBTOPIC, CATEGORY, SUBCATEGORY or TAG."
                    ]
                }
            )
        ids = clause.get("ids")
        if not isinstance(ids, list) or not ids:
            raise _validation({f"scope.clauses[{index}].ids": ["Provide at least one UUID."]})
        normalized = {
            "dimension": dimension,
            "ids": [
                _body_uuid(value, f"scope.clauses[{index}].ids") for value in ids
            ],
        }
        if dimension == "TAG":
            tag_match = str(clause.get("tag_match", "ANY"))
            if tag_match not in {"ANY", "ALL"}:
                raise _validation(
                    {f"scope.clauses[{index}].tag_match": ["Use ANY or ALL."]}
                )
            normalized["tag_match"] = tag_match
        normalized_clauses.append(normalized)
    return {"combine": combine, "clauses": normalized_clauses}


def _matches_scope(candidate: Mapping[str, Any], scope: Mapping[str, Any]) -> bool:
    answers: list[bool] = []
    tags = set(candidate.get("tag_ids", []))
    field_by_dimension = {
        "LESSON": "lesson_id",
        "SUBTOPIC": "subtopic_id",
        "CATEGORY": "category_id",
        "SUBCATEGORY": "subcategory_id",
    }
    for clause in scope["clauses"]:
        ids = set(clause["ids"])
        dimension = clause["dimension"]
        if dimension == "TAG":
            match = (
                ids <= tags
                if clause.get("tag_match", "ANY") == "ALL"
                else bool(ids & tags)
            )
        else:
            match = str(candidate.get(field_by_dimension[dimension])) in ids
        answers.append(match)
    return all(answers) if scope["combine"] == "AND" else any(answers)


def _candidate_rows(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT
            q.id,
            q.question_uid,
            q.lesson_id,
            q.primary_subtopic_id,
            gl.category_id,
            gl.subcategory_id,
            q.initial_difficulty_code::text,
            qt.code,
            gl.tcf_weight,
            COALESCE(
                stc.compatibility_status::text,
                ltc.compatibility_status::text,
                'NOT_SUITABLE'
            ) AS compatibility_status,
            q.guardrail_satisfied,
            COALESCE(stc.allocation_factor, ltc.allocation_factor, 0),
            ARRAY(
                SELECT qtag.tag_id::text
                FROM question_tags AS qtag
                WHERE qtag.question_id = q.id
                ORDER BY qtag.tag_id
            ) AS tag_ids
        FROM questions AS q
        JOIN grammar_lessons AS gl
          ON gl.id = q.lesson_id
         AND gl.active = TRUE
        JOIN grammar_subtopics AS gs
          ON gs.id = q.primary_subtopic_id
         AND gs.active = TRUE
        JOIN question_types AS qt
          ON qt.id = q.question_type_id
         AND qt.active = TRUE
        LEFT JOIN subtopic_question_type_compatibility AS stc
          ON stc.subtopic_id = q.primary_subtopic_id
         AND stc.question_type_id = q.question_type_id
         AND stc.compatibility_version = q.compatibility_version
        LEFT JOIN lesson_question_type_compatibility AS ltc
          ON ltc.lesson_id = q.lesson_id
         AND ltc.question_type_id = q.question_type_id
         AND ltc.compatibility_version = q.compatibility_version
        WHERE q.status = 'PUBLISHED'
          AND q.retired_at IS NULL
          AND q.correct_option_id IS NOT NULL
          AND (
              SELECT count(*)
              FROM question_options AS qo
              WHERE qo.question_id = q.id
          ) = 4
          AND NOT EXISTS (
              SELECT 1
              FROM questions AS newer
              WHERE newer.question_uid = q.question_uid
                AND newer.revision > q.revision
          )
        ORDER BY q.id
        """
    )
    rows = []
    for row in cursor.fetchall():
        (
            revision_id,
            question_uid,
            lesson_id,
            subtopic_id,
            category_id,
            subcategory_id,
            difficulty,
            question_type_code,
            tcf_weight,
            compatibility_status,
            guardrail_satisfied,
            allocation_factor,
            tag_ids,
        ) = row
        compatibility = str(compatibility_status)
        serving = compatibility in {"PREFERRED", "ALLOWED"} or (
            compatibility == "CONDITIONAL" and bool(guardrail_satisfied)
        )
        rows.append(
            {
                "question_revision_id": str(revision_id),
                "question_uid": str(question_uid),
                "lesson_id": str(lesson_id),
                "subtopic_id": str(subtopic_id),
                "category_id": str(category_id),
                "subcategory_id": str(subcategory_id),
                "difficulty": str(difficulty),
                "question_type_code": str(question_type_code),
                "tcf_weight_pct": _float(tcf_weight),
                "status": "PUBLISHED",
                "is_current_revision": True,
                "serving_enabled": serving,
                "blocked_not_scorable": False,
                "compatibility_status": compatibility,
                "conditional_guardrail_passed": bool(guardrail_satisfied),
                "allocation_factor": _float(allocation_factor),
                "tag_ids": list(tag_ids or []),
            }
        )
    return rows


def _adaptive_enrichment(
    cursor,
    user_id: uuid.UUID,
    candidates: list[dict[str, Any]],
) -> None:
    cursor.execute(
        """
        SELECT DISTINCT ON (scope_id)
            scope_id,
            mastery_score,
            confidence
        FROM user_mastery
        WHERE user_id = %s
          AND scope_type = 'SUBTOPIC'
        ORDER BY scope_id, updated_at DESC, id DESC
        """,
        [user_id],
    )
    mastery = {
        str(row[0]): (_float(row[1]), _float(row[2]))
        for row in cursor.fetchall()
    }

    cursor.execute(
        """
        SELECT
            q.question_uid,
            max(ua.answered_at)
        FROM user_answers AS ua
        JOIN test_attempts AS ta
          ON ta.id = ua.attempt_id
        JOIN test_questions AS tq
          ON tq.id = ua.test_question_id
        JOIN questions AS q
          ON q.id = tq.question_id
        WHERE ta.user_id = %s
        GROUP BY q.question_uid
        """,
        [user_id],
    )
    last_seen = {str(row[0]): row[1] for row in cursor.fetchall()}

    cursor.execute(
        """
        SELECT
            subtopic_id,
            count(*)
        FROM error_review_items
        WHERE user_id = %s
          AND resolution_status = 'UNRESOLVED'
        GROUP BY subtopic_id
        """,
        [user_id],
    )
    repeated_errors = {str(row[0]): int(row[1]) for row in cursor.fetchall()}

    cursor.execute(
        """
        SELECT
            subtopic_id,
            max(
                CASE
                    WHEN due_at <= now()
                    THEN EXTRACT(EPOCH FROM (now() - due_at)) / 86400.0
                    ELSE 0
                END
            )
        FROM review_queue
        WHERE user_id = %s
          AND target_type = 'SUBTOPIC'
          AND learning_state IS NOT NULL
          AND learning_state <> 'SUSPENDED'
        GROUP BY subtopic_id
        """,
        [user_id],
    )
    overdue = {str(row[0]): _float(row[1]) for row in cursor.fetchall()}

    now = timezone.now()
    for candidate in candidates:
        subtopic_id = candidate["subtopic_id"]
        question_uid = candidate["question_uid"]
        if subtopic_id in mastery:
            score, confidence = mastery[subtopic_id]
            candidate["mastery_score_pct"] = score
            candidate["mastery_confidence"] = confidence
        seen_at = last_seen.get(question_uid)
        candidate["days_since_seen"] = (
            None
            if seen_at is None
            else max(0.0, (now - seen_at).total_seconds() / 86400.0)
        )
        candidate["misconception_repeat_count"] = repeated_errors.get(subtopic_id, 0)
        candidate["days_overdue"] = overdue.get(subtopic_id, 0.0)


def _generator_api_error(exc: Exception) -> APIError:
    if isinstance(exc, GeneratorError):
        code = str(exc.code)
        message = str(exc)
    elif isinstance(exc, AdaptiveSelectionError):
        code = str(exc.code)
        message = str(exc)
    else:
        raise exc

    if code == "NO_ELIGIBLE_QUESTIONS":
        return APIError(
            422,
            "NO_ELIGIBLE_QUESTIONS",
            "No safe published questions are available for this test.",
        )
    if code in {
        "INSUFFICIENT_ELIGIBLE_INVENTORY",
        "DIVERSITY_CAP_INFEASIBLE",
        "QUOTA_INFEASIBLE",
        "SCOPE_EMPTY",
    }:
        return APIError(
            422,
            "INSUFFICIENT_ELIGIBLE_INVENTORY",
            "The current published inventory cannot satisfy this test configuration.",
        )
    return _validation({"test_config": [message or code]})


def _selection_seed(
    payload: Mapping[str, Any],
    user_id: uuid.UUID,
    idempotency_key: str,
) -> str:
    explicit = payload.get("seed")
    if explicit:
        return str(explicit)
    return hashlib.sha256(
        f"{user_id}|createTest|{idempotency_key}".encode("utf-8")
    ).hexdigest()[:32]


def _select_static(
    payload: Mapping[str, Any],
    scope: dict[str, Any],
    candidates: list[dict[str, Any]],
    seed: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    filtered = [row for row in candidates if _matches_scope(row, scope)]
    stage13_config = {
        "schema_version": STAGE13_CONFIG_SCHEMA_VERSION,
        "mode": payload["mode"],
        "question_count": payload["question_count"],
        "scope": scope,
        "lesson_allocation": payload.get("lesson_allocation")
        or {
            "strategy": "TCF_WEIGHTED"
            if payload["mode"] == "tcf"
            else "UNIFORM"
        },
        "difficulty_mix_pct": dict(payload["difficulty_mix_pct"]),
        "type_allocation": payload.get("type_allocation")
        or {"strategy": "STAGE6_SCOPE_ALLOCATION"},
        "repetition_policy": {},
        "fallback_policy": {"strategy": "STRICT_FAIL"},
        "shuffle": {"questions": True, "options": True},
        "seed": seed,
    }

    type_weights: dict[str, dict[str, float]] = {}
    tcf_weights: dict[str, float] = {}
    for row in filtered:
        lesson_id = row["lesson_id"]
        tcf_weights[lesson_id] = row["tcf_weight_pct"]
        by_type = type_weights.setdefault(lesson_id, {})
        by_type[row["question_type_code"]] = max(
            by_type.get(row["question_type_code"], 0.0),
            float(row["allocation_factor"]),
        )

    try:
        plan = generate_plan(
            stage13_config,
            filtered,
            tcf_weights=tcf_weights,
            type_weights=type_weights,
        )
    except GeneratorError as exc:
        raise _generator_api_error(exc) from exc

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    by_stratum: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in filtered:
        key = (row["lesson_id"], row["difficulty"], row["question_type_code"])
        by_stratum.setdefault(key, []).append(row)

    for key, need in sorted(plan["strata"].items()):
        lesson_id, difficulty, question_type = key.split("|", 2)
        pool = by_stratum.get((lesson_id, difficulty, question_type), [])
        ranked = sorted(
            pool,
            key=lambda row: hashlib.sha256(
                f"{seed}|selection|{row['question_revision_id']}".encode("utf-8")
            ).hexdigest(),
        )
        chosen = [
            row
            for row in ranked
            if row["question_revision_id"] not in selected_ids
        ][: int(need)]
        if len(chosen) != int(need):
            raise APIError(
                422,
                "INSUFFICIENT_ELIGIBLE_INVENTORY",
                "The current published inventory cannot satisfy this test configuration.",
            )
        for row in chosen:
            item = dict(row)
            item["selection_meta"] = {
                "generator_version": GENERATOR_VERSION,
                "stratum": {
                    "lesson_id": lesson_id,
                    "difficulty": difficulty,
                    "question_type_code": question_type,
                },
            }
            selected.append(item)
            selected_ids.add(row["question_revision_id"])

    if len(selected) != payload["question_count"]:
        raise APIError(
            422,
            "INSUFFICIENT_ELIGIBLE_INVENTORY",
            "The current published inventory cannot satisfy this test configuration.",
        )

    selected.sort(
        key=lambda row: hashlib.sha256(
            f"{seed}|question-order|{row['question_revision_id']}".encode("utf-8")
        ).hexdigest()
    )
    return selected, plan, GENERATOR_VERSION


def _select_adaptive(
    payload: Mapping[str, Any],
    scope: dict[str, Any],
    candidates: list[dict[str, Any]],
    seed: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    filtered = [
        dict(row)
        for row in candidates
        if _matches_scope(row, scope)
    ]
    for row in filtered:
        row["in_scope"] = True

    config = {
        "schema_version": ADAPTIVE_CONFIG_SCHEMA_VERSION,
        "mode": "adaptive",
        "question_count": payload["question_count"],
        "seed": seed,
    }
    try:
        result = select_adaptive(config, filtered)
    except AdaptiveSelectionError as exc:
        raise _generator_api_error(exc) from exc
    return result["selected"], result, SELECTOR_VERSION


def _advisory_lock(cursor, user_id: uuid.UUID, operation_id: str, key: str) -> None:
    digest = hashlib.sha256(
        f"{user_id}|{operation_id}|{key}".encode("utf-8")
    ).digest()
    first = int.from_bytes(digest[:4], "big", signed=True)
    second = int.from_bytes(digest[4:8], "big", signed=True)
    cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", [first, second])


def _begin_idempotency(
    cursor,
    *,
    user_id: uuid.UUID,
    operation_id: str,
    key: str,
    fingerprint: str,
    request_id: str,
):
    InMemoryIdempotencyRegistry.validate_key(key)
    _advisory_lock(cursor, user_id, operation_id, key)
    cursor.execute(
        """
        SELECT
            id,
            request_hash,
            state,
            response_status,
            response_body,
            expires_at
        FROM api_idempotency_records
        WHERE user_id = %s
          AND operation_id = %s
          AND idempotency_key = %s
        FOR UPDATE
        """,
        [user_id, operation_id, key],
    )
    existing = cursor.fetchone()
    if existing is not None:
        record_id, previous_hash, state, status, body, expires_at = existing
        if expires_at <= timezone.now():
            cursor.execute(
                "DELETE FROM api_idempotency_records WHERE id = %s",
                [record_id],
            )
        else:
            if str(previous_hash) != fingerprint:
                raise APIError(
                    409,
                    "IDEMPOTENCY_KEY_REUSED",
                    "This idempotency key was already used for a different request.",
                )
            if state == "IN_PROGRESS":
                raise APIError(
                    409,
                    "IDEMPOTENCY_IN_PROGRESS",
                    "A request with this idempotency key is still in progress.",
                )
            if state == "COMPLETED" and status is not None and body is not None:
                return {
                    "status": int(status),
                    "body": body,
                    "replayed": True,
                }
            raise APIError(
                409,
                "IDEMPOTENCY_KEY_REUSED",
                "This idempotency key cannot be reused.",
            )

    cursor.execute(
        """
        INSERT INTO api_idempotency_records (
            user_id,
            operation_id,
            idempotency_key,
            request_hash,
            state,
            request_id,
            expires_at
        )
        VALUES (%s, %s, %s, %s, 'IN_PROGRESS', %s, %s)
        RETURNING id
        """,
        [
            user_id,
            operation_id,
            key,
            fingerprint,
            request_id,
            timezone.now() + timedelta(seconds=IDEMPOTENCY_TTL_SECONDS),
        ],
    )
    return {"record_id": cursor.fetchone()[0], "replayed": False}


def _fetch_snapshot(cursor, selected: Mapping[str, Any], seed: str) -> dict[str, Any]:
    question_id = uuid.UUID(selected["question_revision_id"])
    cursor.execute(
        """
        SELECT
            q.id,
            q.question_uid,
            q.lesson_id,
            q.primary_subtopic_id,
            q.stem,
            q.stem_locale::text,
            qt.code,
            q.initial_difficulty_code::text,
            q.correct_option_id,
            q.full_explanation,
            q.status::text,
            q.guardrail_satisfied
        FROM questions AS q
        JOIN question_types AS qt
          ON qt.id = q.question_type_id
        WHERE q.id = %s
          AND q.status = 'PUBLISHED'
          AND q.retired_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM questions AS newer
              WHERE newer.question_uid = q.question_uid
                AND newer.revision > q.revision
          )
        FOR SHARE OF q
        """,
        [question_id],
    )
    row = cursor.fetchone()
    if row is None:
        raise APIError(
            409,
            "STATE_CONFLICT",
            "Question inventory changed while the test was being created.",
        )

    (
        revision_id,
        question_uid,
        lesson_id,
        subtopic_id,
        stem,
        stem_locale,
        question_type,
        difficulty,
        correct_option_id,
        full_explanation,
        question_status,
        guardrail_satisfied,
    ) = row

    cursor.execute(
        """
        SELECT
            id,
            position,
            option_text,
            locale::text,
            explanation,
            misconception_id
        FROM question_options
        WHERE question_id = %s
        ORDER BY position
        """,
        [question_id],
    )
    option_rows = cursor.fetchall()
    if len(option_rows) != 4:
        raise APIError(
            409,
            "STATE_CONFLICT",
            "Question inventory changed while the test was being created.",
        )

    options = [
        {
            "id": str(option[0]),
            "position": str(option[1]),
            "text": str(option[2]),
            "locale": str(option[3]),
            "explanation": str(option[4]),
            "misconception_id": None if option[5] is None else str(option[5]),
        }
        for option in option_rows
    ]
    options.sort(
        key=lambda option: hashlib.sha256(
            f"{seed}|option-order|{revision_id}|{option['id']}".encode("utf-8")
        ).hexdigest()
    )

    compatibility_status = str(selected["compatibility_status"])
    snapshot = {
        "question_revision_id": str(revision_id),
        "question_uid": str(question_uid),
        "lesson_id": str(lesson_id),
        "subtopic_id": str(subtopic_id),
        "stem": str(stem),
        "stem_locale": str(stem_locale),
        "question_type": str(question_type),
        "difficulty": str(difficulty),
        "correct_option_id": str(correct_option_id),
        "full_explanation": str(full_explanation),
        "question_status": str(question_status),
        "serving_enabled": True,
        "is_current_revision": True,
        "blocked_not_scorable": False,
        "compatibility_status": compatibility_status,
        "conditional_guardrail_passed": bool(guardrail_satisfied),
        "options": options,
    }
    return snapshot


def _persist_test(
    cursor,
    *,
    user_id: uuid.UUID,
    payload: dict[str, Any],
    resolved_scope: dict[str, Any],
    selected: list[dict[str, Any]],
    selection_evidence: dict[str, Any],
    selection_version: str,
    seed: str,
) -> dict[str, Any]:
    mode_db = {
        "custom": "CUSTOM",
        "tcf": "TCF",
        "adaptive": "ADAPTIVE",
    }[payload["mode"]]
    frozen_config = {
        "request": payload,
        "resolved_scope": resolved_scope,
        "seed": seed,
        "selection_evidence": selection_evidence,
        "version_bundle": {
            "runtime_provider": LEARNING_RUNTIME_VERSION,
            "stage13_generator": GENERATOR_VERSION,
            "stage14_selector": SELECTOR_VERSION,
            "selection_model": selection_version,
        },
    }

    cursor.execute(
        """
        INSERT INTO tests (
            user_id,
            mode,
            title,
            config,
            selection_model_version,
            created_at
        )
        VALUES (%s, %s::test_mode, NULL, %s::jsonb, %s, now())
        RETURNING id, created_at
        """,
        [
            user_id,
            mode_db,
            json.dumps(frozen_config, ensure_ascii=False, separators=(",", ":")),
            selection_version,
        ],
    )
    test_id, created_at = cursor.fetchone()

    for position, selected_item in enumerate(selected, start=1):
        snapshot = _fetch_snapshot(cursor, selected_item, seed)
        option_snapshot = snapshot["options"]
        selection_meta = selected_item.get("selection_meta", {})
        score = None
        if isinstance(selection_meta, Mapping):
            score_info = selection_meta.get("score")
            if isinstance(score_info, Mapping):
                adjusted = score_info.get("adjusted_score")
                if adjusted is not None:
                    score = float(adjusted)

        cursor.execute(
            """
            INSERT INTO test_questions (
                test_id,
                question_id,
                position,
                selection_reason,
                selection_score,
                question_snapshot,
                option_snapshot,
                created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, now())
            """,
            [
                test_id,
                uuid.UUID(selected_item["question_revision_id"]),
                position,
                json.dumps(selection_meta, ensure_ascii=False, separators=(",", ":")),
                score,
                json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                json.dumps(option_snapshot, ensure_ascii=False, separators=(",", ":")),
            ],
        )

    return {
        "id": str(test_id),
        "mode": payload["mode"],
        "title": None,
        "question_count": len(selected),
        "selection_model_version": selection_version,
        "created_at": _iso(created_at),
    }


def create_test_request(request) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    payload = _validate_test_payload(request.data)

    if payload["mode"] in {"review", "mistakes"}:
        raise APIError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "Review and mistakes test generation requires the review runtime provider.",
        )

    idempotency_key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(idempotency_key)
    fingerprint = request_hash({}, payload)
    meta = _meta(request)
    seed = _selection_seed(payload, user_id, idempotency_key)

    with transaction.atomic():
        with connection.cursor() as cursor:
            idem = _begin_idempotency(
                cursor,
                user_id=user_id,
                operation_id="createTest",
                key=idempotency_key,
                fingerprint=fingerprint,
                request_id=meta["request_id"],
            )
            if idem.get("replayed"):
                response = Response(idem["body"], status=idem["status"])
                response["Idempotent-Replayed"] = "true"
                return response

            active_lessons = _active_lesson_ids(cursor)
            resolved_scope = _normalize_scope(payload["scope"], active_lessons)
            candidates = _candidate_rows(cursor)
            if payload["mode"] == "adaptive":
                _adaptive_enrichment(cursor, user_id, candidates)

            scoped_candidates = [
                row for row in candidates if _matches_scope(row, resolved_scope)
            ]
            if not any(row.get("serving_enabled") for row in scoped_candidates):
                raise APIError(
                    422,
                    "NO_ELIGIBLE_QUESTIONS",
                    "No safe published questions are available for this test.",
                )

            if payload["mode"] == "adaptive":
                selected, evidence, selection_version = _select_adaptive(
                    payload,
                    resolved_scope,
                    candidates,
                    seed,
                )
            else:
                selected, evidence, selection_version = _select_static(
                    payload,
                    resolved_scope,
                    candidates,
                    seed,
                )

            data = _persist_test(
                cursor,
                user_id=user_id,
                payload=payload,
                resolved_scope=resolved_scope,
                selected=selected,
                selection_evidence=evidence,
                selection_version=selection_version,
                seed=seed,
            )
            body = {"data": data, "meta": meta}

            cursor.execute(
                """
                UPDATE api_idempotency_records
                SET state = 'COMPLETED',
                    response_status = 201,
                    response_body = %s::jsonb,
                    resource_type = 'TEST',
                    resource_id = %s,
                    completed_at = now()
                WHERE id = %s
                  AND state = 'IN_PROGRESS'
                """,
                [
                    json.dumps(body, ensure_ascii=False, separators=(",", ":")),
                    uuid.UUID(data["id"]),
                    idem["record_id"],
                ],
            )
            if cursor.rowcount != 1:
                raise APIError(
                    409,
                    "IDEMPOTENCY_IN_PROGRESS",
                    "The idempotency record could not be completed safely.",
                )

    response = Response(body, status=201)
    response["Idempotent-Replayed"] = "false"
    return response


def _complete_idempotency(
    cursor,
    *,
    record_id: Any,
    status: int,
    body: Mapping[str, Any],
    resource_type: str,
    resource_id: uuid.UUID,
) -> None:
    cursor.execute(
        """
        UPDATE api_idempotency_records
        SET state = 'COMPLETED',
            response_status = %s,
            response_body = %s::jsonb,
            resource_type = %s,
            resource_id = %s,
            completed_at = now()
        WHERE id = %s
          AND state = 'IN_PROGRESS'
        """,
        [
            status,
            json.dumps(body, ensure_ascii=False, separators=(",", ":")),
            resource_type,
            resource_id,
            record_id,
        ],
    )
    if cursor.rowcount != 1:
        raise APIError(
            409,
            "IDEMPOTENCY_IN_PROGRESS",
            "The idempotency record could not be completed safely.",
        )


def start_attempt_request(request, test_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_test_id = _uuid(test_id, "testId")
    key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(key)
    meta = _meta(request)

    with transaction.atomic():
        with connection.cursor() as cursor:
            idem = _begin_idempotency(
                cursor,
                user_id=user_id,
                operation_id="startAttempt",
                key=key,
                fingerprint=request_hash({"testId": str(parsed_test_id)}, {}),
                request_id=meta["request_id"],
            )
            if idem.get("replayed"):
                response = Response(idem["body"], status=idem["status"])
                response["Idempotent-Replayed"] = "true"
                return response

            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM tests
                    WHERE id = %s AND user_id = %s
                ), count(tq.id)
                FROM test_questions AS tq
                WHERE tq.test_id = %s
                """,
                [parsed_test_id, user_id, parsed_test_id],
            )
            owned, question_count = cursor.fetchone()
            if not owned:
                raise not_found()
            if int(question_count or 0) == 0:
                raise APIError(409, "STATE_CONFLICT", "The test has no frozen questions.")

            cursor.execute(
                """
                INSERT INTO test_attempts (
                    test_id, user_id, status, started_at, client_metadata, created_at
                )
                VALUES (%s, %s, 'IN_PROGRESS', now(), '{}'::jsonb, now())
                RETURNING id, test_id, status::text, started_at,
                          completed_at, score_raw, score_pct
                """,
                [parsed_test_id, user_id],
            )
            data = _attempt_projection(cursor.fetchone())
            body = {"data": data, "meta": meta}
            _complete_idempotency(
                cursor,
                record_id=idem["record_id"],
                status=201,
                body=body,
                resource_type="ATTEMPT",
                resource_id=uuid.UUID(data["id"]),
            )

    response = Response(body, status=201)
    response["Idempotent-Replayed"] = "false"
    return response


def next_attempt_question_request(request, attempt_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_attempt_id = _uuid(attempt_id, "attemptId")
    meta = _meta(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT test_id, status::text
            FROM test_attempts
            WHERE id = %s AND user_id = %s
            """,
            [parsed_attempt_id, user_id],
        )
        attempt = cursor.fetchone()
        if attempt is None:
            raise not_found()
        test_id, status = attempt
        if status != "IN_PROGRESS":
            raise APIError(409, "STATE_CONFLICT", "The attempt is not in progress.")

        cursor.execute(
            """
            SELECT tq.id, tq.position, tq.question_snapshot, tq.option_snapshot
            FROM test_questions AS tq
            WHERE tq.test_id = %s
              AND NOT EXISTS (
                  SELECT 1
                  FROM user_answers AS ua
                  WHERE ua.attempt_id = %s
                    AND ua.test_question_id = tq.id
              )
            ORDER BY tq.position
            LIMIT 1
            """,
            [test_id, parsed_attempt_id],
        )
        row = cursor.fetchone()
    if row is None:
        return Response(status=204)
    data = _public_attempt_question(row[0], row[1], row[2], row[3])
    return Response({"data": data, "meta": meta}, status=200)


def _validate_answer_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise _validation({"body": ["Use a JSON object."]})
    extra = sorted(set(raw) - _ALLOWED_ANSWER_FIELDS)
    missing = sorted({"test_question_id", "selected_option_id"} - set(raw))
    fields: dict[str, list[str]] = {}
    if extra:
        fields["body"] = [f"Unknown fields: {', '.join(extra)}."]
    for field in missing:
        fields[field] = ["This field is required."]
    if fields:
        raise _validation(fields)
    response_ms = raw.get("response_ms")
    if response_ms is not None:
        if isinstance(response_ms, bool) or not isinstance(response_ms, int):
            raise _validation({"response_ms": ["Use an integer or null."]})
        if not 0 <= response_ms <= 86_400_000:
            raise _validation({"response_ms": ["Use a value between 0 and 86400000."]})
    return {
        "test_question_id": _body_uuid(raw["test_question_id"], "test_question_id"),
        "selected_option_id": _body_uuid(raw["selected_option_id"], "selected_option_id"),
        "response_ms": response_ms,
    }


def _mastery_and_schedule(
    cursor,
    *,
    user_id: uuid.UUID,
    answer_id: uuid.UUID,
    attempt_id: uuid.UUID,
    test_question_id: uuid.UUID,
    snapshot: Mapping[str, Any],
    selected_option: Mapping[str, Any],
    is_correct: bool,
    response_ms: int | None,
    answered_at,
) -> tuple[dict[str, Any], str | None, dict[str, Any]]:
    subtopic_id = uuid.UUID(str(snapshot["subtopic_id"]))
    cursor.execute(
        """
        SELECT
            ua.id, ua.attempt_id, ua.test_question_id, ua.answer_sequence,
            ua.is_correct, ua.response_ms, ua.answered_at,
            tq.question_snapshot->>'difficulty' AS difficulty_code,
            qo.misconception_id
        FROM user_answers AS ua
        JOIN test_attempts AS ta ON ta.id = ua.attempt_id
        JOIN test_questions AS tq ON tq.id = ua.test_question_id
        LEFT JOIN question_options AS qo ON qo.id = ua.selected_option_id
        WHERE ta.user_id = %s
          AND tq.question_snapshot->>'subtopic_id' = %s
        ORDER BY ua.answered_at, ua.id
        """,
        [user_id, str(subtopic_id)],
    )
    evidence = [
        {
            "answer_id": str(row[0]),
            "attempt_id": str(row[1]),
            "test_question_id": str(row[2]),
            "answer_sequence": int(row[3]),
            "is_correct": row[4],
            "response_ms": row[5],
            "answered_at": row[6],
            "difficulty_code": str(row[7]),
            "misconception_id": None if row[8] is None else str(row[8]),
        }
        for row in cursor.fetchall()
    ]
    mastery = compute_subtopic_mastery(evidence, answered_at)
    cursor.execute(
        """
        INSERT INTO user_mastery (
            user_id, scope_type, scope_id, mastery_score, confidence,
            evidence_count, mastery_model_version, last_evidence_at, updated_at,
            evidence_score, effective_evidence, stability, coverage_ratio, mastery_band
        )
        VALUES (%s, 'SUBTOPIC', %s, %s, %s, %s, %s, %s, now(), %s, %s, %s, %s, %s)
        ON CONFLICT (user_id, scope_type, scope_id, mastery_model_version)
        DO UPDATE SET
            mastery_score = EXCLUDED.mastery_score,
            confidence = EXCLUDED.confidence,
            evidence_count = EXCLUDED.evidence_count,
            last_evidence_at = EXCLUDED.last_evidence_at,
            updated_at = EXCLUDED.updated_at,
            evidence_score = EXCLUDED.evidence_score,
            effective_evidence = EXCLUDED.effective_evidence,
            stability = EXCLUDED.stability,
            coverage_ratio = EXCLUDED.coverage_ratio,
            mastery_band = EXCLUDED.mastery_band
        """,
        [
            user_id, subtopic_id, mastery["mastery_score_pct"], mastery["confidence"],
            mastery["evidence_count"], mastery["model_version"], answered_at,
            mastery["evidence_score_pct"], mastery["effective_evidence"],
            mastery["stability"], mastery["coverage_ratio"], mastery["mastery_band"],
        ],
    )
    cursor.execute(
        """
        INSERT INTO mastery_snapshots (
            user_id, scope_type, scope_id, mastery_score, confidence,
            evidence_count, mastery_model_version, captured_at, source_event,
            evidence_score, effective_evidence, stability, coverage_ratio, mastery_band
        )
        VALUES (%s, 'SUBTOPIC', %s, %s, %s, %s, %s, %s, 'ANSWER_ACCEPTED',
                %s, %s, %s, %s, %s)
        """,
        [
            user_id, subtopic_id, mastery["mastery_score_pct"], mastery["confidence"],
            mastery["evidence_count"], mastery["model_version"], answered_at,
            mastery["evidence_score_pct"], mastery["effective_evidence"],
            mastery["stability"], mastery["coverage_ratio"], mastery["mastery_band"],
        ],
    )

    review_item_id = None
    if not is_correct:
        materialized = materialize_error_items(
            [{
                "answer_id": str(answer_id), "attempt_id": str(attempt_id),
                "test_question_id": str(test_question_id), "answer_sequence": 1,
                "user_id": str(user_id), "question_id": str(snapshot["question_revision_id"]),
                "lesson_id": str(snapshot["lesson_id"]), "subtopic_id": str(subtopic_id),
                "misconception_id": selected_option.get("misconception_id"),
                "difficulty_code": str(snapshot["difficulty"]), "is_correct": False,
                "answered_at": answered_at, "question_status": snapshot.get("question_status", "PUBLISHED"),
                "serving_enabled": bool(snapshot.get("serving_enabled", True)),
                "content_issue_excluded": False,
            }]
        )[0]
        cursor.execute(
            """
            INSERT INTO error_review_items (
                user_id, source_answer_id, test_question_id, question_id,
                lesson_id, subtopic_id, misconception_id, group_key, group_quality,
                difficulty_code, wrong_at, resolution_status, reviewability,
                marked_for_review, corrected_at, review_model_version, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::difficulty_code,
                    %s, %s, %s, FALSE, NULL, %s, now(), now())
            RETURNING id
            """,
            [
                user_id, answer_id, test_question_id,
                uuid.UUID(materialized["question_id"]), uuid.UUID(materialized["lesson_id"]),
                subtopic_id,
                None if materialized["misconception_id"] is None else uuid.UUID(materialized["misconception_id"]),
                materialized["group_key"], materialized["group_quality"],
                materialized["difficulty_code"], answered_at,
                materialized["resolution_status"], materialized["reviewability"],
                materialized["review_model_version"],
            ],
        )
        review_item_id = str(cursor.fetchone()[0])

    cursor.execute(
        """
        SELECT id, learning_state, interval_days, due_at, success_streak,
               lapse_count, state_before_suspend, suspended_reason, last_answer_id
        FROM review_queue
        WHERE user_id = %s AND target_type = 'SUBTOPIC'
          AND subtopic_id = %s AND learning_state IS NOT NULL
        FOR UPDATE
        """,
        [user_id, subtopic_id],
    )
    previous_row = cursor.fetchone()
    previous = None
    queue_id = None
    if previous_row is not None:
        queue_id = previous_row[0]
        previous = {
            "learning_state": str(previous_row[1]), "interval_days": _float(previous_row[2]),
            "due_at": None if previous_row[3] is None else _iso(previous_row[3]),
            "success_streak": int(previous_row[4] or 0), "lapse_count": int(previous_row[5] or 0),
            "state_before_suspend": previous_row[6], "suspended_reason": previous_row[7],
            "last_answer_id": None if previous_row[8] is None else str(previous_row[8]),
        }
    schedule = transition(
        previous,
        {
            "kind": "ANSWER", "event_at": answered_at, "is_correct": is_correct,
            "answer_id": str(answer_id), "mastery_band": mastery["mastery_band"],
            "mastery_confidence": mastery["confidence"],
            "mastery_provider_contract_version": MASTERY_CONFIG["provider_contract_version"],
        },
    )
    status = queue_status(schedule, answered_at)
    if queue_id is None:
        cursor.execute(
            """
            INSERT INTO review_queue (
                user_id, target_type, subtopic_id, status, due_at, interval_days,
                strength, lapse_count, scheduler_version, last_answer_id, updated_at,
                learning_state, success_streak, state_before_suspend, suspended_reason,
                last_scheduled_at, scheduler_metadata
            )
            VALUES (%s, 'SUBTOPIC', %s, %s::learning_review_status, %s, %s, %s, %s,
                    %s, %s, now(), %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            [
                user_id, subtopic_id, status, schedule["due_at"], schedule["interval_days"],
                mastery["mastery_score_pct"], schedule["lapse_count"],
                schedule["scheduler_version"], answer_id, schedule["learning_state"],
                schedule["success_streak"], schedule.get("state_before_suspend"),
                schedule.get("suspended_reason"), answered_at,
                json.dumps({"transition_reason": schedule.get("transition_reason")}),
            ],
        )
        queue_id = cursor.fetchone()[0]
    else:
        cursor.execute(
            """
            UPDATE review_queue
            SET status = %s::learning_review_status, due_at = %s, interval_days = %s,
                strength = %s, lapse_count = %s, scheduler_version = %s,
                last_answer_id = %s, updated_at = now(), learning_state = %s,
                success_streak = %s, state_before_suspend = %s, suspended_reason = %s,
                last_scheduled_at = %s, scheduler_metadata = %s::jsonb
            WHERE id = %s
            """,
            [
                status, schedule["due_at"], schedule["interval_days"],
                mastery["mastery_score_pct"], schedule["lapse_count"],
                schedule["scheduler_version"], answer_id, schedule["learning_state"],
                schedule["success_streak"], schedule.get("state_before_suspend"),
                schedule.get("suspended_reason"), answered_at,
                json.dumps({"transition_reason": schedule.get("transition_reason")}), queue_id,
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
        VALUES (%s, %s, %s, %s, 'ANSWER_SCHEDULED', %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s::jsonb)
        """,
        [
            queue_id, user_id, subtopic_id, answer_id,
            None if previous is None else previous["learning_state"], schedule["learning_state"],
            None if previous is None else previous["interval_days"], schedule["interval_days"],
            None if previous is None else previous["due_at"], schedule["due_at"],
            mastery["mastery_band"], mastery["confidence"], mastery["model_version"],
            SRS_CONFIG["scheduler_version"], answered_at,
            json.dumps({"transition_reason": schedule.get("transition_reason")}),
        ],
    )
    mastery_public = {
        "scope_type": "SUBTOPIC", "scope_id": str(subtopic_id),
        "mastery_score_pct": mastery["mastery_score_pct"],
        "confidence": mastery["confidence"], "coverage_ratio": mastery["coverage_ratio"],
        "evidence_count": mastery["evidence_count"], "mastery_band": mastery["mastery_band"],
        "model_version": mastery["model_version"],
    }
    schedule_public = {
        "learning_state": schedule["learning_state"], "due_at": schedule["due_at"],
        "interval_days": schedule["interval_days"], "status": status,
        "scheduler_version": schedule["scheduler_version"],
    }
    return mastery_public, review_item_id, schedule_public


def submit_attempt_answer_request(request, attempt_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_attempt_id = _uuid(attempt_id, "attemptId")
    payload = _validate_answer_payload(request.data)
    test_question_id = uuid.UUID(payload["test_question_id"])
    selected_option_id = uuid.UUID(payload["selected_option_id"])
    key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(key)
    meta = _meta(request)

    with transaction.atomic():
        with connection.cursor() as cursor:
            idem = _begin_idempotency(
                cursor,
                user_id=user_id,
                operation_id="submitAttemptAnswer",
                key=key,
                fingerprint=request_hash({"attemptId": str(parsed_attempt_id)}, payload),
                request_id=meta["request_id"],
            )
            if idem.get("replayed"):
                response = Response(idem["body"], status=idem["status"])
                response["Idempotent-Replayed"] = "true"
                return response

            cursor.execute(
                """
                SELECT test_id, status::text
                FROM test_attempts
                WHERE id = %s AND user_id = %s
                FOR UPDATE
                """,
                [parsed_attempt_id, user_id],
            )
            attempt = cursor.fetchone()
            if attempt is None:
                raise not_found()
            test_id, status = attempt
            if status != "IN_PROGRESS":
                raise APIError(409, "STATE_CONFLICT", "The attempt is not in progress.")
            cursor.execute(
                """
                SELECT question_snapshot
                FROM test_questions
                WHERE id = %s AND test_id = %s
                """,
                [test_question_id, test_id],
            )
            frozen = cursor.fetchone()
            if frozen is None:
                raise _validation(
                    {"test_question_id": ["Use a frozen question from this attempt."]}
                )
            snapshot = _json_object(frozen[0])
            feedback = _answer_feedback(snapshot, str(selected_option_id))
            selected_option = next(
                option for option in snapshot["options"]
                if str(option["id"]) == str(selected_option_id)
            )
            cursor.execute(
                """
                SELECT 1 FROM user_answers
                WHERE attempt_id = %s AND test_question_id = %s
                LIMIT 1
                """,
                [parsed_attempt_id, test_question_id],
            )
            if cursor.fetchone() is not None:
                raise APIError(
                    409, "ANSWER_ALREADY_SUBMITTED",
                    "This question already has an accepted answer.",
                )
            cursor.execute(
                """
                INSERT INTO user_answers (
                    attempt_id, test_question_id, selected_option_id, answer_sequence,
                    is_correct, response_ms, answered_at, answer_metadata
                )
                VALUES (%s, %s, %s, 1, %s, %s, now(), '{}'::jsonb)
                RETURNING id, answered_at
                """,
                [
                    parsed_attempt_id, test_question_id, selected_option_id,
                    feedback["is_correct"], payload["response_ms"],
                ],
            )
            answer_id, answered_at = cursor.fetchone()
            mastery, review_item_id, schedule = _mastery_and_schedule(
                cursor,
                user_id=user_id,
                answer_id=answer_id,
                attempt_id=parsed_attempt_id,
                test_question_id=test_question_id,
                snapshot=snapshot,
                selected_option=selected_option,
                is_correct=feedback["is_correct"],
                response_ms=payload["response_ms"],
                answered_at=answered_at,
            )
            data = {
                "answer_id": str(answer_id), "attempt_id": str(parsed_attempt_id),
                "test_question_id": str(test_question_id), "answered_at": _iso(answered_at),
                "feedback": feedback, "mastery": mastery,
                "review_item_id": review_item_id, "review_schedule": schedule,
            }
            body = {"data": data, "meta": meta}
            _complete_idempotency(
                cursor, record_id=idem["record_id"], status=200, body=body,
                resource_type="ANSWER", resource_id=answer_id,
            )
    response = Response(body, status=200)
    response["Idempotent-Replayed"] = "false"
    return response


def complete_attempt_request(request, attempt_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_attempt_id = _uuid(attempt_id, "attemptId")
    key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(key)
    meta = _meta(request)
    with transaction.atomic():
        with connection.cursor() as cursor:
            idem = _begin_idempotency(
                cursor, user_id=user_id, operation_id="completeAttempt", key=key,
                fingerprint=request_hash({"attemptId": str(parsed_attempt_id)}, {}),
                request_id=meta["request_id"],
            )
            if idem.get("replayed"):
                response = Response(idem["body"], status=idem["status"])
                response["Idempotent-Replayed"] = "true"
                return response
            cursor.execute(
                """
                SELECT id, test_id, status::text, started_at, completed_at, score_raw, score_pct
                FROM test_attempts
                WHERE id = %s AND user_id = %s
                FOR UPDATE
                """,
                [parsed_attempt_id, user_id],
            )
            attempt = cursor.fetchone()
            if attempt is None:
                raise not_found()
            if str(attempt[2]) == "IN_PROGRESS":
                cursor.execute(
                    """
                    SELECT
                        (SELECT count(*) FROM test_questions WHERE test_id = %s),
                        count(*),
                        count(*) FILTER (WHERE ua.is_correct)
                    FROM user_answers AS ua
                    WHERE ua.attempt_id = %s
                    """,
                    [attempt[1], parsed_attempt_id],
                )
                question_count, answer_count, correct_count = cursor.fetchone()
                if int(question_count) != int(answer_count):
                    raise APIError(
                        409, "STATE_CONFLICT",
                        "Every frozen question must be answered before completion.",
                    )
                score_pct = round(100.0 * int(correct_count) / int(question_count), 6)
                cursor.execute(
                    """
                    UPDATE test_attempts
                    SET status = 'COMPLETED', completed_at = now(), score_raw = %s,
                        score_pct = %s, mastery_model_version = %s
                    WHERE id = %s
                    RETURNING id, test_id, status::text, started_at, completed_at,
                              score_raw, score_pct
                    """,
                    [
                        correct_count, score_pct, MASTERY_CONFIG["model_version"],
                        parsed_attempt_id,
                    ],
                )
                attempt = cursor.fetchone()
            elif str(attempt[2]) != "COMPLETED":
                raise APIError(409, "STATE_CONFLICT", "The attempt cannot be completed.")
            data = _attempt_projection(attempt)
            body = {"data": data, "meta": meta}
            _complete_idempotency(
                cursor, record_id=idem["record_id"], status=200, body=body,
                resource_type="ATTEMPT", resource_id=parsed_attempt_id,
            )
    response = Response(body, status=200)
    response["Idempotent-Replayed"] = "false"
    return response


def attempt_result_request(request, attempt_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_attempt_id = _uuid(attempt_id, "attemptId")
    meta = _meta(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT test_id, status::text, completed_at, score_raw, score_pct
            FROM test_attempts
            WHERE id = %s AND user_id = %s
            """,
            [parsed_attempt_id, user_id],
        )
        attempt = cursor.fetchone()
        if attempt is None:
            raise not_found()
        test_id, status, completed_at, score_raw, score_pct = attempt
        if status != "COMPLETED":
            raise APIError(409, "STATE_CONFLICT", "The result is available after completion.")
        cursor.execute(
            """
            SELECT tq.id, tq.position, tq.question_snapshot, ua.id, ua.selected_option_id
            FROM test_questions AS tq
            JOIN user_answers AS ua
              ON ua.test_question_id = tq.id AND ua.attempt_id = %s
            WHERE tq.test_id = %s
            ORDER BY tq.position
            """,
            [parsed_attempt_id, test_id],
        )
        breakdown = [
            {
                "test_question_id": str(row[0]), "position": int(row[1]),
                "answer_id": str(row[3]),
                "feedback": _answer_feedback(_json_object(row[2]), str(row[4])),
            }
            for row in cursor.fetchall()
        ]
    data = {
        "attempt_id": str(parsed_attempt_id), "status": "COMPLETED",
        "score_raw": _float(score_raw), "score_pct": _float(score_pct),
        "completed_at": _iso(completed_at), "breakdown": breakdown,
    }
    return Response({"data": data, "meta": meta}, status=200)
