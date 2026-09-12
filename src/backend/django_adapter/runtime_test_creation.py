from __future__ import annotations

from typing import Any, Mapping
import json
import uuid

from django.conf import settings
from django.db import DatabaseError, connection, transaction
from rest_framework.response import Response

from backend.django_adapter import runtime_learning as learning
from backend.errors import APIError, not_found
from backend.idempotency import InMemoryIdempotencyRegistry, request_hash


DEFAULT_STATEMENT_TIMEOUT_MS = 20_000
DEFAULT_LOCK_TIMEOUT_MS = 3_000


def _timeout_ms(setting_name: str, default: int) -> int:
    try:
        value = int(getattr(settings, setting_name, default))
    except (TypeError, ValueError):
        value = default
    return max(1_000, min(value, 120_000))


def _apply_transaction_timeouts(cursor) -> None:
    statement_ms = _timeout_ms("GMP_TEST_CREATION_STATEMENT_TIMEOUT_MS", DEFAULT_STATEMENT_TIMEOUT_MS)
    lock_ms = _timeout_ms("GMP_TEST_CREATION_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS)
    cursor.execute("SELECT set_config('statement_timeout', %s, true)", [f"{statement_ms}ms"])
    cursor.execute("SELECT set_config('lock_timeout', %s, true)", [f"{lock_ms}ms"])


def _in_clause(values: list[str], params: list[Any]) -> str:
    if not values:
        return "FALSE"
    params.extend(uuid.UUID(value) for value in values)
    return "(" + ", ".join(["%s"] * len(values)) + ")"


def _scope_predicate(scope: Mapping[str, Any]) -> tuple[str, list[Any]]:
    params: list[Any] = []
    expressions: list[str] = []
    field_by_dimension = {
        "LESSON": "q.lesson_id",
        "SUBTOPIC": "q.primary_subtopic_id",
        "CATEGORY": "gl.category_id",
        "SUBCATEGORY": "gl.subcategory_id",
    }

    for clause in scope["clauses"]:
        dimension = str(clause["dimension"])
        ids = [str(value) for value in clause["ids"]]
        if dimension == "TAG":
            placeholders = _in_clause(ids, params)
            if clause.get("tag_match", "ANY") == "ALL":
                params.append(len(ids))
                expressions.append(
                    "(SELECT count(DISTINCT qt_scope.tag_id) "
                    " FROM question_tags AS qt_scope "
                    " WHERE qt_scope.question_id = q.id "
                    f"   AND qt_scope.tag_id IN {placeholders}) = %s"
                )
            else:
                expressions.append(
                    "EXISTS (SELECT 1 FROM question_tags AS qt_scope "
                    "        WHERE qt_scope.question_id = q.id "
                    f"          AND qt_scope.tag_id IN {placeholders})"
                )
        else:
            field = field_by_dimension[dimension]
            expressions.append(f"{field} IN {_in_clause(ids, params)}")

    joiner = " AND " if scope["combine"] == "AND" else " OR "
    return "(" + joiner.join(expressions) + ")", params


def _candidate_rows_scoped(cursor, scope: Mapping[str, Any]) -> list[dict[str, Any]]:
    scope_sql, scope_params = _scope_predicate(scope)
    cursor.execute(
        f"""
        WITH exact_four_options AS (
            SELECT question_id
            FROM question_options
            GROUP BY question_id
            HAVING count(*) = 4
        )
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
        JOIN exact_four_options AS efo
          ON efo.question_id = q.id
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
          AND NOT EXISTS (
              SELECT 1
              FROM questions AS newer
              WHERE newer.question_uid = q.question_uid
                AND newer.revision > q.revision
          )
          AND {scope_sql}
        ORDER BY q.id
        """,
        scope_params,
    )

    rows: list[dict[str, Any]] = []
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
                "tcf_weight_pct": learning._float(tcf_weight),
                "status": "PUBLISHED",
                "is_current_revision": True,
                "serving_enabled": serving,
                "blocked_not_scorable": False,
                "compatibility_status": compatibility,
                "conditional_guardrail_passed": bool(guardrail_satisfied),
                "allocation_factor": learning._float(allocation_factor),
                "tag_ids": list(tag_ids or []),
            }
        )
    return rows


def _is_timeout_error(exc: DatabaseError) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "statement timeout",
            "lock timeout",
            "canceling statement due to statement timeout",
            "canceling statement due to lock timeout",
        )
    )


def create_test_request(request) -> Response:
    principal = learning._principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    payload = learning._validate_test_payload(request.data)

    if payload["mode"] in {"review", "mistakes"}:
        raise APIError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "Review and mistakes test generation requires the review runtime provider.",
        )

    idempotency_key = request.headers.get("Idempotency-Key", "")
    InMemoryIdempotencyRegistry.validate_key(idempotency_key)
    fingerprint = request_hash({}, payload)
    meta = learning._meta(request)
    seed = learning._selection_seed(payload, user_id, idempotency_key)

    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                _apply_transaction_timeouts(cursor)
                idem = learning._begin_idempotency(
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

                active_lessons = learning._active_lesson_ids(cursor)
                resolved_scope = learning._normalize_scope(payload["scope"], active_lessons)

                # Main performance fix: apply the requested scope inside PostgreSQL
                # before materializing candidates or adaptive user signals.
                candidates = _candidate_rows_scoped(cursor, resolved_scope)
                if payload["mode"] == "adaptive":
                    learning._adaptive_enrichment(cursor, user_id, candidates)

                if not any(row.get("serving_enabled") for row in candidates):
                    raise APIError(
                        422,
                        "NO_ELIGIBLE_QUESTIONS",
                        "No safe published questions are available for this test.",
                    )

                if payload["mode"] == "adaptive":
                    selected, evidence, selection_version = learning._select_adaptive(
                        payload,
                        resolved_scope,
                        candidates,
                        seed,
                    )
                else:
                    selected, evidence, selection_version = learning._select_static(
                        payload,
                        resolved_scope,
                        candidates,
                        seed,
                    )

                data = learning._persist_test(
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
    except DatabaseError as exc:
        if _is_timeout_error(exc):
            raise APIError(
                503,
                "TEST_CREATION_TIMEOUT",
                "Test creation exceeded the safe database time limit. Please retry.",
            ) from exc
        raise

    response = Response(body, status=201)
    response["Idempotent-Replayed"] = "false"
    return response


def get_test_request(request, test_id: Any) -> Response:
    principal = learning._principal(request)
    user_id = uuid.UUID(str(principal.user_id))
    parsed_test_id = learning._uuid(test_id, "testId")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                t.id,
                t.mode::text,
                t.title,
                t.selection_model_version,
                t.created_at,
                count(tq.id)::int
            FROM tests AS t
            LEFT JOIN test_questions AS tq ON tq.test_id = t.id
            WHERE t.id = %s
              AND t.user_id = %s
            GROUP BY t.id, t.mode, t.title, t.selection_model_version, t.created_at
            """,
            [parsed_test_id, user_id],
        )
        row = cursor.fetchone()
    if row is None:
        raise not_found()

    data = {
        "id": str(row[0]),
        "mode": str(row[1]).lower(),
        "title": row[2],
        "question_count": int(row[5] or 0),
        "selection_model_version": str(row[3]),
        "created_at": learning._iso(row[4]),
    }
    return Response({"data": data, "meta": learning._meta(request)}, status=200)
