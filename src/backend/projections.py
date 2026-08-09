from __future__ import annotations

from copy import deepcopy
from typing import Any

from .errors import APIError


FORBIDDEN_PREANSWER_FIELDS = {
    "correct_option_id",
    "correctOptionId",
    "is_correct",
    "isCorrect",
    "full_explanation",
    "fullExplanation",
    "explanation",
    "misconception_id",
    "misconceptionId",
    "answer_key",
    "answerKey",
}


def public_attempt_question(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Allow-list a frozen question for pre-answer learner delivery."""
    options = []
    for option in snapshot.get("options", []):
        options.append(
            {
                "id": str(option["id"]),
                "position": str(option["position"]),
                "text": str(option["text"]),
            }
        )
    if not options:
        raise APIError(503, "DEPENDENCY_UNAVAILABLE", "The frozen question snapshot is incomplete.")
    out = {
        "test_question_id": str(snapshot["test_question_id"]),
        "question_revision_id": str(snapshot["question_revision_id"]),
        "position": int(snapshot["position"]),
        "stem": str(snapshot["stem"]),
        "stem_locale": str(snapshot.get("stem_locale", "fr-FR")),
        "question_type": str(snapshot.get("question_type", "SINGLE_CHOICE_4")),
        "difficulty": str(snapshot["difficulty"]),
        "options": options,
    }
    media = []
    for item in snapshot.get("media", []):
        media.append(
            {
                key: deepcopy(item[key])
                for key in ("type", "uri", "alt_text", "transcript")
                if key in item
            }
        )
    if media:
        out["media"] = media
    return out


def answer_feedback(snapshot: dict[str, Any], selected_option_id: str) -> dict[str, Any]:
    options = {str(option["id"]): option for option in snapshot.get("options", [])}
    if str(selected_option_id) not in options:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The selected option does not belong to this question.",
            {"selected_option_id": ["Choose an option from the frozen question."]},
        )
    correct_option_id = str(snapshot["correct_option_id"])
    selected = options[str(selected_option_id)]
    correct = options[correct_option_id]
    return {
        "is_correct": str(selected_option_id) == correct_option_id,
        "selected_option_id": str(selected_option_id),
        "correct_option_id": correct_option_id,
        "selected_option_explanation": selected.get("explanation"),
        "correct_option_explanation": correct.get("explanation"),
        "full_explanation": snapshot.get("full_explanation"),
    }


def find_forbidden_preanswer_fields(value: Any, prefix: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if key in FORBIDDEN_PREANSWER_FIELDS:
                found.append(path)
            found.extend(find_forbidden_preanswer_fields(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_forbidden_preanswer_fields(child, f"{prefix}[{index}]"))
    return found
