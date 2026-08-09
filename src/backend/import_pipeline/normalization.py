from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping


PIPE_FIELDS = {"secondary_subtopic_ids", "tags"}
UPPER_FIELDS = {
    "correct_option",
    "difficulty",
    "media_type",
    "source_type",
    "status",
}


def normalize_text(value: Any) -> str:
    """Apply lossless text hygiene; never autocorrect unknown domain values."""

    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = unicodedata.normalize("NFC", str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.strip()


def normalize_pipe_list(value: Any) -> str:
    values: list[str] = []
    seen: set[str] = set()
    for item in normalize_text(value).split("|"):
        normalized = item.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            values.append(normalized)
    return "|".join(values)


def normalize_row(row: Mapping[str, Any]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for raw_key, raw_value in row.items():
        key = normalize_text(raw_key).lstrip("\ufeff")
        value = normalize_pipe_list(raw_value) if key in PIPE_FIELDS else normalize_text(raw_value)
        if key in UPPER_FIELDS:
            value = value.upper()
        normalized[key] = value
    return normalized


def canonical_phrase(value: Any) -> str:
    """Stable Unicode/case/spacing form used by exact fingerprints."""

    return re.sub(r"\s+", " ", normalize_text(value)).casefold()


def semantic_phrase(value: Any) -> str:
    """Conservative near-duplicate form; it only flags review candidates."""

    decomposed = unicodedata.normalize("NFKD", canonical_phrase(value))
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return "".join(char for char in without_marks if char.isalnum())
