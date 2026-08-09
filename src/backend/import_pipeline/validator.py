from __future__ import annotations

from dataclasses import asdict, dataclass, field
import re
import uuid
from typing import Any, Mapping


SCHEMA_VERSION = "question-import-schema-v0.9.0"
QUESTION_TYPES = {
    "CLOZE_SINGLE", "CLOZE_CONTEXT", "CORRECT_SENTENCE", "INCORRECT_SENTENCE",
    "ERROR_LOCATION", "CONJUGATION", "TENSE_CHOICE", "PRONOUN_CHOICE",
    "PREPOSITION_CHOICE", "REWRITE_EQUIV", "FR_TO_FA", "FA_TO_FR",
    "DIALOGUE_COMPLETE", "REGISTER_CHOICE", "CONTRAST_RULES",
}
DIFFICULTIES = {"EASY", "MEDIUM", "HARD", "VERY_HARD"}
LOCALES = {"fr-FR", "fa-IR"}
SOURCE_TYPES = {"BOOK_DIRECT", "PROJECT_SYNTHETIC_FROM_RULE", "EXTERNAL_REVIEWED"}
MEDIA_TYPES = {"NONE", "IMAGE", "AUDIO", "VIDEO"}
EXPECTED_COLUMNS = (
    "schema_version", "external_id", "question_revision", "lesson_id", "lesson_code",
    "subtopic_id", "subtopic_code", "secondary_subtopic_ids", "question_type", "stem",
    "stem_locale", "option_a", "option_b", "option_c", "option_d", "option_locale",
    "correct_option", "full_explanation", "explanation_a", "explanation_b",
    "explanation_c", "explanation_d", "explanation_locale", "misconception_a_id",
    "misconception_b_id", "misconception_c_id", "misconception_d_id", "difficulty",
    "difficulty_score_initial", "difficulty_model_version", "status", "source_type",
    "source_ref", "author_id", "reviewer_id", "tags", "media_type", "media_uri",
    "media_alt_text", "media_transcript", "media_source_ref", "taxonomy_version",
    "question_type_catalogue_version", "compatibility_version", "distractor_rules_version",
    "content_version",
)
VERSION_CONSTANTS = {
    "taxonomy_version": "taxonomy-v0.9.0",
    "question_type_catalogue_version": "question-type-catalogue-v0.9.0",
    "compatibility_version": "question-type-compatibility-v0.9.0",
    "distractor_rules_version": "distractor-rule-set-v0.9.0",
}


@dataclass(frozen=True)
class RowError:
    row_number: int
    field: str
    code: str
    message: str
    severity: str = "ERROR"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LookupCatalog:
    lessons_by_id: dict[str, str] = field(default_factory=dict)
    lesson_ids_by_code: dict[str, str] = field(default_factory=dict)
    subtopics_by_id: dict[str, tuple[str, str]] = field(default_factory=dict)
    subtopic_ids_by_code: dict[str, str] = field(default_factory=dict)
    question_types: set[str] = field(default_factory=lambda: set(QUESTION_TYPES))
    tag_tokens: set[str] = field(default_factory=set)
    misconception_ids: set[str] = field(default_factory=set)
    actor_ids: set[str] = field(default_factory=set)


def _error(errors: list[RowError], row_number: int, field_name: str, code: str, message: str) -> None:
    errors.append(RowError(row_number, field_name, code, message))


def _valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def validate_row(row: Mapping[str, Any], row_number: int, lookups: LookupCatalog) -> list[RowError]:
    errors: list[RowError] = []
    keys = set(row) - {"_row_number"}
    for name in EXPECTED_COLUMNS:
        if name not in keys:
            _error(errors, row_number, name, "REQUIRED_COLUMN_MISSING", "Required column is missing.")
    for name in sorted(keys - set(EXPECTED_COLUMNS)):
        _error(errors, row_number, name, "UNKNOWN_COLUMN", "Column is not part of the frozen 46-column schema.")
    if errors:
        return errors

    required_text = {
        "external_id", "lesson_id", "lesson_code", "subtopic_id", "subtopic_code",
        "question_type", "stem", "stem_locale", "option_a", "option_b", "option_c",
        "option_d", "option_locale", "correct_option", "full_explanation", "explanation_a",
        "explanation_b", "explanation_c", "explanation_d", "explanation_locale", "difficulty",
        "difficulty_model_version", "status", "source_type", "source_ref", "author_id",
        "media_type", "taxonomy_version", "question_type_catalogue_version",
        "compatibility_version", "distractor_rules_version", "content_version",
    }
    for name in required_text:
        if not str(row.get(name, "")).strip():
            _error(errors, row_number, name, "REQUIRED_VALUE_MISSING", "A non-empty value is required.")

    if row.get("schema_version") != SCHEMA_VERSION:
        _error(errors, row_number, "schema_version", "SCHEMA_VERSION_UNSUPPORTED", f"Use {SCHEMA_VERSION}.")
    for name, expected in VERSION_CONSTANTS.items():
        if row.get(name) != expected:
            _error(errors, row_number, name, "VERSION_MISMATCH", f"Use {expected}.")

    external_id = str(row.get("external_id", ""))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}", external_id):
        _error(errors, row_number, "external_id", "INVALID_EXTERNAL_ID", "Use 1-100 stable ASCII identifier characters.")
    try:
        if int(str(row.get("question_revision", ""))) < 1:
            raise ValueError
    except ValueError:
        _error(errors, row_number, "question_revision", "INVALID_INTEGER", "Use an integer greater than or equal to 1.")

    lesson_id, lesson_code = str(row.get("lesson_id", "")), str(row.get("lesson_code", ""))
    if not _valid_uuid(lesson_id) or lesson_id not in lookups.lessons_by_id:
        _error(errors, row_number, "lesson_id", "LOOKUP_NOT_FOUND", "lesson_id must resolve to an active canonical lesson.")
    elif lookups.lessons_by_id[lesson_id] != lesson_code:
        _error(errors, row_number, "lesson_code", "LOOKUP_PAIR_MISMATCH", "lesson_code does not identify lesson_id.")

    subtopic_id, subtopic_code = str(row.get("subtopic_id", "")), str(row.get("subtopic_code", ""))
    subtopic = lookups.subtopics_by_id.get(subtopic_id)
    if not _valid_uuid(subtopic_id) or subtopic is None:
        _error(errors, row_number, "subtopic_id", "LOOKUP_NOT_FOUND", "subtopic_id must resolve to an active canonical subtopic.")
    elif subtopic != (subtopic_code, lesson_id):
        _error(errors, row_number, "subtopic_code", "LOOKUP_PAIR_MISMATCH", "Subtopic code or owning lesson does not match subtopic_id.")

    for secondary in filter(None, str(row.get("secondary_subtopic_ids", "")).split("|")):
        resolved = lookups.subtopics_by_id.get(secondary)
        if not _valid_uuid(secondary) or resolved is None:
            _error(errors, row_number, "secondary_subtopic_ids", "LOOKUP_NOT_FOUND", f"Unknown secondary subtopic: {secondary}.")
        elif secondary == subtopic_id:
            _error(errors, row_number, "secondary_subtopic_ids", "PRIMARY_REPEATED_AS_SECONDARY", "Primary subtopic cannot be repeated as secondary.")

    if row.get("question_type") not in lookups.question_types:
        _error(errors, row_number, "question_type", "LOOKUP_NOT_FOUND", "Unknown question type; no new type is created during import.")
    if row.get("difficulty") not in DIFFICULTIES:
        _error(errors, row_number, "difficulty", "ENUM_INVALID", "Use EASY, MEDIUM, HARD or VERY_HARD; typos are rejected.")
    if row.get("status") != "DRAFT":
        _error(errors, row_number, "status", "DRAFT_ONLY", "Stage 23 imports DRAFT rows only.")
    if row.get("source_type") not in SOURCE_TYPES:
        _error(errors, row_number, "source_type", "ENUM_INVALID", "Unknown source type.")
    for locale_field in ("stem_locale", "option_locale", "explanation_locale"):
        if row.get(locale_field) not in LOCALES:
            _error(errors, row_number, locale_field, "ENUM_INVALID", "Use fr-FR or fa-IR.")
    if row.get("correct_option") not in {"A", "B", "C", "D"}:
        _error(errors, row_number, "correct_option", "ENUM_INVALID", "Use A, B, C or D; the importer never guesses.")

    score = str(row.get("difficulty_score_initial", ""))
    if score:
        try:
            numeric_score = float(score)
            if not 1 <= numeric_score <= 4:
                raise ValueError
        except ValueError:
            _error(errors, row_number, "difficulty_score_initial", "NUMBER_OUT_OF_RANGE", "Use an empty value or a number from 1 through 4.")

    correct = str(row.get("correct_option", "")).lower()
    for key in "abcd":
        misconception = str(row.get(f"misconception_{key}_id", ""))
        if key == correct and misconception:
            _error(errors, row_number, f"misconception_{key}_id", "CORRECT_OPTION_HAS_MISCONCEPTION", "The correct option cannot map to a misconception.")
        elif key != correct:
            if not misconception:
                _error(errors, row_number, f"misconception_{key}_id", "DISTRACTOR_MISCONCEPTION_REQUIRED", "Every distractor requires an approved misconception mapping.")
            elif not _valid_uuid(misconception) or misconception not in lookups.misconception_ids:
                _error(errors, row_number, f"misconception_{key}_id", "LOOKUP_NOT_FOUND", "Misconception must resolve; the importer never creates one.")

    for token in filter(None, str(row.get("tags", "")).split("|")):
        if token not in lookups.tag_tokens:
            _error(errors, row_number, "tags", "LOOKUP_NOT_FOUND", f"Unknown tag token: {token}.")
    if str(row.get("author_id")) not in lookups.actor_ids:
        _error(errors, row_number, "author_id", "LOOKUP_NOT_FOUND", "author_id must resolve to an active actor.")
    reviewer = str(row.get("reviewer_id", ""))
    if reviewer and reviewer not in lookups.actor_ids:
        _error(errors, row_number, "reviewer_id", "LOOKUP_NOT_FOUND", "reviewer_id must resolve to an active actor.")
    if reviewer and reviewer == str(row.get("author_id")):
        _error(errors, row_number, "reviewer_id", "INDEPENDENT_REVIEW_REQUIRED", "Reviewer must differ from author; a Draft may leave reviewer blank.")

    media_type = row.get("media_type")
    if media_type not in MEDIA_TYPES:
        _error(errors, row_number, "media_type", "ENUM_INVALID", "Use NONE, IMAGE, AUDIO or VIDEO.")
    if media_type == "NONE" and any(str(row.get(name, "")) for name in ("media_uri", "media_alt_text", "media_transcript", "media_source_ref")):
        _error(errors, row_number, "media_type", "MEDIA_FIELDS_WITH_NONE", "Media fields must be empty when media_type is NONE.")
    if media_type in {"IMAGE", "AUDIO", "VIDEO"} and not str(row.get("media_uri", "")):
        _error(errors, row_number, "media_uri", "REQUIRED_VALUE_MISSING", "Media URI is required for media questions.")
    if media_type == "IMAGE" and not str(row.get("media_alt_text", "")):
        _error(errors, row_number, "media_alt_text", "REQUIRED_VALUE_MISSING", "Image alternative text is required.")
    if media_type in {"AUDIO", "VIDEO"} and not str(row.get("media_transcript", "")):
        _error(errors, row_number, "media_transcript", "REQUIRED_VALUE_MISSING", "Audio/video transcript is required.")

    limits = {"stem": 2000, "full_explanation": 4000, **{f"option_{k}": 500 for k in "abcd"}, **{f"explanation_{k}": 2000 for k in "abcd"}}
    for name, limit in limits.items():
        if len(str(row.get(name, ""))) > limit:
            _error(errors, row_number, name, "MAX_LENGTH_EXCEEDED", f"Maximum length is {limit} characters.")
    return errors
