from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
import py_compile
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = [
    ".github/workflows/stage24-ci.yml",
    "config/stage24_testing_contract_v1.0.json",
    "config/stage24_migration_plan_v1.0.json",
    "database/postgres/007_stage23_import_pipeline_v1.1.sql",
    "docs/stages/stage24/README.md",
    "docs/stages/stage24/PACKAGE_APPLY.md",
    "docs/stages/stage24/test_pyramid_v1.0.md",
    "docs/stages/stage24/critical_scenarios_v1.0.csv",
    "docs/stages/stage24/performance_baseline_v1.0.json",
    "docs/stages/stage24/needs_decision_v1.0.csv",
    "docs/stages/stage24/review_report_v1.0.md",
    "docs/stages/stage24/validation_v1.0.json",
    "docs/stages/stage24/package_manifest_v1.0.json",
    "tests/fixtures/stage24/reference_dataset_v1.0.json",
    "tests/fixtures/stage24/performance_profile_v1.0.json",
    "tests/stage24_fixtures.py",
    "tests/stage24_performance_harness.py",
    "tests/test_stage24_unit.py",
    "tests/test_stage24_integration.py",
    "tests/test_stage24_contract.py",
    "tests/test_stage24_e2e.py",
    "tests/test_stage24_performance.py",
    "tests/test_stage24_postgres.py",
    "frontend/src/components/runner/AttemptRunner.stage24.test.tsx",
    "tools/run_stage24_performance.py",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    for relative in REQUIRED_FILES:
        require((ROOT / relative).is_file(), f"missing required file: {relative}")

    contract = json.loads(
        (ROOT / "config/stage24_testing_contract_v1.0.json").read_text(encoding="utf-8")
    )
    plan = json.loads(
        (ROOT / "config/stage24_migration_plan_v1.0.json").read_text(encoding="utf-8")
    )
    validation = json.loads(
        (ROOT / "docs/stages/stage24/validation_v1.0.json").read_text(encoding="utf-8")
    )
    manifest = json.loads(
        (ROOT / "docs/stages/stage24/package_manifest_v1.0.json").read_text(encoding="utf-8")
    )
    baseline = json.loads(
        (ROOT / "docs/stages/stage24/performance_baseline_v1.0.json").read_text(encoding="utf-8")
    )
    with (ROOT / "docs/stages/stage24/critical_scenarios_v1.0.csv").open(
        encoding="utf-8-sig", newline=""
    ) as stream:
        scenarios = list(csv.DictReader(stream))

    require(contract["contract_version"] == "stage24-testing-v1.0.0", "contract version drift")
    require(
        [row["layer"] for row in contract["test_pyramid"]]
        == ["UNIT", "INTEGRATION", "CONTRACT", "E2E", "PERFORMANCE"],
        "test pyramid drift",
    )
    require(contract["fixture_policy"]["production_data_allowed"] is False, "production fixtures forbidden")
    require(len(scenarios) == 10, "critical scenario count drift")
    require(all(row["automated"] == "YES" for row in scenarios), "manual-only critical scenario")
    require(baseline["overall_pass"] is True, "reference performance baseline failed")
    require(baseline["production_sla"] == "NOT_CLAIMED", "reference result mislabeled as SLA")
    require(validation["owner_acceptance"] == "PENDING_IMAN_REVIEW", "owner acceptance inferred")
    require(manifest["scope"] == "STAGE24_ONLY_OVERLAY", "package scope drift")
    require(manifest["content_file_count"] == len(manifest["files"]), "manifest count mismatch")
    for item in manifest["files"]:
        file_path = ROOT / item["path"]
        require(file_path.is_file(), f"manifest file missing: {item['path']}")
        require(
            hashlib.sha256(file_path.read_bytes()).hexdigest() == item["sha256"],
            f"manifest hash mismatch: {item['path']}",
        )

    sequence = plan["fresh_schema_sequence"]
    require(sequence[-1].endswith("v1.1.sql"), "corrected migration missing")
    require(not any(path.endswith("v1.0.sql") and "007_stage23" in path for path in sequence), "unsafe migration still planned")
    old = (ROOT / "database/postgres/007_stage23_import_pipeline_v1.0.sql").read_text(encoding="utf-8")
    fixed = (ROOT / "database/postgres/007_stage23_import_pipeline_v1.1.sql").read_text(encoding="utf-8")
    require("CREATE TABLE IF NOT EXISTS import_batches (" in old, "historical collision evidence missing")
    require("CREATE TABLE IF NOT EXISTS import_batches (" not in fixed, "collision not corrected")
    require("question_import_batches" in fixed, "replacement table missing")
    require("DROP TABLE" not in fixed.upper() and "TRUNCATE" not in fixed.upper(), "destructive DDL forbidden")

    for relative in (
        "tests/stage24_fixtures.py",
        "tests/stage24_performance_harness.py",
        "tests/test_stage24_unit.py",
        "tests/test_stage24_integration.py",
        "tests/test_stage24_contract.py",
        "tests/test_stage24_e2e.py",
        "tests/test_stage24_performance.py",
        "tests/test_stage24_postgres.py",
        "tools/run_stage24_performance.py",
    ):
        py_compile.compile(str(ROOT / relative), doraise=True)

    print(
        json.dumps(
            {
                "stage": 24,
                "status": "PASS",
                "required_files": len(REQUIRED_FILES),
                "critical_scenarios": len(scenarios),
                "test_layers": len(contract["test_pyramid"]),
                "performance_reference": "PASS_NOT_PRODUCTION_SLA",
                "live_stack_evidence": "PENDING",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
