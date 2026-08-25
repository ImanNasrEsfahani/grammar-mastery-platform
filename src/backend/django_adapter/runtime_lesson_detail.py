from __future__ import annotations

"""Read-only learner insights used by the Lesson Detail surface.

This module deliberately derives every displayed learning metric from canonical
Stage 12-17 data. It does not create parallel mastery/review state and it does
not mutate PostgreSQL.
"""

from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from typing import Any, Mapping, Sequence

from mastery.engine import aggregate_mastery, compute_subtopic_mastery


def _float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt_timezone.utc)
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def _mastery_from_storage(row: Sequence[Any] | None, as_of: datetime) -> dict[str, Any]:
    """Normalize one latest user_mastery row to the Stage 15 aggregate shape."""
    if row is None:
        return compute_subtopic_mastery([], as_of)

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
    coverage_value = _float(coverage_ratio, 1.0 if evidence_count_value else 0.0)
    score_value = _float(mastery_score, 50.0)
    evidence_score_value = _float(evidence_score, score_value)
    band_value = str(mastery_band or ("NO_EVIDENCE" if evidence_count_value == 0 else "UNCERTAIN"))
    if band_value not in {"NO_EVIDENCE", "UNCERTAIN", "WEAK", "DEVELOPING", "STRONG"}:
        band_value = "UNCERTAIN" if evidence_count_value else "NO_EVIDENCE"

    return {
        "evidence_score_pct": evidence_score_value,
        "mastery_score_pct": score_value,
        "confidence": confidence_value,
        "evidence_count": evidence_count_value,
        "effective_evidence": _float(effective_evidence, float(evidence_count_value)),
        "stability": _float(stability, 0.5),
        "coverage_ratio": coverage_value,
        "mastery_band": band_value,
        "model_version": str(model_version),
    }


def _public_mastery(value: Mapping[str, Any], source: str) -> dict[str, Any]:
    return {
        "mastery_score_pct": round(_float(value.get("mastery_score_pct"), 50.0), 3),
        "confidence": round(_float(value.get("confidence")), 6),
        "coverage_ratio": round(_float(value.get("coverage_ratio")), 6),
        "evidence_count": int(value.get("evidence_count", 0) or 0),
        "mastery_band": str(value.get("mastery_band", "NO_EVIDENCE")),
        "model_version": str(value.get("model_version", "mastery-evidence-v0.9.0")),
        "source": source,
    }


def load_lesson_detail_enrichment(
    cursor,
    *,
    user_id,
    lesson_id,
    subtopics: Sequence[Mapping[str, Any]],
    as_of: datetime,
) -> dict[str, Any]:
    """Return book reference + lesson-scoped learning evidence for one learner."""

    cursor.execute(
        """
        SELECT book_pages, pdf_pages
        FROM grammar_lessons
        WHERE id = %s
          AND active = TRUE
        """,
        [lesson_id],
    )
    reference_row = cursor.fetchone()
    book_reference = {
        "book_pages": None if not reference_row else reference_row[0],
        "pdf_pages": None if not reference_row else reference_row[1],
    }

    subtopic_ids = [str(item["id"]) for item in subtopics]
    stored_by_id: dict[str, tuple[Any, ...]] = {}
    if subtopic_ids:
        cursor.execute(
            """
            SELECT DISTINCT ON (scope_id)
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
              AND scope_type = 'SUBTOPIC'
              AND scope_id = ANY(%s::uuid[])
            ORDER BY scope_id, updated_at DESC, mastery_model_version DESC
            """,
            [user_id, subtopic_ids],
        )
        for row in cursor.fetchall():
            stored_by_id[str(row[0])] = tuple(row[1:])

    cursor.execute(
        """
        SELECT
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
          AND scope_type = 'LESSON'
          AND scope_id = %s
        ORDER BY updated_at DESC, mastery_model_version DESC
        LIMIT 1
        """,
        [user_id, lesson_id],
    )
    stored_lesson_mastery = cursor.fetchone()

    question_counts: dict[str, int] = {}
    if subtopic_ids:
        cursor.execute(
            """
            SELECT q.primary_subtopic_id, count(*)::int
            FROM questions AS q
            WHERE q.lesson_id = %s
              AND q.primary_subtopic_id = ANY(%s::uuid[])
              AND q.status = 'PUBLISHED'
              AND q.retired_at IS NULL
              AND q.correct_option_id IS NOT NULL
              AND (SELECT count(*) FROM question_options AS qo WHERE qo.question_id = q.id) = 4
              AND NOT EXISTS (
                  SELECT 1
                  FROM questions AS newer
                  WHERE newer.question_uid = q.question_uid
                    AND newer.revision > q.revision
              )
            GROUP BY q.primary_subtopic_id
            """,
            [lesson_id, subtopic_ids],
        )
        question_counts = {str(row[0]): int(row[1] or 0) for row in cursor.fetchall()}

    cursor.execute(
        """
        SELECT subtopic_id, count(*)::int
        FROM error_review_items
        WHERE user_id = %s
          AND lesson_id = %s
          AND resolution_status = 'UNRESOLVED'
        GROUP BY subtopic_id
        """,
        [user_id, lesson_id],
    )
    mistake_counts = {str(row[0]): int(row[1] or 0) for row in cursor.fetchall()}

    private_children: list[dict[str, Any]] = []
    public_subtopics: list[dict[str, Any]] = []
    for item in subtopics:
        subtopic_id = str(item["id"])
        normalized = _mastery_from_storage(stored_by_id.get(subtopic_id), as_of)
        private_children.append(normalized)
        public_subtopics.append(
            {
                "id": subtopic_id,
                "question_count": question_counts.get(subtopic_id, 0),
                "mistake_count": mistake_counts.get(subtopic_id, 0),
                "mastery": _public_mastery(
                    normalized,
                    "PERSISTED_SUBTOPIC" if subtopic_id in stored_by_id else "NO_EVIDENCE",
                ),
            }
        )

    if stored_lesson_mastery is not None:
        overview_private = _mastery_from_storage(stored_lesson_mastery, as_of)
        overview_source = "PERSISTED_LESSON"
    else:
        overview_private = aggregate_mastery(private_children)
        overview_source = "AGGREGATED_SUBTOPICS"
    overview = _public_mastery(overview_private, overview_source)

    cursor.execute(
        """
        SELECT eri.id
        FROM error_review_items AS eri
        WHERE eri.user_id = %s
          AND eri.lesson_id = %s
          AND eri.resolution_status = 'UNRESOLVED'
          AND eri.reviewability = 'RETRY_ALLOWED'
        ORDER BY
            eri.marked_for_review DESC,
            (
                SELECT count(*)
                FROM error_review_items AS peer
                WHERE peer.user_id = eri.user_id
                  AND peer.group_key = eri.group_key
                  AND peer.resolution_status = 'UNRESOLVED'
            ) DESC,
            eri.wrong_at DESC,
            eri.id DESC
        LIMIT 1
        """,
        [user_id, lesson_id],
    )
    review_row = cursor.fetchone()
    review_item_id = None if review_row is None else str(review_row[0])

    cursor.execute(
        """
        SELECT
            m.id,
            m.family,
            m.name_fa,
            m.statement_fa,
            m.diagnostic_interpretation_fa,
            gs.id,
            gs.title_fr,
            gs.title_fa,
            count(*)::int AS repeat_count,
            max(eri.wrong_at) AS last_wrong_at
        FROM error_review_items AS eri
        JOIN misconceptions AS m ON m.id = eri.misconception_id
        JOIN grammar_subtopics AS gs ON gs.id = eri.subtopic_id
        WHERE eri.user_id = %s
          AND eri.lesson_id = %s
          AND eri.resolution_status = 'UNRESOLVED'
          AND eri.misconception_id IS NOT NULL
        GROUP BY
            m.id,
            m.family,
            m.name_fa,
            m.statement_fa,
            m.diagnostic_interpretation_fa,
            gs.id,
            gs.title_fr,
            gs.title_fa
        ORDER BY repeat_count DESC, last_wrong_at DESC, m.id
        LIMIT 5
        """,
        [user_id, lesson_id],
    )
    misconceptions = [
        {
            "id": str(row[0]),
            "family": str(row[1]),
            "name_fa": row[2],
            "statement_fa": str(row[3]),
            "diagnostic_interpretation_fa": row[4],
            "subtopic_id": str(row[5]),
            "subtopic_title_fr": str(row[6]),
            "subtopic_title_fa": row[7],
            "repeat_count": int(row[8] or 0),
            "last_wrong_at": _iso(row[9]),
        }
        for row in cursor.fetchall()
    ]

    cursor.execute(
        """
        WITH latest_answers AS (
            SELECT DISTINCT ON (ua.attempt_id, ua.test_question_id)
                ua.attempt_id,
                ua.test_question_id,
                ua.is_correct
            FROM user_answers AS ua
            JOIN test_attempts AS owned_attempt ON owned_attempt.id = ua.attempt_id
            WHERE owned_attempt.user_id = %s
            ORDER BY ua.attempt_id, ua.test_question_id, ua.answer_sequence DESC
        )
        SELECT
            ta.id,
            ta.test_id,
            t.mode::text,
            ta.started_at,
            ta.completed_at,
            count(DISTINCT tq.id)::int AS question_count,
            count(la.test_question_id)::int AS answered_count,
            count(*) FILTER (WHERE la.is_correct IS TRUE)::int AS correct_count
        FROM test_attempts AS ta
        JOIN tests AS t ON t.id = ta.test_id
        JOIN test_questions AS tq ON tq.test_id = ta.test_id
        JOIN questions AS q ON q.id = tq.question_id AND q.lesson_id = %s
        LEFT JOIN latest_answers AS la
          ON la.attempt_id = ta.id
         AND la.test_question_id = tq.id
        WHERE ta.user_id = %s
          AND ta.status = 'COMPLETED'
          AND ta.completed_at IS NOT NULL
        GROUP BY ta.id, ta.test_id, t.mode, ta.started_at, ta.completed_at
        ORDER BY ta.completed_at DESC, ta.id DESC
        LIMIT 5
        """,
        [user_id, lesson_id, user_id],
    )
    recent_activity: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        answered_count = int(row[6] or 0)
        correct_count = int(row[7] or 0)
        accuracy_pct = (
            None
            if answered_count <= 0
            else round(100.0 * correct_count / answered_count, 1)
        )
        duration_seconds = None
        if row[3] is not None and row[4] is not None:
            duration_seconds = max(0, int((row[4] - row[3]).total_seconds()))
        recent_activity.append(
            {
                "attempt_id": str(row[0]),
                "test_id": str(row[1]),
                "mode": str(row[2]),
                "question_count": int(row[5] or 0),
                "answered_count": answered_count,
                "correct_count": correct_count,
                "accuracy_pct": accuracy_pct,
                "duration_seconds": duration_seconds,
                "completed_at": _iso(row[4]),
            }
        )

    return {
        "book_reference": book_reference,
        "learning": {
            "overview": overview,
            "subtopics": public_subtopics,
            "unresolved_mistake_count": sum(mistake_counts.values()),
            "review_item_id": review_item_id,
            "misconceptions": misconceptions,
            "recent_activity": recent_activity,
        },
    }
