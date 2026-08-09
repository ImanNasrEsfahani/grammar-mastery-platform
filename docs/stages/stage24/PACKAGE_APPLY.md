# Apply the Stage 24-only overlay

This archive intentionally does not aggregate earlier stages. Apply it only after the Stage 23 v1.0 package has been layered on the latest supplied `main` baseline (`e04967b799b8c254dee651d5e54902847f749b29`).

1. Verify the archive SHA-256 shown in the handoff.
2. Extract into the repository root while preserving relative paths.
3. Do not execute `database/postgres/007_stage23_import_pipeline_v1.0.sql`.
4. Use `config/stage24_migration_plan_v1.0.json`; its final migration is the compatible v1.1 file.
5. Install `requirements-dev.txt`, then run `python tools/validate_stage24.py` and the integrated unittest suite.
6. Run `npm ci && npm run validate` inside `frontend/`.
7. Run the PostgreSQL profile with an isolated non-production database or let the checked-in CI service execute it.

The overlay updates `README.md` and `STATUS.md`, adds Stage 24 artifacts/tests/CI, and adds one non-destructive dependency correction discovered by Stage 24. It neither commits nor pushes repository changes.
