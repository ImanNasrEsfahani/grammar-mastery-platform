#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REQUIRED_STAGE26_FILES = [
    "config/stage26_operations_contract_v1.0.json",
    "schemas/stage26_release_evidence_v1.0.schema.json",
    "ops/stage26/release_gate.py",
    "ops/stage26/migration_runner.py",
    "ops/stage26/http_smoke.py",
    ".github/workflows/stage26-release-gate.yml",
    "docs/stages/stage26/README.md",
    "docs/stages/stage26/environment_matrix_v1.0.csv",
    "docs/stages/stage26/monitoring_policy_v1.0.md",
    "docs/stages/stage26/backup_policy_v1.0.md",
    "docs/stages/stage26/release_runbook_v1.0.md",
    "docs/stages/stage26/rollback_runbook_v1.0.md",
    "docs/stages/stage26/needs_decision_v1.0.csv",
    "docs/stages/stage26/review_report_v1.0.md",
    "docs/stages/stage26/validation_v1.0.json",
    "ops/stage26/release_evidence_valid_example_v1.0.json",
    "ops/stage26/release_evidence_invalid_example_v1.0.json",
]


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def validate(root: Path, overlay_only: bool = False) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    for rel in REQUIRED_STAGE26_FILES:
        if not (root / rel).is_file():
            errors.append(f"missing Stage26 artifact: {rel}")

    contract_path = root / "config/stage26_operations_contract_v1.0.json"
    if not contract_path.is_file():
        return {"status": "FAIL", "errors": errors, "warnings": warnings}
    contract = json.loads(contract_path.read_text(encoding="utf-8-sig"))
    if contract.get("stage") != 26:
        errors.append("contract.stage != 26")
    if contract.get("release_status") == "PRODUCTION_READY":
        errors.append("reference package must not claim production readiness")

    envs = contract.get("environment_policy", {}).get("allowed", [])
    if envs != ["development", "staging", "production"]:
        errors.append("environment separation contract mismatch")

    policy = contract.get("migration_policy", {})
    sequence = policy.get("canonical_sequence", [])
    if [r.get("order") for r in sequence] != list(range(1, len(sequence) + 1)):
        errors.append("migration order is not contiguous")
    paths = [r.get("path") for r in sequence]
    for forbidden in policy.get("superseded_files_forbidden", []):
        if forbidden in paths:
            errors.append(f"superseded migration included: {forbidden}")

    data_policy = contract.get("canonical_data_bootstrap_policy", {})
    data_sequence = data_policy.get("sequence", [])
    expected_data_paths = [
        "ops/stage12/seed_canonical_reference.py",
        "ops/question_bank/bootstrap.py",
    ]
    if [r.get("order") for r in data_sequence] != [1, 2]:
        errors.append("canonical data bootstrap order mismatch")
    if [r.get("path") for r in data_sequence] != expected_data_paths:
        errors.append("canonical data bootstrap paths mismatch")
    if data_policy.get("runs_by_default_after_schema") is not True:
        errors.append("canonical data bootstrap must run by default")
    if data_policy.get("human_review_claimed") is not False:
        errors.append("canonical SYSTEM publication must not claim human review")
    for relative in expected_data_paths:
        if not (root / relative).is_file():
            errors.append(f"canonical data bootstrap missing: {relative}")

    if overlay_only:
        warnings.append("upstream migration file identity checks skipped in overlay-only mode")
    else:
        for row in sequence:
            path = root / row["path"]
            if not path.is_file():
                errors.append(f"upstream migration missing: {row['path']}")
            elif git_blob_sha(path) != row["git_blob_sha"]:
                errors.append(f"upstream migration identity drift: {row['path']}")

    providers = contract.get("provider_bindings", {})
    if not providers or not all(str(v).startswith("REQUIRED_OWNER_INPUT") for v in providers.values()):
        errors.append("provider-neutral reference package must keep unresolved provider bindings explicit")

    schema = json.loads((root / "schemas/stage26_release_evidence_v1.0.schema.json").read_text(encoding="utf-8-sig"))
    if schema.get("properties", {}).get("schema_version", {}).get("const") != "stage26-release-evidence-v1.0.0":
        errors.append("release evidence schema version mismatch")

    return {"status": "PASS" if not errors else "FAIL", "errors": errors, "warnings": warnings, "migration_count": len(sequence), "provider_decisions_pending": len(providers)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--overlay-only", action="store_true")
    args = parser.parse_args()
    result = validate(args.repo_root.resolve(), args.overlay_only)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
