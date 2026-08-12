# Full Question Bank — Lessons L01–L09 (B001–B041)

Status: **PASS_STATIC_CONSOLIDATION**  
Questions: **1806**  
Schema: **46 columns / question-import-schema-v0.9.0**  
Question status: **DRAFT only**  
Continuation: **last B041 / next B042**  
Stage 23: **STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT** — Import/Preview/Commit was not executed.

## Files

- `master/question_bank_full_B001_B041_L01_L09.csv` — canonical consolidated authoring master, 1,806 rows.
- `imports/question_bank_full_L01_L04_import_001.csv` — 961 rows; whole Lessons 1–4; within Stage 23 reference 1–1000 row limit.
- `imports/question_bank_full_L05_L09_import_002.csv` — 845 rows; whole Lessons 5–9; within Stage 23 reference 1–1000 row limit.
- `registry/question_bank_global_registry.csv` — exact cumulative B041 registry, 1,806 rows; use for B042 duplicate checking.
- `state/question_bank_checkpoint.json` — exact B041 checkpoint; next batch B042.
- `state/previous_batch/` — exact B041 CSV + validation required to continue B042 safely.
- `validation/question_bank_full_B001_B041_L01_L09_validation.json` — global consolidation/static QA report.
- `validation/batches/` — all 41 original batch validation reports.
- `manifests/source_batch_manifest.json` — SHA-256 provenance of all 41 source ZIPs and batch CSV/validation files.
- `manifests/repository_payload.sha256` — checksums for the repository payload.

## Repository location

Copy this `data/question_bank/full/v1.0/` directory into the repository at exactly:

`grammar-mastery-platform/data/question_bank/full/v1.0/`

This creates a new `data/question_bank/` area next to the existing `data/question_authoring/`, `data/planning/`, `data/knowledge/`, and `data/taxonomy/` directories. It keeps generated question inventory separate from Stage 6/7 authoring rules.

Do **not** run Stage 23 Import/Preview/Commit while the recorded manifest-hash-drift blocker remains in force. The two `imports/*.csv` files are prepared for that future step only.

## Static consolidation results

- B001–B041 present with no gaps.
- Lesson totals: L01=252, L02=209, L03=248, L04=252, L05=218, L06=169, L07=100, L08=169, L09=189.
- 1,806 unique `external_id` values.
- 1,806 DRAFT questions.
- Final B041 registry reconciles 1:1 with the master.
- No final-registry collisions in normalized stem, structural signature, semantic signature, or fingerprint.
- All 41 original batch validation reports are `PASS_STATIC_AUTHORING`.
