"""Reference Error Review engine for Grammar Mastery Platform Stage 16.

Pure deterministic logic only. Persistence/API orchestration belongs to later stages.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Iterable


MODEL_VERSION = "error-review-v0.9.0"
RESOLUTION_STATUSES = {"UNRESOLVED", "CORRECTED", "EXCLUDED_CONTENT_ISSUE"}
DIFFICULTIES = {"EASY", "MEDIUM", "HARD", "VERY_HARD"}
EVENT_TYPES = {
    "ITEM_OPENED",
    "RETRY_SUBMITTED",
    "ANSWER_REVEALED",
    "MARKED_FOR_REVIEW",
    "UNMARKED_FOR_REVIEW",
    "CONTENT_EXCLUDED",
    "CONTENT_REINSTATED",
}


class ReviewContractError(ValueError):
    """Fail-closed contract violation."""


def _optional_db_bool(value: Any, error_code: str) -> bool | None:
    """Normalize Python/PostgreSQL booleans and SQLite 0/1 values."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise ReviewContractError(error_code)


def _dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_config(config: dict[str, Any]) -> None:
    if config.get("model_version") != MODEL_VERSION:
        raise ReviewContractError("REVIEW_CONFIG_VERSION_MISMATCH")
    if config.get("retrieval_practice", {}).get("require_retry_before_auto_reveal") is not True:
        raise ReviewContractError("REVIEW_RETRIEVAL_GATE_REQUIRED")
    fallback = config.get("grouping", {}).get("fallback")
    if fallback != "SUBTOPIC_UNMAPPED":
        raise ReviewContractError("REVIEW_GROUPING_FALLBACK_INVALID")
    statuses = set(config.get("resolution", {}).get("statuses", []))
    if statuses != RESOLUTION_STATUSES:
        raise ReviewContractError("REVIEW_RESOLUTION_STATUSES_INVALID")


def latest_answers(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep latest answer_sequence per (attempt_id, test_question_id), as Stage15 does."""
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["attempt_id"], row["test_question_id"])
        prev = latest.get(key)
        if prev is None or int(row["answer_sequence"]) > int(prev["answer_sequence"]):
            latest[key] = deepcopy(row)
    return list(latest.values())


def group_key_for(row: dict[str, Any]) -> tuple[str, str]:
    misconception_id = row.get("misconception_id")
    if misconception_id:
        return f"MISCONCEPTION:{misconception_id}", "MISCONCEPTION"
    subtopic_id = row.get("subtopic_id")
    if not subtopic_id:
        raise ReviewContractError("REVIEW_MISSING_PRIMARY_SUBTOPIC")
    return f"SUBTOPIC:{subtopic_id}:UNMAPPED", "SUBTOPIC_UNMAPPED"


def materialize_error_items(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Create one review item for each eligible latest wrong answer.

    Ambiguous/invalid content remains auditable but is excluded from user weakness.
    Retired/disabled content remains history-only and cannot be retried.
    """
    items: list[dict[str, Any]] = []
    for row in latest_answers(rows):
        is_correct = _optional_db_bool(row.get("is_correct"), "REVIEW_INVALID_CORRECTNESS")
        if is_correct is None:
            continue
        if is_correct:
            continue
        difficulty = row.get("difficulty_code")
        if difficulty not in DIFFICULTIES:
            raise ReviewContractError("REVIEW_UNKNOWN_DIFFICULTY")
        group_key, group_quality = group_key_for(row)
        content_issue = bool(row.get("content_issue_excluded", False))
        active_for_retry = row.get("question_status") == "PUBLISHED" and bool(row.get("serving_enabled", True))
        status = "EXCLUDED_CONTENT_ISSUE" if content_issue else "UNRESOLVED"
        reviewability = "HISTORY_ONLY" if (content_issue or not active_for_retry) else "RETRY_ALLOWED"
        items.append(
            {
                "source_answer_id": row["answer_id"],
                "user_id": row["user_id"],
                "question_id": row["question_id"],
                "test_question_id": row["test_question_id"],
                "lesson_id": row["lesson_id"],
                "subtopic_id": row["subtopic_id"],
                "misconception_id": row.get("misconception_id"),
                "group_key": group_key,
                "group_quality": group_quality,
                "difficulty_code": difficulty,
                "wrong_at": row["answered_at"],
                "resolution_status": status,
                "reviewability": reviewability,
                "marked_for_review": False,
                "corrected_at": None,
                "review_model_version": MODEL_VERSION,
            }
        )
    return items


def apply_event(item: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    """Apply one review event to current item state without touching source test/answer."""
    out = deepcopy(item)
    event_type = event.get("event_type")
    if event_type not in EVENT_TYPES:
        raise ReviewContractError("REVIEW_EVENT_TYPE_INVALID")
    if event.get("user_id") != item.get("user_id"):
        raise ReviewContractError("REVIEW_EVENT_USER_MISMATCH")
    event_at = event.get("event_at")
    if not event_at:
        raise ReviewContractError("REVIEW_EVENT_TIME_REQUIRED")

    if event_type == "RETRY_SUBMITTED":
        if item.get("reviewability") != "RETRY_ALLOWED":
            raise ReviewContractError("REVIEW_RETRY_NOT_ALLOWED_HISTORY_ONLY")
        if event.get("selected_option_id") is None or event.get("is_correct") is None:
            raise ReviewContractError("REVIEW_RETRY_RESULT_REQUIRED")
        retry_is_correct = _optional_db_bool(event["is_correct"], "REVIEW_RETRY_RESULT_INVALID")
        if retry_is_correct:
            out["resolution_status"] = "CORRECTED"
            out["corrected_at"] = event_at
        else:
            out["resolution_status"] = "UNRESOLVED"
            out["corrected_at"] = None
    elif event_type == "MARKED_FOR_REVIEW":
        out["marked_for_review"] = True
    elif event_type == "UNMARKED_FOR_REVIEW":
        out["marked_for_review"] = False
    elif event_type == "CONTENT_EXCLUDED":
        out["resolution_status"] = "EXCLUDED_CONTENT_ISSUE"
        out["reviewability"] = "HISTORY_ONLY"
        out["corrected_at"] = None
    elif event_type == "CONTENT_REINSTATED":
        out["resolution_status"] = "UNRESOLVED"
        out["reviewability"] = event.get("reviewability", "HISTORY_ONLY")
        out["corrected_at"] = None
    # ITEM_OPENED and ANSWER_REVEALED intentionally do not alter resolution.
    return out


def feedback_state(events: Iterable[dict[str, Any]]) -> str:
    """Auto-feedback is hidden until retrieval attempt; explicit reveal is audited."""
    for event in events:
        if event.get("event_type") in {"RETRY_SUBMITTED", "ANSWER_REVEALED"}:
            return "REVEALED"
    return "HIDDEN"


def group_items(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        buckets[(item["user_id"], item["group_key"])].append(item)

    groups = []
    for (user_id, key), rows in buckets.items():
        wrong_times = [_dt(r["wrong_at"]) for r in rows]
        unresolved = sum(r["resolution_status"] == "UNRESOLVED" for r in rows)
        corrected = sum(r["resolution_status"] == "CORRECTED" for r in rows)
        excluded = sum(r["resolution_status"] == "EXCLUDED_CONTENT_ISSUE" for r in rows)
        groups.append(
            {
                "user_id": user_id,
                "group_key": key,
                "group_quality": rows[0]["group_quality"],
                "misconception_id": rows[0].get("misconception_id"),
                "lesson_ids": sorted({r["lesson_id"] for r in rows}),
                "subtopic_ids": sorted({r["subtopic_id"] for r in rows}),
                "eligible_wrong_count": len(rows) - excluded,
                "unresolved_count": unresolved,
                "corrected_count": corrected,
                "excluded_count": excluded,
                "marked_count": sum(bool(r["marked_for_review"]) for r in rows),
                "first_wrong_at": min(wrong_times).isoformat().replace("+00:00", "Z"),
                "last_wrong_at": max(wrong_times).isoformat().replace("+00:00", "Z"),
                "group_resolution": "UNRESOLVED" if unresolved else ("CORRECTED" if corrected else "EXCLUDED_CONTENT_ISSUE"),
            }
        )
    return sorted(groups, key=priority_key)


def priority_key(group: dict[str, Any]) -> tuple[Any, ...]:
    """Deterministic priority; scheduling/due dates deliberately belong to Stage17."""
    return (
        -int(group.get("marked_count", 0) > 0),
        -int(group.get("unresolved_count", 0) > 0),
        -int(group.get("eligible_wrong_count", 0)),
        -_dt(group["last_wrong_at"]).timestamp(),
        group["group_key"],
    )


def filter_items(items: Iterable[dict[str, Any]], filters: dict[str, Any]) -> list[dict[str, Any]]:
    materialized_items = list(items)
    date_from = _dt(filters["date_from"]) if filters.get("date_from") else None
    date_to = _dt(filters["date_to"]) if filters.get("date_to") else None
    lessons = set(filters.get("lesson_ids", []))
    subtopics = set(filters.get("subtopic_ids", []))
    misconceptions = set(filters.get("misconception_ids", []))
    difficulties = set(filters.get("difficulty_codes", []))
    statuses = set(filters.get("resolution_statuses", []))
    marked_only = bool(filters.get("marked_only", False))

    out = []
    for item in materialized_items:
        when = _dt(item["wrong_at"])
        if date_from and when < date_from:
            continue
        if date_to and when > date_to:
            continue
        if lessons and item["lesson_id"] not in lessons:
            continue
        if subtopics and item["subtopic_id"] not in subtopics:
            continue
        if misconceptions and item.get("misconception_id") not in misconceptions:
            continue
        if difficulties and item["difficulty_code"] not in difficulties:
            continue
        if statuses and item["resolution_status"] not in statuses:
            continue
        if marked_only and not item["marked_for_review"]:
            continue
        out.append(deepcopy(item))

    min_repeat = int(filters.get("min_repeat_count", 1))
    if min_repeat > 1:
        counts: dict[tuple[str, str], int] = defaultdict(int)
        for item in materialized_items:
            if item["resolution_status"] != "EXCLUDED_CONTENT_ISSUE":
                counts[(item["user_id"], item["group_key"])] += 1
        out = [x for x in out if counts[(x["user_id"], x["group_key"])] >= min_repeat]
    return out


def evidence_is_eligible(answer_id: str, exclusion_events: Iterable[dict[str, Any]]) -> bool:
    """Latest exclusion event wins; Stage15 replay should call this gate before mastery scoring."""
    relevant = [e for e in exclusion_events if e.get("source_answer_id") == answer_id]
    if not relevant:
        return True
    relevant.sort(key=lambda e: (_dt(e["event_at"]), e.get("event_id", "")))
    return relevant[-1]["action"] != "EXCLUDE"
