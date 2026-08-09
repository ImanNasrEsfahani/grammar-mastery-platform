# Stage 17 — Spaced Repetition

- **Source package:** `stage17-v0.9-review`
- **Reference validation:** `32/32 PASS`
- **SQLite integration:** `PASS`
- **Runtime status:** calibration awaits `PUBLISHED` inventory and live user history

The Library package was checksum-verified before import and then mapped into the repository layout without changing its semantic scheduler/state-machine versions.

## Repository mapping

- `config/stage17_contract.json` — canonical SRS design contract
- `config/stage17_scheduler.json` — default versioned scheduler configuration
- `schemas/stage17_config.schema.json` — scheduler configuration schema
- `src/spaced_repetition/scheduler.py` — deterministic reference scheduler
- `tests/test_stage17_spaced_repetition.py` — 32 reference tests
- `database/postgres/004_stage17_spaced_repetition_v0.9.sql` — PostgreSQL additive patch
- `database/sqlite/004_stage17_spaced_repetition_v0.9.sql` — SQLite reference patch
- `docs/stages/stage17/worked_example_v0.9.json` — state-machine example
- `docs/stages/stage17/validation_v0.9.json` — validation evidence
- `docs/stages/stage17/review_report_v0.9.md` — design/review handoff
- `docs/stages/stage17/source_manifest_v0.9.json` — original Library package manifest

The imported source manifest still records the original flat package filenames; it is retained as provenance, not as a manifest of repository paths.

## Repository integration hardening

The repository-mapped scheduler keeps its in-code default configuration byte-for-value aligned with `config/stage17_scheduler.json` and fails closed on all schema-required version, safety, event and queue policies. The SQLite due view uses `julianday()` rather than lexicographic timestamp comparison so fractional seconds and UTC offsets retain PostgreSQL-equivalent ordering. These compatibility fixes preserve the `spaced-review-v0.9.0` scheduling semantics; the source manifest remains an immutable record of the original Library package.
