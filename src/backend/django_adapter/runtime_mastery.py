from __future__ import annotations

"""Runtime provider for the frozen Stage 21 ``GET /mastery`` contract.

Learner answers are persisted at SUBTOPIC scope by the Stage 15 write path.
The public mastery collection, however, also exposes LESSON and CATEGORY
scopes.  Those parent scopes are therefore derived from the canonical
subtopic evidence when a persisted parent snapshot is not available.

The aggregation deliberately reuses the same helpers as the Grammar Mastery
Map so the lessons page, mastery map and dashboard do not calculate different
mastery values from the same evidence.
"""

from collections import defaultdict
from typing import Any, Mapping
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter import runtime_learning, runtime_mastery_map
from backend.errors import APIError
from mastery.engine import compute_subtopic_mastery


MASTERY_COLLECTION_RUNTIME_VERSION = "postgres-mastery-collection-v1.0.0"
_ALLOWED_SCOPES = {"SUBTOPIC", "LESSON", "CATEGORY", "TAG"}


def _filters(request) -> tuple[str | None, uuid.UUID | None]:
    scope_type_raw = request.query_params.get("filter[scope_type]")
    scope_type = None if scope_type_raw in (None, "") else str(scope_type_raw).strip()
    if scope_type is not None and scope_type not in _ALLOWED_SCOPES:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The mastery scope type is invalid.",
            {
                "filter[scope_type]": [
                    "Use SUBTOPIC, LESSON, CATEGORY or TAG."
                ]
            },
        )

    scope_id_raw = request.query_params.get("filter[scope_id]")
    scope_id = (
        None
        if scope_id_raw in (None, "")
        else runtime_learning._uuid(scope_id_raw, "filter[scope_id]")
    )
    return scope_type, scope_id


def _mastery_item(
    scope_type: str,
    scope_id: str,
    scope_title: str | None,
    value: Mapping[str, Any],
) -> dict[str, Any]:
    # _public_mastery is the normalization boundary already used by the
    # mastery-map UI.  Only fields present in the frozen MasteryItem contract
    # are projected here.
    public = runtime_mastery_map._public_mastery(
        value,
        source="MASTERY_COLLECTION",
        canonical_scope=True,
    )
    return {
        "scope_type": scope_type,
        "scope_id": str(scope_id),
        "scope_title": scope_title,
        "mastery_score_pct": public["mastery_score_pct"],
        "confidence": public["confidence"],
        "coverage_ratio": public["coverage_ratio"],
        "evidence_count": public["evidence_count"],
        "mastery_band": public["mastery_band"],
        "model_version": public["model_version"],
    }


def _load_persisted_tag_mastery(
    cursor,
    user_id: uuid.UUID,
    as_of,
) -> list[dict[str, Any]]:
    """Return persisted TAG rows without inventing a parallel tag algorithm.

    The current answer write-path creates SUBTOPIC evidence.  If a calibration
    or analytics job has materialized TAG mastery, expose it; otherwise TAG is
    simply an empty collection.  This keeps the Stage 21 contract truthful.
    """
    cursor.execute(
        """
        SELECT DISTINCT ON (um.scope_id)
            um.scope_id,
            t.display_name_fr,
            um.mastery_score,
            um.confidence,
            um.evidence_count,
            um.mastery_model_version,
            um.evidence_score,
            um.effective_evidence,
            um.stability,
            um.coverage_ratio,
            um.mastery_band
        FROM user_mastery AS um
        LEFT JOIN tags AS t ON t.id = um.scope_id
        WHERE um.user_id = %s
          AND um.scope_type = 'TAG'
        ORDER BY um.scope_id, um.updated_at DESC, um.mastery_model_version DESC
        """,
        [user_id],
    )

    items: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        value = runtime_mastery_map._normalize_stored(row[2:], as_of)
        items.append(
            _mastery_item(
                "TAG",
                str(row[0]),
                None if row[1] is None else str(row[1]),
                value,
            )
        )
    return items



def _load_missing_subtopic_evidence(
    cursor,
    user_id: uuid.UUID,
    known_subtopic_ids: set[str],
) -> dict[str, list[dict[str, Any]]]:
    """Read accepted historical answers only for subtopics lacking a snapshot.

    Normal answer submission persists ``user_mastery`` transactionally.  This
    fallback exists for older/imported attempts created before that projection
    was available, so existing test history is not shown as "not started".
    It is read-only and uses the canonical Stage 15 engine for calculation.
    """
    cursor.execute(
        """
        SELECT
            tq.question_snapshot->>'subtopic_id' AS subtopic_id,
            ua.id,
            ua.attempt_id,
            ua.test_question_id,
            ua.answer_sequence,
            ua.is_correct,
            ua.response_ms,
            ua.answered_at,
            tq.question_snapshot->>'difficulty' AS difficulty_code,
            qo.misconception_id
        FROM user_answers AS ua
        JOIN test_attempts AS ta ON ta.id = ua.attempt_id
        JOIN test_questions AS tq ON tq.id = ua.test_question_id
        LEFT JOIN question_options AS qo ON qo.id = ua.selected_option_id
        WHERE ta.user_id = %s
          AND ua.is_correct IS NOT NULL
          AND tq.question_snapshot->>'subtopic_id' IS NOT NULL
        ORDER BY ua.answered_at ASC, ua.id ASC
        """,
        [user_id],
    )

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cursor.fetchall():
        subtopic_id = str(row[0])
        if subtopic_id in known_subtopic_ids:
            continue
        grouped[subtopic_id].append(
            {
                "answer_id": str(row[1]),
                "attempt_id": str(row[2]),
                "test_question_id": str(row[3]),
                "answer_sequence": int(row[4] or 1),
                "is_correct": bool(row[5]),
                "response_ms": None if row[6] is None else int(row[6]),
                "answered_at": row[7],
                "difficulty_code": str(row[8] or "MEDIUM"),
                "misconception_id": None if row[9] is None else str(row[9]),
            }
        )
    return grouped

def mastery_request(request) -> Response:
    """Serve current mastery, including real lesson aggregates from tests."""
    principal = runtime_mastery_map._principal(request)
    user_id = runtime_mastery_map._user_uuid(principal)
    scope_type_filter, scope_id_filter = _filters(request)
    as_of = timezone.now()

    with connection.cursor() as cursor:
        latest = runtime_mastery_map._load_latest_mastery(cursor, user_id, as_of)
        categories, _subcategories, lessons, subtopics = runtime_mastery_map._load_taxonomy(cursor)
        historical_fallback = _load_missing_subtopic_evidence(
            cursor,
            user_id,
            {scope_id for (scope_type, scope_id) in latest if scope_type == "SUBTOPIC"},
        )
        tag_items = (
            _load_persisted_tag_mastery(cursor, user_id, as_of)
            if scope_type_filter in (None, "TAG")
            else []
        )

    subtopics_by_lesson: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for subtopic in subtopics:
        subtopics_by_lesson[subtopic["lesson_id"]].append(subtopic)

    subtopic_values: dict[str, dict[str, Any]] = {}
    subtopic_items: list[dict[str, Any]] = []
    for subtopic in subtopics:
        persisted = latest.get(("SUBTOPIC", subtopic["id"]))
        if persisted is not None:
            value = persisted
        elif historical_fallback.get(subtopic["id"]):
            value = compute_subtopic_mastery(historical_fallback[subtopic["id"]], as_of)
        else:
            value = runtime_mastery_map._empty_mastery(as_of)
        subtopic_values[subtopic["id"]] = value
        subtopic_items.append(
            _mastery_item(
                "SUBTOPIC",
                subtopic["id"],
                subtopic["title_fr"],
                value,
            )
        )

    lesson_values: dict[str, dict[str, Any]] = {}
    lesson_items: list[dict[str, Any]] = []
    lessons_by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for lesson in lessons:
        child_values = [
            subtopic_values[subtopic["id"]]
            for subtopic in subtopics_by_lesson.get(lesson["id"], [])
        ]
        persisted = latest.get(("LESSON", lesson["id"]))
        if persisted is not None:
            value = persisted
        elif child_values:
            # This is the critical production fallback: accepted test answers
            # currently persist SUBTOPIC mastery, so lesson cards must aggregate
            # those children instead of pretending the lesson has no evidence.
            value = runtime_mastery_map._aggregate(child_values, None)
        else:
            value = runtime_mastery_map._empty_mastery(as_of)

        lesson_values[lesson["id"]] = value
        lessons_by_category[lesson["category_id"]].append(lesson)
        lesson_items.append(
            _mastery_item(
                "LESSON",
                lesson["id"],
                lesson["title_fr"],
                value,
            )
        )

    category_items: list[dict[str, Any]] = []
    category_by_id = {category["id"]: category for category in categories}
    for category in categories:
        child_lessons = lessons_by_category.get(category["id"], [])
        child_values = [lesson_values[lesson["id"]] for lesson in child_lessons]
        weights = [float(lesson["tcf_weight"]) for lesson in child_lessons]
        persisted = latest.get(("CATEGORY", category["id"]))
        if persisted is not None:
            value = persisted
        elif child_values:
            value = runtime_mastery_map._aggregate(child_values, weights)
        else:
            value = runtime_mastery_map._empty_mastery(as_of)
        category_items.append(
            _mastery_item(
                "CATEGORY",
                category["id"],
                category["title_fr"],
                value,
            )
        )

    # Keep deterministic, human-meaningful order.  The lesson page itself maps
    # by UUID, but stable ordering makes this endpoint easier to audit/test.
    lesson_order = {lesson["id"]: lesson["lesson_no"] for lesson in lessons}
    subtopic_order = {
        subtopic["id"]: (
            lesson_order.get(subtopic["lesson_id"], 10**9),
            subtopic["code"],
            subtopic["id"],
        )
        for subtopic in subtopics
    }
    category_order = {
        category_id: category_by_id[category_id]["display_order"]
        for category_id in category_by_id
    }

    subtopic_items.sort(key=lambda item: subtopic_order.get(item["scope_id"], (10**9, "", item["scope_id"])))
    lesson_items.sort(key=lambda item: (lesson_order.get(item["scope_id"], 10**9), item["scope_id"]))
    category_items.sort(key=lambda item: (category_order.get(item["scope_id"], 10**9), item["scope_id"]))
    tag_items.sort(key=lambda item: ((item.get("scope_title") or ""), item["scope_id"]))

    by_scope = {
        "SUBTOPIC": subtopic_items,
        "LESSON": lesson_items,
        "CATEGORY": category_items,
        "TAG": tag_items,
    }
    data = (
        [*subtopic_items, *lesson_items, *category_items, *tag_items]
        if scope_type_filter is None
        else list(by_scope[scope_type_filter])
    )

    if scope_id_filter is not None:
        wanted = str(scope_id_filter)
        data = [item for item in data if item["scope_id"] == wanted]

    return Response(
        {
            "data": data,
            "meta": runtime_learning._meta(request),
        },
        status=200,
    )
