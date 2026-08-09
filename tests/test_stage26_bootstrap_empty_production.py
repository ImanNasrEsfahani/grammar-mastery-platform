from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "ops" / "stage26" / "migration_runner.py"
SPEC = importlib.util.spec_from_file_location("stage26_migration_runner", MODULE_PATH)
assert SPEC and SPEC.loader
migration_runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration_runner)


def test_empty_public_schema_accepts_zero_relations() -> None:
    with patch.object(migration_runner, "psql_scalar", return_value="0"):
        assert migration_runner.production_public_schema_is_empty() is True


def test_empty_public_schema_rejects_existing_relation() -> None:
    with patch.object(migration_runner, "psql_scalar", return_value="1"):
        assert migration_runner.production_public_schema_is_empty() is False


def test_rehearsal_database_requires_pass_marker() -> None:
    with patch.object(migration_runner, "psql_scalar", return_value="PASS") as mocked:
        assert migration_runner.rehearsal_database_ok("rehearsal_db") is True
        assert mocked.call_args.kwargs["database"] == "rehearsal_db"


def test_rehearsal_database_rejects_incomplete_schema() -> None:
    with patch.object(migration_runner, "psql_scalar", return_value="FAIL"):
        assert migration_runner.rehearsal_database_ok("rehearsal_db") is False
