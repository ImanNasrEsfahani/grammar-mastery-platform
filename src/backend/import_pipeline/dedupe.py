from __future__ import annotations

import hashlib
from typing import Any, Iterable, Mapping

from .normalization import canonical_phrase, semantic_phrase


OPTION_FIELDS = ("option_a", "option_b", "option_c", "option_d")


def _correct_text(row: Mapping[str, Any]) -> str:
    key = str(row.get("correct_option", "")).strip().lower()
    return str(row.get(f"option_{key}", "")) if key in {"a", "b", "c", "d"} else ""


def question_fingerprint(row: Mapping[str, Any]) -> str:
    """Stage 10 option-order-resistant SHA-256 fingerprint."""

    stable = [
        canonical_phrase(row.get("stem")),
        canonical_phrase(row.get("lesson_id")),
        canonical_phrase(row.get("subtopic_id")),
        canonical_phrase(row.get("question_type")),
        canonical_phrase(_correct_text(row)),
        *sorted(canonical_phrase(row.get(field)) for field in OPTION_FIELDS),
    ]
    return hashlib.sha256("\x1f".join(stable).encode("utf-8")).hexdigest()


def semantic_signature(row: Mapping[str, Any]) -> str:
    stable = [
        semantic_phrase(row.get("stem")),
        canonical_phrase(row.get("lesson_id")),
        canonical_phrase(row.get("subtopic_id")),
        canonical_phrase(row.get("question_type")),
        semantic_phrase(_correct_text(row)),
        *sorted(semantic_phrase(row.get(field)) for field in OPTION_FIELDS),
    ]
    return hashlib.sha256("\x1f".join(stable).encode("utf-8")).hexdigest()


def classify_duplicates(
    rows: Iterable[Mapping[str, Any]],
    *,
    existing_fingerprints: set[str] | None = None,
    existing_semantic_signatures: set[str] | None = None,
) -> list[dict[str, Any]]:
    existing_exact = existing_fingerprints or set()
    existing_semantic = existing_semantic_signatures or set()
    seen_exact: dict[str, int] = {}
    seen_semantic: dict[str, int] = {}
    results: list[dict[str, Any]] = []
    for fallback_number, row in enumerate(rows, start=2):
        row_number = int(row.get("_row_number", fallback_number))
        fingerprint = question_fingerprint(row)
        semantic = semantic_signature(row)
        if fingerprint in existing_exact:
            classification, related = "EXACT_EXISTING", None
        elif fingerprint in seen_exact:
            classification, related = "EXACT_IN_BATCH", seen_exact[fingerprint]
        elif semantic in existing_semantic:
            classification, related = "SEMANTIC_EXISTING_REVIEW", None
        elif semantic in seen_semantic:
            classification, related = "SEMANTIC_IN_BATCH_REVIEW", seen_semantic[semantic]
        else:
            classification, related = "UNIQUE", None
        results.append(
            {
                "row_number": row_number,
                "fingerprint_sha256": fingerprint,
                "semantic_signature_sha256": semantic,
                "classification": classification,
                "related_row_number": related,
            }
        )
        seen_exact.setdefault(fingerprint, row_number)
        seen_semantic.setdefault(semantic, row_number)
    return results
