from __future__ import annotations

from copy import deepcopy
import csv
import io
from pathlib import Path
import sys
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from backend.import_pipeline.dedupe import classify_duplicates, question_fingerprint
from backend.import_pipeline.normalization import normalize_row
from backend.import_pipeline.pipeline import ImportPipeline, PipelineError
from backend.import_pipeline.validator import EXPECTED_COLUMNS, LookupCatalog, validate_row


LESSON = "eb643021-d5f2-4093-8fd2-835a2199ef3f"
SUBTOPIC = "cfdb9cd8-73ac-48d3-8b53-3434fe851607"
MIS_B = "11111111-1111-4111-8111-111111111111"
MIS_C = "22222222-2222-4222-8222-222222222222"
MIS_D = "33333333-3333-4333-8333-333333333333"


def catalog() -> LookupCatalog:
    return LookupCatalog(
        lessons_by_id={LESSON: "L01"},
        lesson_ids_by_code={"L01": LESSON},
        subtopics_by_id={SUBTOPIC: ("L01-S01", LESSON)},
        subtopic_ids_by_code={"L01-S01": SUBTOPIC},
        tag_tokens={"TAG001"},
        misconception_ids={MIS_B, MIS_C, MIS_D},
        actor_ids={"author-1", "reviewer-2"},
    )


def valid_row(external_id: str = "L01-Q001") -> dict[str, str]:
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
        explanation_a="Correct: je suis.",
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
        source_ref="Lesson 1; printed p. 8",
        author_id="author-1",
        reviewer_id="",
        tags="TAG001",
        media_type="NONE",
        taxonomy_version="taxonomy-v0.9.0",
        question_type_catalogue_version="question-type-catalogue-v0.9.0",
        compatibility_version="question-type-compatibility-v0.9.0",
        distractor_rules_version="distractor-rule-set-v0.9.0",
        content_version="question-content-v1.0.0",
    )
    return row


def csv_bytes(rows: list[dict[str, str]], headers: tuple[str, ...] = EXPECTED_COLUMNS) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=list(headers), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def uploaded_pipeline(rows: list[dict[str, str]]) -> tuple[ImportPipeline, str]:
    pipeline = ImportPipeline()
    batch_id = str(uuid.uuid4())
    pipeline.upload(file_name="questions.csv", content=csv_bytes(rows), actor_id="author-1", batch_id=batch_id)
    pipeline.parse(batch_id, actor_id="author-1")
    return pipeline, batch_id


class Stage23ImportPipelineTests(unittest.TestCase):
    def test_01_normalization_is_unicode_and_case_safe_without_typo_correction(self):
        row = normalize_row({" difficulty ": " meduim ", "correct_option": " a ", "tags": "TAG001|TAG001"})
        self.assertEqual(row["difficulty"], "MEDUIM")
        self.assertEqual(row["correct_option"], "A")
        self.assertEqual(row["tags"], "TAG001")

    def test_02_fingerprint_is_option_order_resistant(self):
        first = valid_row()
        second = deepcopy(first)
        second["option_a"], second["option_b"] = first["option_b"], first["option_a"]
        second["correct_option"] = "B"
        second["misconception_a_id"], second["misconception_b_id"] = MIS_B, ""
        self.assertEqual(question_fingerprint(first), question_fingerprint(second))

    def test_03_semantic_near_duplicate_requires_review(self):
        first = valid_row()
        second = valid_row("L01-Q002")
        second["stem"] = "Je ___ à Vancouver!"
        result = classify_duplicates([first | {"_row_number": 2}, second | {"_row_number": 3}])
        self.assertEqual(result[1]["classification"], "SEMANTIC_IN_BATCH_REVIEW")

    def test_04_header_must_match_all_46_columns_in_order(self):
        pipeline = ImportPipeline()
        batch = str(uuid.uuid4())
        pipeline.upload(file_name="questions.csv", content=csv_bytes([valid_row()], EXPECTED_COLUMNS[:-1]), actor_id="author-1", batch_id=batch)
        with self.assertRaisesRegex(PipelineError, "header") as caught:
            pipeline.parse(batch, actor_id="author-1")
        self.assertEqual(caught.exception.code, "IMPORT_HEADER_INVALID")
        self.assertEqual(pipeline.repository.batches[batch]["status"], "FAILED")
        self.assertEqual(pipeline.repository.events[-1]["event_type"], "FAILED")

    def test_05_typo_difficulty_is_row_and_field_specific(self):
        row = valid_row()
        row["difficulty"] = "meduim"
        pipeline, batch = uploaded_pipeline([row])
        report = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        self.assertFalse(report["committable"])
        self.assertTrue(any(error["row_number"] == 2 and error["field"] == "difficulty" and error["code"] == "ENUM_INVALID" for error in report["errors"]))

    def test_06_unknown_lesson_is_rejected_not_created(self):
        row = valid_row()
        row["lesson_id"] = "99999999-9999-4999-8999-999999999999"
        errors = validate_row(row, 2, catalog())
        self.assertIn(("lesson_id", "LOOKUP_NOT_FOUND"), {(error.field, error.code) for error in errors})

    def test_07_correct_option_misconception_is_rejected(self):
        row = valid_row()
        row["misconception_a_id"] = MIS_B
        errors = validate_row(row, 2, catalog())
        self.assertIn("CORRECT_OPTION_HAS_MISCONCEPTION", {error.code for error in errors})

    def test_08_preview_does_not_create_questions(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        report = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        self.assertTrue(report["committable"])
        self.assertEqual(pipeline.repository.questions, {})

    def test_09_wrong_confirmation_token_is_rejected(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        with self.assertRaises(PipelineError) as caught:
            pipeline.commit(batch, confirmation_token="not-the-token", actor_id="author-1")
        self.assertEqual(caught.exception.code, "IMPORT_CONFIRMATION_INVALID")

    def test_10_commit_is_draft_only_and_audited(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        result = pipeline.commit(batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        self.assertEqual(result["committed_count"], 1)
        self.assertEqual({question["status"] for question in pipeline.repository.questions.values()}, {"DRAFT"})
        audit = pipeline.batch_audit(batch)
        self.assertTrue(audit["raw_retained"] and audit["raw_sha256_verified"])
        self.assertEqual([event["event_type"] for event in audit["events"]], ["UPLOADED", "PARSED", "PREVIEWED", "COMMITTED"])

    def test_11_invalid_row_blocks_entire_commit(self):
        bad = valid_row("L01-Q002")
        bad["correct_option"] = "E"
        pipeline, batch = uploaded_pipeline([valid_row(), bad])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        with self.assertRaises(PipelineError) as caught:
            pipeline.commit(batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        self.assertEqual(caught.exception.code, "IMPORT_NOT_COMMITTABLE")
        self.assertEqual(pipeline.repository.questions, {})

    def test_12_exact_duplicate_in_batch_is_blocking(self):
        second = valid_row("L01-Q002")
        pipeline, batch = uploaded_pipeline([valid_row(), second])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        self.assertEqual(preview["duplicate_count"], 1)
        self.assertFalse(preview["committable"])

    def test_13_existing_fingerprint_is_blocking(self):
        pipeline, first_batch = uploaded_pipeline([valid_row()])
        preview = pipeline.validate_and_preview(first_batch, actor_id="author-1", lookups=catalog())
        pipeline.commit(first_batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        second_batch = str(uuid.uuid4())
        pipeline.upload(file_name="again.csv", content=csv_bytes([valid_row("L01-Q099")]), actor_id="author-1", batch_id=second_batch)
        pipeline.parse(second_batch, actor_id="author-1")
        second = pipeline.validate_and_preview(second_batch, actor_id="author-1", lookups=catalog())
        self.assertEqual(second["duplicate_count"], 1)

    def test_14_semantic_acceptance_requires_reason_and_rotates_token(self):
        second = valid_row("L01-Q002")
        second["stem"] = "Je ___ à Vancouver!"
        pipeline, batch = uploaded_pipeline([valid_row(), second])
        first = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        self.assertEqual(first["semantic_review_count"], 1)
        resolved = pipeline.resolve_semantic(batch, row_number=3, decision="ACCEPT_DISTINCT", reason="Different punctuation is intentional for the error-location task.", actor_id="reviewer-2")
        self.assertTrue(resolved["committable"])
        with self.assertRaises(PipelineError):
            pipeline.commit(batch, confirmation_token=first["confirmation_token"], actor_id="author-1")
        pipeline.commit(batch, confirmation_token=resolved["confirmation_token"], actor_id="author-1")

    def test_15_semantic_rejection_remains_non_committable(self):
        second = valid_row("L01-Q002")
        second["stem"] = "Je ___ à Vancouver!"
        pipeline, batch = uploaded_pipeline([valid_row(), second])
        pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        resolved = pipeline.resolve_semantic(batch, row_number=3, decision="REJECT_DUPLICATE", reason="Same learning item.", actor_id="reviewer-2")
        self.assertFalse(resolved["committable"])

    def test_16_external_revision_conflict_rolls_back_all_inserts(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        pipeline.repository.questions["existing"] = {
            "external_id": "L01-Q001", "question_revision": 1, "fingerprint_sha256": "f" * 64,
            "semantic_signature_sha256": "s" * 64, "status": "DRAFT", "import_batch_id": "other",
        }
        with self.assertRaises(PipelineError) as caught:
            pipeline.commit(batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        self.assertEqual(caught.exception.code, "IMPORT_EXTERNAL_REVISION_CONFLICT")
        self.assertEqual(set(pipeline.repository.questions), {"existing"})

    def test_17_rollback_removes_only_untouched_drafts_and_retains_audit(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        pipeline.commit(batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        result = pipeline.rollback(batch, actor_id="author-1", reason="Source batch was uploaded twice.")
        self.assertEqual(result["rolled_back_count"], 1)
        self.assertEqual(pipeline.repository.questions, {})
        audit = pipeline.batch_audit(batch)
        self.assertEqual(audit["batch"]["status"], "ROLLED_BACK")
        self.assertTrue(audit["raw_retained"])

    def test_18_rollback_blocks_changed_or_referenced_questions(self):
        pipeline, batch = uploaded_pipeline([valid_row()])
        preview = pipeline.validate_and_preview(batch, actor_id="author-1", lookups=catalog())
        pipeline.commit(batch, confirmation_token=preview["confirmation_token"], actor_id="author-1")
        question = next(iter(pipeline.repository.questions.values()))
        question["status"] = "READY_FOR_REVIEW"
        with self.assertRaises(PipelineError) as caught:
            pipeline.rollback(batch, actor_id="author-1", reason="Late rollback")
        self.assertEqual(caught.exception.code, "ROLLBACK_REQUIRES_RETIREMENT_WORKFLOW")

    def test_19_xlsx_adapter_reads_the_same_frozen_schema(self):
        try:
            from openpyxl import Workbook
        except ImportError:
            self.skipTest("openpyxl not installed")
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(list(EXPECTED_COLUMNS))
        row = valid_row()
        sheet.append([row[name] for name in EXPECTED_COLUMNS])
        stream = io.BytesIO()
        workbook.save(stream)
        pipeline = ImportPipeline()
        batch = str(uuid.uuid4())
        pipeline.upload(file_name="questions.xlsx", content=stream.getvalue(), actor_id="author-1", batch_id=batch)
        parsed = pipeline.parse(batch, actor_id="author-1")
        self.assertEqual(parsed["row_count"], 1)

    def test_20_batch_ids_cannot_be_reused_or_overwritten(self):
        pipeline = ImportPipeline()
        batch = str(uuid.uuid4())
        pipeline.upload(file_name="questions.csv", content=csv_bytes([valid_row()]), actor_id="author-1", batch_id=batch)
        with self.assertRaises(PipelineError) as caught:
            pipeline.upload(file_name="other.csv", content=csv_bytes([valid_row()]), actor_id="author-1", batch_id=batch)
        self.assertEqual(caught.exception.code, "IMPORT_BATCH_EXISTS")


if __name__ == "__main__":
    unittest.main()
