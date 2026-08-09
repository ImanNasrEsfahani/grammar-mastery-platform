# Stage 23 - Question Bank Import Pipeline

- **Package:** `stage23-import-pipeline-v1.0-review`
- **Owner / reviewer:** Iman
- **Prepared:** 2026-08-09 UTC
- **Status:** `REFERENCE_IMPLEMENTATION_VALIDATED_PENDING_OWNER_ACCEPTANCE`

Stage 23 turns the frozen Stage 10 CSV/XLSX authoring row into auditable Stage 12 question records without direct spreadsheet-to-database inserts. It implements the roadmap sequence `Upload -> Parse -> Normalize -> Validate -> Dedupe -> Preview -> Commit -> Post-check -> Rollback` and preserves the Stage 11/20 rule that every imported question starts as `DRAFT`.

## Roadmap deliverables

- **Import schema:** the existing 46-column `schemas/question_import.schema.json`, with the operational mapping in `import_schema_v1.0.md` and batch/preview schemas in `schemas/stage23_*`.
- **Validator:** `src/backend/import_pipeline/validator.py`, including row number, field and stable error code.
- **Preview report:** a non-mutating preview implementation plus `preview_report_example_v1.0.json`.
- **Batch audit:** additive PostgreSQL storage and `batch_audit_v1.0.md`.
- **Rollback strategy:** reference behavior and `rollback_strategy_v1.0.md`.

## Key guarantees

- Raw CSV/XLSX content is retained and SHA-256 verified before parsing.
- Headers must match all 46 Stage 10 columns in their frozen order.
- Normalization never corrects unknown values. `meduim` becomes the visible unknown `MEDUIM` and is rejected; it never creates a new difficulty/category.
- Lesson, subtopic, question type, tag, misconception and actor values are resolved through canonical lookups. ID/code pairs must agree.
- Exact, fingerprint and conservative semantic duplicate checks are separate. Semantic matches require a reasoned human decision and rotate the preview token.
- Preview cannot mutate the question bank. Commit is all-or-none, uses the exact reviewed preview, is idempotent at the Stage 21 HTTP boundary and creates `DRAFT` rows only.
- Automatic rollback is allowed only while every imported question is an untouched, unreferenced Draft. Otherwise the existing audited retirement workflow is required.
- Raw source, normalized rows, preview hash and append-only events survive rollback.

## Validate

```bash
python tools/validate_stage23.py
python -m unittest tests.test_stage23_import_pipeline -v
python -m unittest discover -s tests -v
```

The dedicated reference suite contains 20 behavior tests. PostgreSQL Patch 007 is statically validated but has not been executed against the eventual production PostgreSQL/object-storage target; that remains an operational evidence item, not a design gap.

## Acceptance boundary

The implementation is ready for Iman's content/technical review and for Stage 24 multi-layer testing. Formal owner acceptance is not inferred automatically. Production raw-file retention, object-storage provider and empirically calibrated semantic matching remain explicitly assigned to Stages 25-27.
