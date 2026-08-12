# Apply Stage 27 overlay

Extract this archive at the repository root **after** current `main` and review the diff. This package contains Stage 27 files only; it intentionally does not rewrite README/STATUS or earlier stage artifacts.

The current default migration runner applies the Stage26 sequence through `database/postgres/007_stage23_import_pipeline_v1.1.sql`, then the additive `database/postgres/008_stage27_calibration_v1.0.sql`, after the migration/recovery gates are satisfied.

Validation before any commit:
```bash
PYTHONPATH=src python tools/validate_stage27.py
PYTHONPATH=src python -m unittest tests.test_stage27_calibration -v
```

Do not treat synthetic fixtures or a local SQL parse as production calibration evidence.
