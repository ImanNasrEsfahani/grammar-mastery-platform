from __future__ import annotations

"""Read-only learner-facing grammar search.

The search surface projects canonical Stage 1/2 curriculum data plus persisted
learner mastery/error evidence. It never invents a parallel grammar taxonomy or
mastery state. ``RULE`` hits are a UI/search projection of canonical subtopic
rule text (definition / teaching note), not a new database entity.
"""

from decimal import Decimal
from typing import Any
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter.middleware import create_request_id
from backend.errors import APIError
from backend.security import Principal


SEARCH_RUNTIME_VERSION = "grammar-search-runtime-v1.0.0"
SEARCH_KINDS = ("ALL", "LESSON", "SUBTOPIC", "RULE", "CATEGORY")
_KIND_ORDER = {"LESSON": 0, "SUBTOPIC": 1, "RULE": 2, "CATEGORY": 3}
_MAX_QUERY_LENGTH = 120
_MAX_LIMIT = 50
_PER_KIND_FETCH = 50


def _meta(request) -> dict[str, str]:
    return {
        "request_id": create_request_id(getattr(request, "request_id", None)),
        "api_version": "v1",
    }


def _principal(request) -> Principal:
    principal = getattr(request, "auth", None)
    if not isinstance(principal, Principal):
        raise APIError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
    return principal


def _user_uuid(principal: Principal) -> uuid.UUID:
    try:
        return uuid.UUID(str(principal.user_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise APIError(401, "TOKEN_INVALID", "The access token is invalid or expired.") from exc


def _normalize_search_query(value: Any) -> str:
    query = " ".join(str(value or "").strip().split())
    if len(query) > _MAX_QUERY_LENGTH:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The search query is too long.",
            {"q": [f"Use at most {_MAX_QUERY_LENGTH} characters."]},
        )
    return query


def _normalize_kind(value: Any) -> str:
    kind = str(value or "ALL").strip().upper()
    if kind not in SEARCH_KINDS:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The search kind is invalid.",
            {"kind": ["Use ALL, LESSON, SUBTOPIC, RULE or CATEGORY."]},
        )
    return kind


def _normalize_locale(value: Any) -> str:
    locale = str(value or "fa").strip().lower()
    if locale not in {"fa", "en"}:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The locale is invalid.",
            {"locale": ["Use fa or en."]},
        )
    return locale


def _normalize_limit(value: Any) -> int:
    raw = 30 if value in (None, "") else value
    try:
        limit = int(raw)
    except (TypeError, ValueError) as exc:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The result limit is invalid.",
            {"limit": [f"Use a value between 1 and {_MAX_LIMIT}."]},
        ) from exc
    if not 1 <= limit <= _MAX_LIMIT:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The result limit is invalid.",
            {"limit": [f"Use a value between 1 and {_MAX_LIMIT}."]},
        )
    return limit


def _like_pattern(query: str, *, prefix: bool = False) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%" if prefix else f"%{escaped}%"


def _float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _mastery(
    score: Any,
    confidence: Any,
    evidence_count: Any,
    band: Any,
) -> dict[str, Any]:
    evidence = int(evidence_count or 0)
    if score is None or evidence <= 0:
        return {
            "score_pct": None,
            "confidence": 0.0 if confidence is None else _float(confidence),
            "evidence_count": evidence,
            "band": "NO_EVIDENCE",
        }
    stored_band = str(band or "UNCERTAIN")
    if stored_band not in {"NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG"}:
        stored_band = "UNCERTAIN"
    return {
        "score_pct": round(_float(score) or 0.0, 3),
        "confidence": round(_float(confidence) or 0.0, 6),
        "evidence_count": evidence,
        "band": stored_band,
    }


def _lesson_rows(cursor, *, user_id: uuid.UUID, query: str) -> tuple[list[dict[str, Any]], int]:
    contains = _like_pattern(query)
    prefix = _like_pattern(query, prefix=True)
    cursor.execute(
        """
        SELECT
            gl.id,
            gl.lesson_no,
            gl.title_fr_official,
            gl.system_short_title,
            gc.id,
            gc.display_name_fr,
            gc.display_name_fa,
            gsc.id,
            gsc.display_name_fr,
            gsc.display_name_fa,
            um.mastery_score,
            um.confidence,
            um.evidence_count,
            um.mastery_band,
            CASE
                WHEN lower(gl.title_fr_official) = lower(%s) THEN 0
                WHEN gl.title_fr_official ILIKE %s THEN 1
                ELSE 2
            END AS search_rank,
            count(*) OVER ()::int AS kind_total
        FROM grammar_lessons AS gl
        JOIN grammar_categories AS gc ON gc.id = gl.category_id
        JOIN grammar_categories AS gsc ON gsc.id = gl.subcategory_id
        LEFT JOIN LATERAL (
            SELECT mastery_score, confidence, evidence_count, mastery_band
            FROM user_mastery
            WHERE user_id = %s
              AND scope_type = 'LESSON'
              AND scope_id = gl.id
            ORDER BY updated_at DESC, mastery_model_version DESC
            LIMIT 1
        ) AS um ON TRUE
        WHERE gl.active = TRUE
          AND concat_ws(
                ' ', gl.lesson_no::text, gl.title_fr_official, gl.system_short_title,
                gc.code, gc.slug, gc.display_name_fr, gc.display_name_fa,
                gsc.code, gsc.slug, gsc.display_name_fr, gsc.display_name_fa
              ) ILIKE %s
        ORDER BY search_rank ASC, gl.lesson_no ASC, gl.id ASC
        LIMIT %s
        """,
        [query, prefix, user_id, contains, _PER_KIND_FETCH],
    )
    rows = cursor.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        (
            lesson_id,
            lesson_no,
            title_fr,
            short_title,
            category_id,
            category_fr,
            category_fa,
            subcategory_id,
            subcategory_fr,
            subcategory_fa,
            score,
            confidence,
            evidence_count,
            band,
            rank,
            kind_total,
        ) = row
        results.append(
            {
                "key": f"LESSON:{lesson_id}",
                "kind": "LESSON",
                "id": str(lesson_id),
                "rank": int(rank),
                "title_fr": str(title_fr),
                "title_fa": None,
                "code": f"L{int(lesson_no):02d}",
                "lesson_id": str(lesson_id),
                "lesson_no": int(lesson_no),
                "lesson_title_fr": str(title_fr),
                "subtopic_id": None,
                "subtopic_code": None,
                "category_id": str(category_id),
                "category_title_fr": str(category_fr),
                "category_title_fa": None if category_fa is None else str(category_fa),
                "subcategory_id": str(subcategory_id),
                "subcategory_title_fr": str(subcategory_fr),
                "subcategory_title_fa": None if subcategory_fa is None else str(subcategory_fa),
                "snippet_fa": None,
                "snippet_fr": str(short_title),
                "practice_lesson_ids": [str(lesson_id)],
                "mastery": _mastery(score, confidence, evidence_count, band),
                "common_misconception": None,
            }
        )
    total = int(rows[0][-1]) if rows else 0
    return results, total


def _subtopic_rows(cursor, *, user_id: uuid.UUID, query: str) -> tuple[list[dict[str, Any]], int]:
    contains = _like_pattern(query)
    prefix = _like_pattern(query, prefix=True)
    cursor.execute(
        """
        SELECT
            gs.id,
            gs.subtopic_code,
            gs.title_fr,
            gs.title_fa,
            gs.short_definition_fa,
            gs.teaching_note_fa,
            gl.id,
            gl.lesson_no,
            gl.title_fr_official,
            gc.id,
            gc.display_name_fr,
            gc.display_name_fa,
            gsc.id,
            gsc.display_name_fr,
            gsc.display_name_fa,
            um.mastery_score,
            um.confidence,
            um.evidence_count,
            um.mastery_band,
            CASE
                WHEN lower(gs.title_fr) = lower(%s) THEN 0
                WHEN gs.title_fr ILIKE %s THEN 1
                ELSE 2
            END AS search_rank,
            count(*) OVER ()::int AS kind_total
        FROM grammar_subtopics AS gs
        JOIN grammar_lessons AS gl ON gl.id = gs.lesson_id
        JOIN grammar_categories AS gc ON gc.id = gl.category_id
        JOIN grammar_categories AS gsc ON gsc.id = gl.subcategory_id
        LEFT JOIN LATERAL (
            SELECT mastery_score, confidence, evidence_count, mastery_band
            FROM user_mastery
            WHERE user_id = %s
              AND scope_type = 'SUBTOPIC'
              AND scope_id = gs.id
            ORDER BY updated_at DESC, mastery_model_version DESC
            LIMIT 1
        ) AS um ON TRUE
        WHERE gs.active = TRUE
          AND gl.active = TRUE
          AND concat_ws(
                ' ', gs.subtopic_code, gs.title_fr, gs.title_fa,
                gs.short_definition_fa, gs.teaching_note_fa,
                gl.title_fr_official, gc.display_name_fr, gc.display_name_fa,
                gsc.display_name_fr, gsc.display_name_fa
              ) ILIKE %s
        ORDER BY search_rank ASC, gl.lesson_no ASC, gs.subtopic_code ASC, gs.id ASC
        LIMIT %s
        """,
        [query, prefix, user_id, contains, _PER_KIND_FETCH],
    )
    rows = cursor.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        (
            subtopic_id,
            subtopic_code,
            title_fr,
            title_fa,
            short_definition_fa,
            teaching_note_fa,
            lesson_id,
            lesson_no,
            lesson_title_fr,
            category_id,
            category_fr,
            category_fa,
            subcategory_id,
            subcategory_fr,
            subcategory_fa,
            score,
            confidence,
            evidence_count,
            band,
            rank,
            _kind_total,
        ) = row
        results.append(
            {
                "key": f"SUBTOPIC:{subtopic_id}",
                "kind": "SUBTOPIC",
                "id": str(subtopic_id),
                "rank": int(rank),
                "title_fr": str(title_fr),
                "title_fa": None if title_fa is None else str(title_fa),
                "code": str(subtopic_code),
                "lesson_id": str(lesson_id),
                "lesson_no": int(lesson_no),
                "lesson_title_fr": str(lesson_title_fr),
                "subtopic_id": str(subtopic_id),
                "subtopic_code": str(subtopic_code),
                "category_id": str(category_id),
                "category_title_fr": str(category_fr),
                "category_title_fa": None if category_fa is None else str(category_fa),
                "subcategory_id": str(subcategory_id),
                "subcategory_title_fr": str(subcategory_fr),
                "subcategory_title_fa": None if subcategory_fa is None else str(subcategory_fa),
                "snippet_fa": (
                    str(short_definition_fa)
                    if short_definition_fa
                    else (str(teaching_note_fa) if teaching_note_fa else None)
                ),
                "snippet_fr": None,
                "practice_lesson_ids": [str(lesson_id)],
                "mastery": _mastery(score, confidence, evidence_count, band),
                "common_misconception": None,
            }
        )
    total = int(rows[0][-1]) if rows else 0
    return results, total


def _rule_rows(cursor, *, user_id: uuid.UUID, query: str) -> tuple[list[dict[str, Any]], int]:
    """Project canonical subtopic rule text into the learner search index."""
    contains = _like_pattern(query)
    cursor.execute(
        """
        SELECT
            gs.id,
            gs.subtopic_code,
            gs.title_fr,
            gs.title_fa,
            gs.short_definition_fa,
            gs.teaching_note_fa,
            gs.exceptions_register_note,
            gl.id,
            gl.lesson_no,
            gl.title_fr_official,
            gc.id,
            gc.display_name_fr,
            gc.display_name_fa,
            gsc.id,
            gsc.display_name_fr,
            gsc.display_name_fa,
            um.mastery_score,
            um.confidence,
            um.evidence_count,
            um.mastery_band,
            CASE
                WHEN lower(COALESCE(gs.short_definition_fa, '')) = lower(%s) THEN 0
                WHEN gs.title_fr ILIKE %s THEN 1
                ELSE 2
            END AS search_rank,
            count(*) OVER ()::int AS kind_total
        FROM grammar_subtopics AS gs
        JOIN grammar_lessons AS gl ON gl.id = gs.lesson_id
        JOIN grammar_categories AS gc ON gc.id = gl.category_id
        JOIN grammar_categories AS gsc ON gsc.id = gl.subcategory_id
        LEFT JOIN LATERAL (
            SELECT mastery_score, confidence, evidence_count, mastery_band
            FROM user_mastery
            WHERE user_id = %s
              AND scope_type = 'SUBTOPIC'
              AND scope_id = gs.id
            ORDER BY updated_at DESC, mastery_model_version DESC
            LIMIT 1
        ) AS um ON TRUE
        WHERE gs.active = TRUE
          AND gl.active = TRUE
          AND (
                NULLIF(btrim(gs.short_definition_fa), '') IS NOT NULL
                OR NULLIF(btrim(gs.teaching_note_fa), '') IS NOT NULL
                OR NULLIF(btrim(gs.exceptions_register_note), '') IS NOT NULL
              )
          AND concat_ws(
                ' ', gs.title_fr, gs.title_fa, gs.short_definition_fa,
                gs.teaching_note_fa, gs.exceptions_register_note
              ) ILIKE %s
        ORDER BY search_rank ASC, gl.lesson_no ASC, gs.subtopic_code ASC, gs.id ASC
        LIMIT %s
        """,
        [query, contains, user_id, contains, _PER_KIND_FETCH],
    )
    rows = cursor.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        (
            subtopic_id,
            subtopic_code,
            title_fr,
            title_fa,
            short_definition_fa,
            teaching_note_fa,
            exceptions_note,
            lesson_id,
            lesson_no,
            lesson_title_fr,
            category_id,
            category_fr,
            category_fa,
            subcategory_id,
            subcategory_fr,
            subcategory_fa,
            score,
            confidence,
            evidence_count,
            band,
            rank,
            _kind_total,
        ) = row
        rule_text = short_definition_fa or teaching_note_fa or exceptions_note
        results.append(
            {
                "key": f"RULE:{subtopic_id}",
                "kind": "RULE",
                "id": str(subtopic_id),
                "rank": int(rank),
                "title_fr": str(title_fr),
                "title_fa": None if title_fa is None else str(title_fa),
                "code": f"RULE:{subtopic_code}",
                "lesson_id": str(lesson_id),
                "lesson_no": int(lesson_no),
                "lesson_title_fr": str(lesson_title_fr),
                "subtopic_id": str(subtopic_id),
                "subtopic_code": str(subtopic_code),
                "category_id": str(category_id),
                "category_title_fr": str(category_fr),
                "category_title_fa": None if category_fa is None else str(category_fa),
                "subcategory_id": str(subcategory_id),
                "subcategory_title_fr": str(subcategory_fr),
                "subcategory_title_fa": None if subcategory_fa is None else str(subcategory_fa),
                "snippet_fa": None if rule_text is None else str(rule_text),
                "snippet_fr": None,
                "practice_lesson_ids": [str(lesson_id)],
                "mastery": _mastery(score, confidence, evidence_count, band),
                "common_misconception": None,
                "projection": "CANONICAL_SUBTOPIC_RULE_TEXT",
            }
        )
    total = int(rows[0][-1]) if rows else 0
    return results, total


def _category_rows(cursor, *, user_id: uuid.UUID, query: str) -> tuple[list[dict[str, Any]], int]:
    contains = _like_pattern(query)
    prefix = _like_pattern(query, prefix=True)
    cursor.execute(
        """
        SELECT
            gc.id,
            gc.code,
            gc.slug,
            gc.display_name_fr,
            gc.display_name_fa,
            gc.membership_rule_fa,
            ARRAY(
                SELECT gl.id::text
                FROM grammar_lessons AS gl
                WHERE gl.category_id = gc.id
                  AND gl.active = TRUE
                ORDER BY gl.lesson_no ASC, gl.id ASC
            ) AS lesson_ids,
            um.mastery_score,
            um.confidence,
            um.evidence_count,
            um.mastery_band,
            CASE
                WHEN lower(gc.display_name_fr) = lower(%s)
                  OR lower(COALESCE(gc.display_name_fa, '')) = lower(%s) THEN 0
                WHEN gc.display_name_fr ILIKE %s
                  OR COALESCE(gc.display_name_fa, '') ILIKE %s THEN 1
                ELSE 2
            END AS search_rank,
            count(*) OVER ()::int AS kind_total
        FROM grammar_categories AS gc
        LEFT JOIN LATERAL (
            SELECT mastery_score, confidence, evidence_count, mastery_band
            FROM user_mastery
            WHERE user_id = %s
              AND scope_type = 'CATEGORY'
              AND scope_id = gc.id
            ORDER BY updated_at DESC, mastery_model_version DESC
            LIMIT 1
        ) AS um ON TRUE
        WHERE gc.node_kind = 'CATEGORY'
          AND gc.status = 'ACTIVE'
          AND concat_ws(
                ' ', gc.code, gc.slug, gc.display_name_fr,
                gc.display_name_fa, gc.membership_rule_fa
              ) ILIKE %s
        ORDER BY search_rank ASC, gc.display_order ASC, gc.code ASC, gc.id ASC
        LIMIT %s
        """,
        [query, query, prefix, prefix, user_id, contains, _PER_KIND_FETCH],
    )
    rows = cursor.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        (
            category_id,
            code,
            slug,
            title_fr,
            title_fa,
            membership_rule_fa,
            lesson_ids,
            score,
            confidence,
            evidence_count,
            band,
            rank,
            _kind_total,
        ) = row
        results.append(
            {
                "key": f"CATEGORY:{category_id}",
                "kind": "CATEGORY",
                "id": str(category_id),
                "rank": int(rank),
                "title_fr": str(title_fr),
                "title_fa": None if title_fa is None else str(title_fa),
                "code": str(code),
                "slug": str(slug),
                "lesson_id": None,
                "lesson_no": None,
                "lesson_title_fr": None,
                "subtopic_id": None,
                "subtopic_code": None,
                "category_id": str(category_id),
                "category_title_fr": str(title_fr),
                "category_title_fa": None if title_fa is None else str(title_fa),
                "subcategory_id": None,
                "subcategory_title_fr": None,
                "subcategory_title_fa": None,
                "snippet_fa": None if membership_rule_fa is None else str(membership_rule_fa),
                "snippet_fr": None,
                "practice_lesson_ids": [str(value) for value in (lesson_ids or [])],
                "mastery": _mastery(score, confidence, evidence_count, band),
                "common_misconception": None,
            }
        )
    total = int(rows[0][-1]) if rows else 0
    return results, total


def _top_misconceptions(
    cursor,
    *,
    user_id: uuid.UUID,
    subtopic_ids: list[str],
    lesson_ids: list[str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_subtopic: dict[str, dict[str, Any]] = {}
    by_lesson: dict[str, dict[str, Any]] = {}

    if subtopic_ids:
        cursor.execute(
            """
            WITH grouped AS (
                SELECT
                    eri.subtopic_id,
                    m.id,
                    m.name_fa,
                    m.statement_fa,
                    count(*)::int AS repeat_count,
                    max(eri.wrong_at) AS last_wrong_at
                FROM error_review_items AS eri
                JOIN misconceptions AS m ON m.id = eri.misconception_id
                WHERE eri.user_id = %s
                  AND eri.resolution_status = 'UNRESOLVED'
                  AND eri.subtopic_id = ANY(%s::uuid[])
                  AND eri.misconception_id IS NOT NULL
                GROUP BY eri.subtopic_id, m.id, m.name_fa, m.statement_fa
            ), ranked AS (
                SELECT *, row_number() OVER (
                    PARTITION BY subtopic_id
                    ORDER BY repeat_count DESC, last_wrong_at DESC, id ASC
                ) AS rn
                FROM grouped
            )
            SELECT subtopic_id, id, name_fa, statement_fa, repeat_count
            FROM ranked
            WHERE rn = 1
            """,
            [user_id, subtopic_ids],
        )
        for subtopic_id, misconception_id, name_fa, statement_fa, repeat_count in cursor.fetchall():
            by_subtopic[str(subtopic_id)] = {
                "id": str(misconception_id),
                "name_fa": None if name_fa is None else str(name_fa),
                "statement_fa": str(statement_fa),
                "repeat_count": int(repeat_count or 0),
            }

    if lesson_ids:
        cursor.execute(
            """
            WITH grouped AS (
                SELECT
                    eri.lesson_id,
                    m.id,
                    m.name_fa,
                    m.statement_fa,
                    count(*)::int AS repeat_count,
                    max(eri.wrong_at) AS last_wrong_at
                FROM error_review_items AS eri
                JOIN misconceptions AS m ON m.id = eri.misconception_id
                WHERE eri.user_id = %s
                  AND eri.resolution_status = 'UNRESOLVED'
                  AND eri.lesson_id = ANY(%s::uuid[])
                  AND eri.misconception_id IS NOT NULL
                GROUP BY eri.lesson_id, m.id, m.name_fa, m.statement_fa
            ), ranked AS (
                SELECT *, row_number() OVER (
                    PARTITION BY lesson_id
                    ORDER BY repeat_count DESC, last_wrong_at DESC, id ASC
                ) AS rn
                FROM grouped
            )
            SELECT lesson_id, id, name_fa, statement_fa, repeat_count
            FROM ranked
            WHERE rn = 1
            """,
            [user_id, lesson_ids],
        )
        for lesson_id, misconception_id, name_fa, statement_fa, repeat_count in cursor.fetchall():
            by_lesson[str(lesson_id)] = {
                "id": str(misconception_id),
                "name_fa": None if name_fa is None else str(name_fa),
                "statement_fa": str(statement_fa),
                "repeat_count": int(repeat_count or 0),
            }

    return by_subtopic, by_lesson


def _result_sort_key(result: dict[str, Any]) -> tuple[int, int, int, str]:
    lesson_no = int(result.get("lesson_no") or 999)
    return (
        int(result.get("rank", 99)),
        _KIND_ORDER.get(str(result.get("kind")), 99),
        lesson_no,
        str(result.get("title_fr") or result.get("title_fa") or "").casefold(),
    )


def grammar_search_request(request) -> Response:
    principal = _principal(request)
    user_id = _user_uuid(principal)
    query = _normalize_search_query(request.query_params.get("q"))
    kind = _normalize_kind(request.query_params.get("kind"))
    locale = _normalize_locale(request.query_params.get("locale"))
    limit = _normalize_limit(request.query_params.get("limit"))

    if not query:
        body = {
            "data": {
                "query": "",
                "kind": kind,
                "locale": locale,
                "total_count": 0,
                "counts": {name: 0 for name in SEARCH_KINDS if name != "ALL"},
                "results": [],
                "as_of": timezone.now().isoformat(),
                "runtime_version": SEARCH_RUNTIME_VERSION,
            },
            "meta": _meta(request),
        }
        return Response(body, status=200)

    results: list[dict[str, Any]] = []
    counts = {name: 0 for name in SEARCH_KINDS if name != "ALL"}

    with connection.cursor() as cursor:
        if kind in {"ALL", "LESSON"}:
            items, count = _lesson_rows(cursor, user_id=user_id, query=query)
            results.extend(items)
            counts["LESSON"] = count
        if kind in {"ALL", "SUBTOPIC"}:
            items, count = _subtopic_rows(cursor, user_id=user_id, query=query)
            results.extend(items)
            counts["SUBTOPIC"] = count
        if kind in {"ALL", "RULE"}:
            items, count = _rule_rows(cursor, user_id=user_id, query=query)
            results.extend(items)
            counts["RULE"] = count
        if kind in {"ALL", "CATEGORY"}:
            items, count = _category_rows(cursor, user_id=user_id, query=query)
            results.extend(items)
            counts["CATEGORY"] = count

        results.sort(key=_result_sort_key)
        selected = results[:limit]
        subtopic_ids = sorted(
            {str(item["subtopic_id"]) for item in selected if item.get("subtopic_id")}
        )
        lesson_ids = sorted(
            {str(item["lesson_id"]) for item in selected if item.get("lesson_id")}
        )
        misconception_by_subtopic, misconception_by_lesson = _top_misconceptions(
            cursor,
            user_id=user_id,
            subtopic_ids=subtopic_ids,
            lesson_ids=lesson_ids,
        )

    for item in selected:
        subtopic_id = item.get("subtopic_id")
        lesson_id = item.get("lesson_id")
        item["common_misconception"] = (
            misconception_by_subtopic.get(str(subtopic_id))
            if subtopic_id
            else misconception_by_lesson.get(str(lesson_id)) if lesson_id else None
        )
        item.pop("rank", None)

    total_count = counts.get(kind, 0) if kind != "ALL" else sum(counts.values())
    body = {
        "data": {
            "query": query,
            "kind": kind,
            "locale": locale,
            "total_count": int(total_count),
            "counts": counts,
            "results": selected,
            "as_of": timezone.now().isoformat(),
            "runtime_version": SEARCH_RUNTIME_VERSION,
        },
        "meta": _meta(request),
    }
    return Response(body, status=200)
