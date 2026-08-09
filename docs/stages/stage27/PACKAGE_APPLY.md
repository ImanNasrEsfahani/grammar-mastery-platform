# Apply Stage 27 overlay

Extract this archive at the repository root **after** current `main` and review the diff. This package contains Stage 27 files only; it intentionally does not rewrite README/STATUS or earlier stage artifacts.

Required migration order remains the Stage26 canonical sequence ending in `database/postgres/007_stage23_import_pipeline_v1.1.sql`, then add `database/postgres/008_stage27_calibration_v1.0.sql` only after a real PostgreSQL target exists and the Stage26 migration/recovery gates are satisfied.

Validation before any commit:
```bash
PYTHONPATH=src python tools/validate_stage27.py
PYTHONPATH=src python -m unittest tests.test_stage27_calibration -v
```

Do not treat synthetic fixtures or a local SQL parse as production calibration evidence.
