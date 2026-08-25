from __future__ import annotations

"""Read-only provider for the Stage 19 Grammar Mastery Map surface.

The provider keeps Stage 15 mastery semantics authoritative:
- SUBTOPIC / LESSON / CATEGORY are canonical mastery scopes.
- SUBCATEGORY and OVERALL values are display-only aggregates derived with the
  canonical Stage 15 aggregation helper; they are never persisted as parallel
  mastery state.
- Confidence, coverage, evidence count and the canonical mastery band remain
  visible so the UI never reduces mastery to a simple correct/total ratio.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Mapping, Sequence
import uuid

from django.db import connection
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter.middleware import create_request_id
from backend.errors import APIError
from backend.security import Principal
from mastery.engine import DEFAULT_CONFIG as MASTERY_CONFIG, aggregate_mastery, compute_subtopic_mastery


MASTERY_MAP_RUNTIME_VERSION = "mastery-map-runtime-v1.0.0"
CANONICAL_BANDS = ("NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG")
CANONICAL_SCOPES = ("SUBTOPIC", "LESSON", "CATEGORY")


def _meta(request) -> dict[str, str]:
    return {
        "request_id": create_request_id(getattr(request, "request_id", None)),
        "api_version": "v1",
        "runtime_version": MASTERY_MAP_RUNTIME_VERSION,
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


def _float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _parse_locale(request) -> str:
    value = str(request.query_params.get("locale", "fa") or "fa").strip().lower()
    if value not in {"fa", "en"}:
        raise APIError(
            400,
            "QUERY_PARAMETER_INVALID",
            "The locale query parameter is invalid.",
            {"locale": ["Use fa or en."]},
        )
    return value


def _empty_mastery(as_of: datetime) -> dict[str, Any]:
    return compute_subtopic_mastery([], as_of, MASTERY_CONFIG)


def _normalize_stored(row: Sequence[Any] | None, as_of: datetime) -> dict[str, Any]:
    if row is None:
        return _empty_mastery(as_of)

    (
        mastery_score,
        confidence,
        evidence_count,
        model_version,
        evidence_score,
        effective_evidence,
        stability,
        coverage_ratio,
        mastery_band,
    ) = row
    evidence_count_value = int(evidence_count or 0)
    confidence_value = _float(confidence)
    score_value = _float(mastery_score, 50.0)
    evidence_score_value = _float(evidence_score, score_value)
    coverage_value = _float(coverage_ratio, 1.0 if evidence_count_value else 0.0)
    band = str(mastery_band or ("NO_EVIDENCE" if evidence_count_value == 0 else "UNCERTAIN"))
    if band not in CANONICAL_BANDS:
        band = "NO_EVIDENCE" if evidence_count_value == 0 else "UNCERTAIN"

    return {
        "evidence_score_pct": evidence_score_value,
        "mastery_score_pct": score_value,
        "confidence": confidence_value,
        "evidence_count": evidence_count_value,
        "effective_evidence": _float(effective_evidence, float(evidence_count_value)),
        "stability": _float(stability, 0.5),
        "coverage_ratio": max(0.0, min(1.0, coverage_value)),
        "mastery_band": band,
        "model_version": str(model_version or MASTERY_CONFIG["model_version"]),
    }


def _public_mastery(
    value: Mapping[str, Any],
    *,
    source: str,
    canonical_scope: bool,
    derived_for_ui: bool = False,
) -> dict[str, Any]:
    band = str(value.get("mastery_band", "NO_EVIDENCE"))
    if band not in CANONICAL_BANDS:
        band = "NO_EVIDENCE" if int(value.get("evidence_count", 0) or 0) == 0 else "UNCERTAIN"
    return {
        "mastery_score_pct": round(_float(value.get("mastery_score_pct"), 50.0), 3),
        "confidence": round(max(0.0, min(1.0, _float(value.get("confidence")))), 6),
        "coverage_ratio": round(max(0.0, min(1.0, _float(value.get("coverage_ratio")))), 6),
        "evidence_count": int(value.get("evidence_count", 0) or 0),
        "mastery_band": band,
        "model_version": str(value.get("model_version", MASTERY_CONFIG["model_version"])),
        "source": source,
        "canonical_scope": bool(canonical_scope),
        "derived_for_ui": bool(derived_for_ui),
    }


def _aggregate(
    children: Sequence[Mapping[str, Any]],
    weights: Sequence[float] | None,
) -> dict[str, Any]:
    if not children:
        return _empty_mastery(timezone.now())
    normalized_weights = None
    if weights is not None:
        values = [max(0.0, float(value)) for value in weights]
        if any(value > 0 for value in values):
            normalized_weights = values
    return aggregate_mastery(list(children), weights=normalized_weights, config=MASTERY_CONFIG)


def _title(locale: str, title_fr: str, title_fa: str | None) -> str:
    if locale == "fa" and title_fa:
        return str(title_fa)
    return str(title_fr)


def _load_latest_mastery(cursor, user_id: uuid.UUID, as_of: datetime) -> dict[tuple[str, str], dict[str, Any]]:
    cursor.execute(
        """
        SELECT DISTINCT ON (scope_type, scope_id)
            scope_type,
            scope_id,
            mastery_score,
            confidence,
            evidence_count,
            mastery_model_version,
            evidence_score,
            effective_evidence,
            stability,
            coverage_ratio,
            mastery_band
        FROM user_mastery
        WHERE user_id = %s
          AND scope_type IN ('SUBTOPIC', 'LESSON', 'CATEGORY')
        ORDER BY scope_type, scope_id, updated_at DESC, mastery_model_version DESC
        """,
        [user_id],
    )
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for row in cursor.fetchall():
        scope_type = str(row[0])
        scope_id = str(row[1])
        result[(scope_type, scope_id)] = _normalize_stored(row[2:], as_of)
    return result


def _load_taxonomy(cursor) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    cursor.execute(
        """
        SELECT id, code, slug, display_name_fr, display_name_fa, display_order
        FROM grammar_categories
        WHERE node_kind = 'CATEGORY'
          AND status = 'ACTIVE'
        ORDER BY display_order, code, id
        """
    )
    categories = [
        {
            "id": str(row[0]),
            "code": str(row[1]),
            "slug": str(row[2]),
            "title_fr": str(row[3]),
            "title_fa": row[4],
            "display_order": int(row[5] or 0),
        }
        for row in cursor.fetchall()
    ]

    cursor.execute(
        """
        SELECT id, code, slug, parent_id, display_name_fr, display_name_fa, display_order
        FROM grammar_categories
        WHERE node_kind = 'SUBCATEGORY'
          AND status = 'ACTIVE'
        ORDER BY parent_id, display_order, code, id
        """
    )
    subcategories = [
        {
            "id": str(row[0]),
            "code": str(row[1]),
            "slug": str(row[2]),
            "category_id": str(row[3]),
            "title_fr": str(row[4]),
            "title_fa": row[5],
            "display_order": int(row[6] or 0),
        }
        for row in cursor.fetchall()
    ]

    cursor.execute(
        """
        SELECT id, lesson_no, title_fr_official, system_short_title,
               category_id, subcategory_id, tcf_weight
        FROM grammar_lessons
        WHERE active = TRUE
        ORDER BY lesson_no, id
        """
    )
    lessons = [
        {
            "id": str(row[0]),
            "lesson_no": int(row[1]),
            "title_fr": str(row[2]),
            "short_title": str(row[3]),
            "category_id": str(row[4]),
            "subcategory_id": str(row[5]),
            "tcf_weight": _float(row[6]),
        }
        for row in cursor.fetchall()
    ]

    cursor.execute(
        """
        SELECT id, lesson_id, subtopic_code, title_fr, title_fa, short_definition_fa
        FROM grammar_subtopics
        WHERE active = TRUE
        ORDER BY lesson_id, subtopic_code, id
        """
    )
    subtopics = [
        {
            "id": str(row[0]),
            "lesson_id": str(row[1]),
            "code": str(row[2]),
            "title_fr": str(row[3]),
            "title_fa": row[4],
            "short_definition_fa": row[5],
        }
        for row in cursor.fetchall()
    ]
    return categories, subcategories, lessons, subtopics


def _load_misconceptions(cursor, user_id: uuid.UUID) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    cursor.execute(
        """
        SELECT lesson_id, count(*)::int
        FROM error_review_items
        WHERE user_id = %s
          AND resolution_status = 'UNRESOLVED'
        GROUP BY lesson_id
        """,
        [user_id],
    )
    unresolved_counts = {str(row[0]): int(row[1] or 0) for row in cursor.fetchall()}

    cursor.execute(
        """
        WITH grouped AS (
            SELECT
                eri.lesson_id,
                eri.misconception_id,
                eri.subtopic_id,
                count(*)::int AS repeat_count,
                max(eri.wrong_at) AS last_wrong_at
            FROM error_review_items AS eri
            WHERE eri.user_id = %s
              AND eri.resolution_status = 'UNRESOLVED'
              AND eri.misconception_id IS NOT NULL
            GROUP BY eri.lesson_id, eri.misconception_id, eri.subtopic_id
        ), ranked AS (
            SELECT
                grouped.*,
                row_number() OVER (
                    PARTITION BY grouped.lesson_id
                    ORDER BY grouped.repeat_count DESC,
                             grouped.last_wrong_at DESC,
                             grouped.misconception_id
                ) AS rank_no
            FROM grouped
        )
        SELECT
            ranked.lesson_id,
            m.id,
            m.family,
            m.name_fa,
            m.statement_fa,
            m.diagnostic_interpretation_fa,
            gs.id,
            gs.title_fr,
            gs.title_fa,
            ranked.repeat_count,
            ranked.last_wrong_at
        FROM ranked
        JOIN misconceptions AS m ON m.id = ranked.misconception_id
        JOIN grammar_subtopics AS gs ON gs.id = ranked.subtopic_id
        WHERE ranked.rank_no = 1
        ORDER BY ranked.lesson_id
        """,
        [user_id],
    )
    top: dict[str, dict[str, Any]] = {}
    for row in cursor.fetchall():
        top[str(row[0])] = {
            "id": str(row[1]),
            "family": str(row[2]),
            "name_fa": row[3],
            "statement_fa": str(row[4]),
            "diagnostic_interpretation_fa": row[5],
            "subtopic_id": str(row[6]),
            "subtopic_title_fr": str(row[7]),
            "subtopic_title_fa": row[8],
            "repeat_count": int(row[9] or 0),
            "last_wrong_at": None if row[10] is None else row[10].isoformat(),
        }
    return top, unresolved_counts


def mastery_map_request(request) -> Response:
    principal = _principal(request)
    user_id = _user_uuid(principal)
    locale = _parse_locale(request)
    as_of = timezone.now()

    with connection.cursor() as cursor:
        latest = _load_latest_mastery(cursor, user_id, as_of)
        categories, subcategories, lessons, subtopics = _load_taxonomy(cursor)
        top_misconceptions, unresolved_counts = _load_misconceptions(cursor, user_id)

    subtopics_by_lesson: dict[str, list[dict[str, Any]]] = {}
    for subtopic in subtopics:
        subtopics_by_lesson.setdefault(subtopic["lesson_id"], []).append(subtopic)

    lessons_by_subcategory: dict[str, list[dict[str, Any]]] = {}
    private_lesson_mastery: dict[str, dict[str, Any]] = {}

    for lesson in lessons:
        public_subtopics: list[dict[str, Any]] = []
        private_subtopics: list[dict[str, Any]] = []
        for subtopic in subtopics_by_lesson.get(lesson["id"], []):
            private = latest.get(("SUBTOPIC", subtopic["id"]), _empty_mastery(as_of))
            private_subtopics.append(private)
            public_subtopics.append(
                {
                    **subtopic,
                    "display_title": _title(locale, subtopic["title_fr"], subtopic["title_fa"]),
                    "mastery": _public_mastery(
                        private,
                        source="PERSISTED_SUBTOPIC" if ("SUBTOPIC", subtopic["id"]) in latest else "NO_EVIDENCE",
                        canonical_scope=True,
                    ),
                }
            )

        persisted_lesson = latest.get(("LESSON", lesson["id"]))
        if persisted_lesson is not None:
            lesson_private = persisted_lesson
            lesson_source = "PERSISTED_LESSON"
        else:
            lesson_private = _aggregate(private_subtopics, None) if private_subtopics else _empty_mastery(as_of)
            lesson_source = "AGGREGATED_SUBTOPICS_FALLBACK" if private_subtopics else "NO_EVIDENCE"
        private_lesson_mastery[lesson["id"]] = lesson_private

        public_lesson = {
            **lesson,
            "display_title": lesson["title_fr"],
            "mastery": _public_mastery(
                lesson_private,
                source=lesson_source,
                canonical_scope=True,
            ),
            "subtopics": public_subtopics,
            "top_misconception": top_misconceptions.get(lesson["id"]),
            "unresolved_review_count": unresolved_counts.get(lesson["id"], 0),
        }
        lessons_by_subcategory.setdefault(lesson["subcategory_id"], []).append(public_lesson)

    subcategories_by_category: dict[str, list[dict[str, Any]]] = {}
    private_subcategory_mastery: dict[str, dict[str, Any]] = {}
    for subcategory in subcategories:
        child_lessons = lessons_by_subcategory.get(subcategory["id"], [])
        child_private = [private_lesson_mastery[item["id"]] for item in child_lessons]
        weights = [float(item["tcf_weight"]) for item in child_lessons]
        subcategory_private = _aggregate(child_private, weights) if child_private else _empty_mastery(as_of)
        private_subcategory_mastery[subcategory["id"]] = subcategory_private
        public_subcategory = {
            **subcategory,
            "display_title": _title(locale, subcategory["title_fr"], subcategory["title_fa"]),
            "mastery": _public_mastery(
                subcategory_private,
                source="DERIVED_SUBCATEGORY_FOR_UI",
                canonical_scope=False,
                derived_for_ui=True,
            ),
            "lessons": child_lessons,
        }
        subcategories_by_category.setdefault(subcategory["category_id"], []).append(public_subcategory)

    public_categories: list[dict[str, Any]] = []
    private_categories: list[dict[str, Any]] = []
    category_weights: list[float] = []
    band_counts = {band: 0 for band in CANONICAL_BANDS}

    for category in categories:
        child_subcategories = subcategories_by_category.get(category["id"], [])
        category_lessons = [
            lesson
            for subcategory in child_subcategories
            for lesson in subcategory["lessons"]
        ]
        category_private_children = [private_lesson_mastery[item["id"]] for item in category_lessons]
        lesson_weights = [float(item["tcf_weight"]) for item in category_lessons]
        persisted_category = latest.get(("CATEGORY", category["id"]))
        if persisted_category is not None:
            category_private = persisted_category
            category_source = "PERSISTED_CATEGORY"
        else:
            category_private = _aggregate(category_private_children, lesson_weights) if category_private_children else _empty_mastery(as_of)
            category_source = "AGGREGATED_LESSONS_FALLBACK" if category_private_children else "NO_EVIDENCE"

        private_categories.append(category_private)
        category_weight = sum(max(0.0, value) for value in lesson_weights)
        category_weights.append(category_weight)
        public_mastery = _public_mastery(
            category_private,
            source=category_source,
            canonical_scope=True,
        )
        band_counts[public_mastery["mastery_band"]] += 1
        public_categories.append(
            {
                **category,
                "display_title": _title(locale, category["title_fr"], category["title_fa"]),
                "tcf_weight": round(category_weight, 4),
                "mastery": public_mastery,
                "subcategories": child_subcategories,
            }
        )

    overall_private = _aggregate(private_categories, category_weights) if private_categories else _empty_mastery(as_of)
    overall_public = _public_mastery(
        overall_private,
        source="DERIVED_OVERALL_FOR_UI",
        canonical_scope=False,
        derived_for_ui=True,
    )
    overall_has_evidence = overall_public["evidence_count"] > 0

    body = {
        "data": {
            "summary": {
                "overall_mastery_pct": overall_public["mastery_score_pct"] if overall_has_evidence else None,
                "coverage_pct": round(overall_public["coverage_ratio"] * 100, 1),
                "category_count": len(categories),
                "subcategory_count": len(subcategories),
                "lesson_count": len(lessons),
                "subtopic_count": len(subtopics),
                "band_counts": band_counts,
                "mastery": overall_public,
            },
            "semantics": {
                "canonical_scopes": list(CANONICAL_SCOPES),
                "display_only_scopes": ["SUBCATEGORY", "OVERALL"],
                "bands": list(CANONICAL_BANDS),
                "confidence_gate": MASTERY_CONFIG["thresholds"]["min_confidence_for_label"],
                "weak_below": MASTERY_CONFIG["thresholds"]["weak_below"],
                "strong_at_or_above": MASTERY_CONFIG["thresholds"]["strong_at_or_above"],
                "mastery_model_version": MASTERY_CONFIG["model_version"],
            },
            "categories": public_categories,
        },
        "meta": _meta(request),
    }
    return Response(body, status=200)
