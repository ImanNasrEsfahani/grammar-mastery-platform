from __future__ import annotations

from copy import deepcopy
import csv
import io
import json
from pathlib import Path
from typing import Any

from backend.import_pipeline.validator import EXPECTED_COLUMNS, LookupCatalog


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = json.loads(
    (ROOT / "tests/fixtures/stage24/reference_dataset_v1.0.json").read_text(encoding="utf-8")
)
PERFORMANCE = json.loads(
    (ROOT / "tests/fixtures/stage24/performance_profile_v1.0.json").read_text(encoding="utf-8")
)

LESSON = "eb643021-d5f2-4093-8fd2-835a2199ef3f"
SUBTOPIC = "cfdb9cd8-73ac-48d3-8b53-3434fe851607"
MIS_B = "70000000-0000-4000-8000-000000000002"
MIS_C = "70000000-0000-4000-8000-000000000003"
MIS_D = "70000000-0000-4000-8000-000000000004"


def question_snapshot(index: int = 1) -> dict[str, Any]:
    row = deepcopy(REFERENCE["question_snapshot"])
    if index == 1:
        return row
    row["test_question_id"] = f"60000000-0000-4000-8000-{index:012d}"
    row["question_revision_id"] = f"10000000-0000-4000-8000-{index:012d}"
    row["question_uid"] = f"20000000-0000-4000-8000-{index:012d}"
    row["stem"] = f"Question synthétique déterministe {index}."
    for offset, option in enumerate(row["options"], start=1):
        option["id"] = f"50000000-0000-4000-8000-{index * 10 + offset:012d}"
    row["correct_option_id"] = row["options"][0]["id"]
    return row


def lookup_catalog() -> LookupCatalog:
    return LookupCatalog(
        lessons_by_id={LESSON: "L01"},
        lesson_ids_by_code={"L01": LESSON},
        subtopics_by_id={SUBTOPIC: ("L01-S01", LESSON)},
        subtopic_ids_by_code={"L01-S01": SUBTOPIC},
        tag_tokens={"TAG001"},
        misconception_ids={MIS_B, MIS_C, MIS_D},
        actor_ids={"author-1", "reviewer-2"},
    )


def valid_import_row(external_id: str = "S24-Q001") -> dict[str, str]:
    row = {name: "" for name in EXPECTED_COLUMNS}
    row.update(
        schema_version="question-import-schema-v0.9.0",
        external_id=external_id,
        question_revision="1",
        lesson_id=LESSON,
        lesson_code="L01",
        subtopic_id=SUBTOPIC,
        subtopic_code="L01-S01",
        secondary_subtopic_ids="",
        question_type="CLOZE_SINGLE",
        stem="Je ___ à Vancouver.",
        stem_locale="fr-FR",
        option_a="suis",
        option_b="es",
        option_c="est",
        option_d="sommes",
        option_locale="fr-FR",
        correct_option="A",
        full_explanation="Avec je, on emploie suis.",
        explanation_a="Correct : je suis.",
        explanation_b="es accompagne tu.",
        explanation_c="est accompagne il, elle ou on.",
        explanation_d="sommes accompagne nous.",
        explanation_locale="fr-FR",
        misconception_a_id="",
        misconception_b_id=MIS_B,
        misconception_c_id=MIS_C,
        misconception_d_id=MIS_D,
        difficulty="EASY",
        difficulty_score_initial="1",
        difficulty_model_version="difficulty-model-v0.9.0",
        status="DRAFT",
        source_type="PROJECT_SYNTHETIC_FROM_RULE",
        source_ref="Stage24 deterministic synthetic fixture",
        author_id="author-1",
        reviewer_id="",
        tags="TAG001",
        media_type="NONE",
        taxonomy_version="taxonomy-v0.9.0",
        question_type_catalogue_version="question-type-catalogue-v0.9.0",
        compatibility_version="question-type-compatibility-v0.9.0",
        distractor_rules_version="distractor-rule-set-v0.9.0",
        content_version="stage24-fixture-v1.0.0",
    )
    return row


def csv_bytes(rows: list[dict[str, str]]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=list(EXPECTED_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")
