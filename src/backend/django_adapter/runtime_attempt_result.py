from __future__ import annotations

"""Attempt Result analytics provider.

This module enriches the completed-attempt response without changing scoring,
mastery, review, or test-selection state. It is read-only and uses the frozen
question snapshots plus the canonical Stage 15 mastery engine for attribution.
"""

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Iterable, Mapping
import uuid

from django.db import connection
from rest_framework.response import Response

from backend.django_adapter import runtime_learning
from backend.errors import APIError, not_found
from mastery.engine import compute_subtopic_mastery


ATTEMPT_RESULT_INSIGHTS_VERSION = "attempt-result-insights-v1.0.0"
DIFFICULTY_ORDER = ("EASY", "MEDIUM", "HARD", "VERY_HARD")
EPSILON = 1e-6

_principal = runtime_learning._principal
_uuid = runtime_learning._uuid
_meta = runtime_learning._meta
_json_object = runtime_learning._json_object
_float = runtime_learning._float
_iso = runtime_learning._iso
_answer_feedback = runtime_learning._answer_feedback


def _pct(correct: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(100.0 * int(correct) / int(total), 6)


def _duration_seconds(started_at: datetime, completed_at: datetime) -> int:
    return max(0, int(round((completed_at - started_at).total_seconds())))


def _selected_snapshot_option(
    snapshot: Mapping[str, Any],
    selected_option_id: str,
) -> Mapping[str, Any] | None:
    options = snapshot.get("options")
    if not isinstance(options, list):
        return None
    for option in options:
        if isinstance(option, Mapping) and str(option.get("id")) == str(selected_option_id):
            return option
    return None


def _analysis_rows(
    items: Iterable[Mapping[str, Any]],
    *,
    key_field: str,
    ordered_keys: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "correct": 0})
    for item in items:
        key = str(item.get(key_field) or "UNKNOWN")
        buckets[key]["total"] += 1
        if bool(item.get("is_correct")):
            buckets[key]["correct"] += 1

    if ordered_keys is None:
        keys = sorted(buckets)
    else:
        requested = [str(value) for value in ordered_keys]
        extras = sorted(set(buckets) - set(requested))
        keys = [*requested, *extras]

    rows = []
    for key in keys:
        total = buckets[key]["total"] if key in buckets else 0
        correct = buckets[key]["correct"] if key in buckets else 0
        rows.append(
            {
                "key": key,
                "total": total,
                "correct": correct,
                "incorrect": total - correct,
                "accuracy_pct": _pct(correct, total),
            }
        )
    return rows


def _mastery_impact_summary(subtopics: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    rows = list(subtopics)
    known_deltas = [
        float(row["mastery_delta_pct"])
        for row in rows
        if row.get("mastery_delta_pct") is not None
    ]
    improved = sum(delta > EPSILON for delta in known_deltas)
    declined = sum(delta < -EPSILON for delta in known_deltas)
    unchanged = sum(abs(delta) <= EPSILON for delta in known_deltas)
    return {
        "affected_subtopic_count": len(rows),
        "new_evidence_subtopic_count": sum(bool(row.get("new_evidence")) for row in rows),
        "improved_subtopic_count": improved,
        "declined_subtopic_count": declined,
        "unchanged_subtopic_count": unchanged,
        "average_delta_pct": (
            None
            if not known_deltas
            else round(sum(known_deltas) / len(known_deltas), 6)
        ),
    }


def _strengths_and_weaknesses(
    subtopics: Iterable[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = [dict(row) for row in subtopics]
    strengths = [
        row for row in rows
        if int(row.get("correct", 0)) > 0 and float(row.get("accuracy_pct") or 0.0) >= 80.0
    ]
    strengths.sort(
        key=lambda row: (
            -(float(row.get("accuracy_pct") or 0.0)),
            -int(row.get("total", 0)),
            str(row.get("subtopic_id", "")),
        )
    )
    weaknesses = [
        row for row in rows
        if int(row.get("incorrect", 0)) > 0 and float(row.get("accuracy_pct") or 0.0) < 80.0
    ]
    weaknesses.sort(
        key=lambda row: (
            float(row.get("accuracy_pct") or 0.0),
            -int(row.get("incorrect", 0)),
            -int(row.get("total", 0)),
            str(row.get("subtopic_id", "")),
        )
    )
    return strengths[:3], weaknesses[:3]


def _metadata_for_subtopics(cursor, subtopic_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = sorted({str(value) for value in subtopic_ids if value})
    if not ids:
        return {}
    placeholders = ",".join(["%s"] * len(ids))
    cursor.execute(
        f"""
        SELECT
            gs.id,
            gs.title_fr,
            gs.title_fa,
            gl.id,
            gl.lesson_no,
            gl.title_fr_official,
            gl.system_short_title
        FROM grammar_subtopics AS gs
        JOIN grammar_lessons AS gl ON gl.id = gs.lesson_id
        WHERE gs.id IN ({placeholders})
        """,
        [uuid.UUID(value) for value in ids],
    )
    return {
        str(row[0]): {
            "subtopic_id": str(row[0]),
            "subtopic_title_fr": str(row[1]),
            "subtopic_title_fa": None if row[2] is None else str(row[2]),
            "lesson_id": str(row[3]),
            "lesson_no": int(row[4]),
            "lesson_title_fr": str(row[5]),
            "lesson_short_title": str(row[6]),
        }
        for row in cursor.fetchall()
    }


def _misconception_metadata(cursor, misconception_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = sorted({str(value) for value in misconception_ids if value})
    if not ids:
        return {}
    placeholders = ",".join(["%s"] * len(ids))
    cursor.execute(
        f"""
        SELECT
            m.id,
            m.family,
            m.name_fa,
            m.statement_fa,
            m.subtopic_id,
            gs.title_fr,
            gs.title_fa
        FROM misconceptions AS m
        JOIN grammar_subtopics AS gs ON gs.id = m.subtopic_id
        WHERE m.id IN ({placeholders})
        """,
        [uuid.UUID(value) for value in ids],
    )
    return {
        str(row[0]): {
            "id": str(row[0]),
            "family": str(row[1]),
            "name_fa": None if row[2] is None else str(row[2]),
            "statement_fa": str(row[3]),
            "subtopic_id": str(row[4]),
            "subtopic_title_fr": str(row[5]),
            "subtopic_title_fa": None if row[6] is None else str(row[6]),
        }
        for row in cursor.fetchall()
    }


def _mastery_evidence(cursor, *, user_id: uuid.UUID, subtopic_ids: Iterable[str], completed_at: datetime) -> dict[str, list[dict[str, Any]]]:
    ids = sorted({str(value) for value in subtopic_ids if value})
    if not ids:
        return {}
    placeholders = ",".join(["%s"] * len(ids))
    cursor.execute(
        f"""
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
          AND tq.question_snapshot->>'subtopic_id' IN ({placeholders})
          AND ua.answered_at <= %s
        ORDER BY ua.answered_at, ua.id
        """,
        [user_id, *ids, completed_at],
    )
    evidence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cursor.fetchall():
        subtopic_id = str(row[0])
        evidence[subtopic_id].append(
            {
                "answer_id": str(row[1]),
                "attempt_id": str(row[2]),
                "test_question_id": str(row[3]),
                "answer_sequence": int(row[4]),
                "is_correct": row[5],
                "response_ms": row[6],
                "answered_at": row[7],
                "difficulty_code": str(row[8]),
                "misconception_id": None if row[9] is None else str(row[9]),
            }
        )
    return dict(evidence)


def attempt_result_request(request, attempt_id: Any) -> Response:
    principal = _principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_attempt_id = _uuid(attempt_id, "attemptId")
    meta = _meta(request)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
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
            WHERE ta.id = %s
              AND ta.user_id = %s
            """,
            [parsed_attempt_id, user_id],
        )
        attempt = cursor.fetchone()
        if attempt is None:
            raise not_found()

        (
            test_id,
            status,
            started_at,
            completed_at,
            score_raw,
            score_pct,
            mode,
            test_title,
        ) = attempt
        if status != "COMPLETED" or completed_at is None:
            raise APIError(409, "STATE_CONFLICT", "The result is available after completion.")

        cursor.execute(
            """
            SELECT
                tq.id,
                tq.position,
                tq.question_snapshot,
                ua.id,
                ua.selected_option_id,
                ua.is_correct,
                ua.response_ms,
                ua.answered_at
            FROM test_questions AS tq
            JOIN user_answers AS ua
              ON ua.test_question_id = tq.id
             AND ua.attempt_id = %s
            WHERE tq.test_id = %s
            ORDER BY tq.position
            """,
            [parsed_attempt_id, test_id],
        )
        answer_rows = cursor.fetchall()

        raw_items: list[dict[str, Any]] = []
        subtopic_ids: set[str] = set()
        for row in answer_rows:
            snapshot = _json_object(row[2])
            selected_option_id = str(row[4])
            selected_option = _selected_snapshot_option(snapshot, selected_option_id)
            selected_misconception_id = None
            if selected_option is not None and selected_option.get("misconception_id"):
                selected_misconception_id = str(selected_option["misconception_id"])
            subtopic_id = str(snapshot.get("subtopic_id") or "")
            if subtopic_id:
                subtopic_ids.add(subtopic_id)
            raw_items.append(
                {
                    "test_question_id": str(row[0]),
                    "position": int(row[1]),
                    "answer_id": str(row[3]),
                    "selected_option_id": selected_option_id,
                    "is_correct": bool(row[5]),
                    "response_ms": None if row[6] is None else int(row[6]),
                    "answered_at": row[7],
                    "snapshot": snapshot,
                    "subtopic_id": subtopic_id,
                    "lesson_id": str(snapshot.get("lesson_id") or ""),
                    "question_type": str(snapshot.get("question_type") or "UNKNOWN"),
                    "difficulty": str(snapshot.get("difficulty") or "UNKNOWN"),
                    "selected_misconception_id": selected_misconception_id,
                }
            )

        subtopic_meta = _metadata_for_subtopics(cursor, subtopic_ids)
        evidence_by_subtopic = _mastery_evidence(
            cursor,
            user_id=user_id,
            subtopic_ids=subtopic_ids,
            completed_at=completed_at,
        )

        wrong_misconception_ids = [
            str(item["selected_misconception_id"])
            for item in raw_items
            if not item["is_correct"] and item.get("selected_misconception_id")
        ]
        misconception_meta = _misconception_metadata(cursor, wrong_misconception_ids)

        cursor.execute(
            """
            SELECT eri.id
            FROM error_review_items AS eri
            JOIN user_answers AS ua ON ua.id = eri.source_answer_id
            WHERE eri.user_id = %s
              AND ua.attempt_id = %s
              AND eri.resolution_status = 'UNRESOLVED'
              AND eri.reviewability = 'RETRY_ALLOWED'
            ORDER BY eri.wrong_at ASC, eri.id ASC
            """,
            [user_id, parsed_attempt_id],
        )
        review_item_ids = [str(row[0]) for row in cursor.fetchall()]

    breakdown: list[dict[str, Any]] = []
    for item in raw_items:
        snapshot = item["snapshot"]
        metadata = subtopic_meta.get(item["subtopic_id"], {})
        breakdown.append(
            {
                "test_question_id": item["test_question_id"],
                "position": item["position"],
                "answer_id": item["answer_id"],
                "feedback": _answer_feedback(snapshot, item["selected_option_id"]),
                "lesson_id": metadata.get("lesson_id") or item["lesson_id"],
                "lesson_no": metadata.get("lesson_no"),
                "lesson_title_fr": metadata.get("lesson_title_fr"),
                "subtopic_id": item["subtopic_id"],
                "subtopic_title_fr": metadata.get("subtopic_title_fr"),
                "subtopic_title_fa": metadata.get("subtopic_title_fa"),
                "question_type": item["question_type"],
                "difficulty": item["difficulty"],
                "response_ms": item["response_ms"],
                "answered_at": _iso(item["answered_at"]),
                "stem": str(snapshot.get("stem") or ""),
                "stem_locale": str(snapshot.get("stem_locale") or "fr-FR"),
                "selected_misconception_id": item["selected_misconception_id"],
            }
        )

    by_subtopic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in raw_items:
        by_subtopic[item["subtopic_id"]].append(item)

    subtopic_analysis: list[dict[str, Any]] = []
    for subtopic_id, session_items in by_subtopic.items():
        metadata = subtopic_meta.get(subtopic_id, {})
        total = len(session_items)
        correct = sum(bool(item["is_correct"]) for item in session_items)
        evidence = evidence_by_subtopic.get(subtopic_id, [])
        prior_evidence = [
            row for row in evidence if str(row.get("attempt_id")) != str(parsed_attempt_id)
        ]
        before = compute_subtopic_mastery(prior_evidence, completed_at)
        after = compute_subtopic_mastery(evidence, completed_at)
        new_evidence = int(before.get("evidence_count", 0)) == 0
        before_score = None if new_evidence else _float(before["mastery_score_pct"])
        after_score = _float(after["mastery_score_pct"])
        delta = None if before_score is None else round(after_score - before_score, 6)
        subtopic_analysis.append(
            {
                "subtopic_id": subtopic_id,
                "subtopic_title_fr": metadata.get("subtopic_title_fr"),
                "subtopic_title_fa": metadata.get("subtopic_title_fa"),
                "lesson_id": metadata.get("lesson_id"),
                "lesson_no": metadata.get("lesson_no"),
                "lesson_title_fr": metadata.get("lesson_title_fr"),
                "total": total,
                "correct": correct,
                "incorrect": total - correct,
                "accuracy_pct": _pct(correct, total),
                "mastery_before_pct": before_score,
                "mastery_after_pct": after_score,
                "mastery_delta_pct": delta,
                "mastery_confidence_after": _float(after["confidence"]),
                "mastery_coverage_after": _float(after["coverage_ratio"]),
                "mastery_band_after": str(after["mastery_band"]),
                "new_evidence": new_evidence,
            }
        )
    subtopic_analysis.sort(
        key=lambda row: (
            row.get("lesson_no") if row.get("lesson_no") is not None else 999,
            str(row.get("subtopic_title_fr") or row["subtopic_id"]),
        )
    )

    strengths, weaknesses = _strengths_and_weaknesses(subtopic_analysis)

    difficulty_analysis = [
        {"difficulty": row.pop("key"), **row}
        for row in _analysis_rows(raw_items, key_field="difficulty", ordered_keys=DIFFICULTY_ORDER)
    ]
    question_type_analysis = [
        {"question_type": row.pop("key"), **row}
        for row in _analysis_rows(raw_items, key_field="question_type")
    ]

    misconception_counts = Counter(wrong_misconception_ids)
    misconception_last: dict[str, datetime] = {}
    for item in raw_items:
        misconception_id = item.get("selected_misconception_id")
        if item["is_correct"] or not misconception_id:
            continue
        previous = misconception_last.get(str(misconception_id))
        answered_at = item["answered_at"]
        if previous is None or answered_at > previous:
            misconception_last[str(misconception_id)] = answered_at
    misconceptions = []
    for misconception_id, count in misconception_counts.most_common():
        metadata = misconception_meta.get(misconception_id)
        if metadata is None:
            continue
        misconceptions.append(
            {
                **metadata,
                "repeat_count": int(count),
                "last_wrong_at": _iso(misconception_last[misconception_id]),
            }
        )

    lessons_by_id: dict[str, dict[str, Any]] = {}
    for metadata in subtopic_meta.values():
        lesson_id = str(metadata.get("lesson_id") or "")
        if lesson_id and lesson_id not in lessons_by_id:
            lessons_by_id[lesson_id] = {
                "id": lesson_id,
                "lesson_no": int(metadata["lesson_no"]),
                "title_fr": str(metadata["lesson_title_fr"]),
                "short_title": str(metadata["lesson_short_title"]),
            }
    lessons = sorted(lessons_by_id.values(), key=lambda item: (item["lesson_no"], item["id"]))

    correct_count = sum(bool(item["is_correct"]) for item in raw_items)
    question_count = len(raw_items)
    response_times = [int(item["response_ms"]) for item in raw_items if item["response_ms"] is not None]
    unmapped_wrong_count = sum(
        1
        for item in raw_items
        if not item["is_correct"] and not item.get("selected_misconception_id")
    )

    data = {
        "attempt_id": str(parsed_attempt_id),
        "test_id": str(test_id),
        "status": "COMPLETED",
        "mode": str(mode).lower(),
        "test_title": None if test_title is None else str(test_title),
        "score_raw": _float(score_raw),
        "score_pct": _float(score_pct),
        "question_count": question_count,
        "correct_count": correct_count,
        "incorrect_count": question_count - correct_count,
        "accuracy_pct": _pct(correct_count, question_count) or 0.0,
        "started_at": _iso(started_at),
        "completed_at": _iso(completed_at),
        "duration_seconds": _duration_seconds(started_at, completed_at),
        "average_response_ms": (
            None if not response_times else round(sum(response_times) / len(response_times))
        ),
        "lessons": lessons,
        "difficulty_analysis": difficulty_analysis,
        "subtopic_analysis": subtopic_analysis,
        "question_type_analysis": question_type_analysis,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "misconceptions": misconceptions,
        "unmapped_wrong_count": unmapped_wrong_count,
        "mastery_impact": _mastery_impact_summary(subtopic_analysis),
        "review_item_ids": review_item_ids,
        "breakdown": breakdown,
        "insights_version": ATTEMPT_RESULT_INSIGHTS_VERSION,
    }
    return Response({"data": data, "meta": meta}, status=200)
