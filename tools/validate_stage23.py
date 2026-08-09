from __future__ import annotations

import json
import hashlib
from pathlib import Path
import py_compile
import sys
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = [
    "config/stage23_import_pipeline_contract_v1.0.json",
    "schemas/stage23_import_batch_v1.0.json",
    "schemas/stage23_preview_report_v1.0.json",
    "api/stage23_import_api_spec_v1.0.yaml",
    "database/postgres/007_stage23_import_pipeline_v1.0.sql",
    "src/backend/import_pipeline/__init__.py",
    "src/backend/import_pipeline/normalization.py",
    "src/backend/import_pipeline/dedupe.py",
    "src/backend/import_pipeline/validator.py",
    "src/backend/import_pipeline/pipeline.py",
    "tests/test_stage23_import_pipeline.py",
    "docs/stages/stage23/README.md",
    "docs/stages/stage23/import_schema_v1.0.md",
    "docs/stages/stage23/preview_report_example_v1.0.json",
    "docs/stages/stage23/batch_audit_v1.0.md",
    "docs/stages/stage23/rollback_strategy_v1.0.md",
    "docs/stages/stage23/needs_decision_v1.0.csv",
    "docs/stages/stage23/review_report_v1.0.md",
    "docs/stages/stage23/validation_v1.0.json",
    "docs/stages/stage23/package_manifest_v1.0.json",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    for relative in REQUIRED_FILES:
        require((ROOT / relative).is_file(), f"missing required file: {relative}")

    contract = json.loads((ROOT / REQUIRED_FILES[0]).read_text(encoding="utf-8"))
    batch_schema = json.loads((ROOT / REQUIRED_FILES[1]).read_text(encoding="utf-8"))
    preview_schema = json.loads((ROOT / REQUIRED_FILES[2]).read_text(encoding="utf-8"))
    validation = json.loads((ROOT / "docs/stages/stage23/validation_v1.0.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "docs/stages/stage23/package_manifest_v1.0.json").read_text(encoding="utf-8"))
    require(contract["contract_version"] == "stage23-import-pipeline-v1.0.0", "contract version drift")
    require([phase["code"] for phase in contract["phases"]] == ["UPLOAD", "PARSE", "NORMALIZE", "VALIDATE", "DEDUPE", "PREVIEW", "COMMIT", "POST_CHECK", "ROLLBACK"], "roadmap phase drift")
    require(contract["input"]["column_count"] == 46, "Stage10 column count drift")
    require(contract["commit_policy"]["partial_commit"] == "FORBIDDEN", "partial commit must fail closed")
    require(batch_schema["properties"]["schema_version"]["const"] == "question-import-schema-v0.9.0", "batch schema mismatch")
    require(preview_schema["properties"]["errors"]["items"]["properties"]["row_number"]["minimum"] == 2, "row-number error contract missing")
    require(validation["owner_acceptance"] == "PENDING_IMAN_REVIEW", "validation must not infer owner acceptance")
    require(manifest["scope"] == "STAGE23_ONLY_OVERLAY", "package scope drift")
    require(manifest["content_file_count"] == len(manifest["files"]), "manifest count mismatch")
    layered_stage24 = (ROOT / "config/stage24_testing_contract_v1.0.json").is_file()
    layered_mutable_paths = {"README.md", "STATUS.md", "tools/validate_stage23.py"}
    for item in manifest["files"]:
        file_path = ROOT / item["path"]
        require(file_path.is_file(), f"manifest file missing: {item['path']}")
        digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
        if layered_stage24 and item["path"] in layered_mutable_paths:
            continue
        require(digest == item["sha256"], f"manifest hash mismatch: {item['path']}")

    api = yaml.safe_load((ROOT / "api/stage23_import_api_spec_v1.0.yaml").read_text(encoding="utf-8"))
    require(api["openapi"] == "3.1.0", "OpenAPI version mismatch")
    expected_paths = {
        "/admin/imports/upload",
        "/admin/imports/{batchId}/preview",
        "/admin/imports/{batchId}/semantic-decisions",
        "/admin/imports/{batchId}/commit",
        "/admin/imports/{batchId}",
        "/admin/imports/{batchId}/rollback",
    }
    require(expected_paths == set(api["paths"]), "Stage23 API path drift")
    require(api["paths"]["/admin/imports/{batchId}/commit"]["post"]["x-idempotency"] == "REQUIRED", "commit idempotency missing")

    sql = (ROOT / "database/postgres/007_stage23_import_pipeline_v1.0.sql").read_text(encoding="utf-8")
    for table in ("import_batches", "import_batch_rows", "import_batch_events"):
        require(f"CREATE TABLE IF NOT EXISTS {table}" in sql, f"missing table {table}")
    require("Stage23 import events are append-only" in sql, "append-only event guard missing")
    require("TRUNCATE" not in sql.upper() and "DROP TABLE" not in sql.upper(), "destructive table DDL forbidden")

    if layered_stage24:
        plan = json.loads(
            (ROOT / "config/stage24_migration_plan_v1.0.json").read_text(encoding="utf-8")
        )
        sequence = plan["fresh_schema_sequence"]
        require(
            "database/postgres/007_stage23_import_pipeline_v1.0.sql" not in sequence,
            "Stage24 plan must supersede the colliding Stage23 v1.0 migration",
        )
        require(
            sequence[-1] == "database/postgres/007_stage23_import_pipeline_v1.1.sql",
            "Stage24 compatible Stage23 replacement missing",
        )
        corrected = (ROOT / sequence[-1]).read_text(encoding="utf-8")
        require(
            "CREATE TABLE IF NOT EXISTS import_batches (" not in corrected,
            "Stage23 replacement must preserve the Stage12 import_batches table",
        )
        for table in (
            "question_import_batches",
            "question_import_batch_rows",
            "question_import_batch_events",
        ):
            require(f"CREATE TABLE IF NOT EXISTS {table}" in corrected, f"missing corrected table {table}")
        require(
            "TRUNCATE" not in corrected.upper() and "DROP TABLE" not in corrected.upper(),
            "corrected Stage23 DDL must remain non-destructive",
        )

    for relative in (
        "src/backend/import_pipeline/normalization.py",
        "src/backend/import_pipeline/dedupe.py",
        "src/backend/import_pipeline/validator.py",
        "src/backend/import_pipeline/pipeline.py",
    ):
        py_compile.compile(str(ROOT / relative), doraise=True)

    sys.path.insert(0, str(ROOT))
    suite = unittest.defaultTestLoader.loadTestsFromName("tests.test_stage23_import_pipeline")
    result = unittest.TextTestRunner(verbosity=0).run(suite)
    require(result.wasSuccessful() and result.testsRun == 20, "Stage23 behavior tests failed or count drifted")
    print(json.dumps({"stage": 23, "status": "PASS_LAYERED_STAGE24" if layered_stage24 else "PASS", "required_files": len(REQUIRED_FILES), "behavior_tests": result.testsRun, "openapi_paths": len(api["paths"]), "pipeline_phases": len(contract["phases"]), "manifest_mode": "STAGE24_MUTABLE_HANDOFF_PATHS_EXEMPT" if layered_stage24 else "PRISTINE_STAGE23"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
