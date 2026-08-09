#!/usr/bin/env python3
"""Canonical PostgreSQL migration runner for Stage 26.

Dry-run by default. Execution relies on libpq PG* environment variables or a
runtime-configured service; connection secrets are never printed by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def load_contract(repo_root: Path) -> dict:
    path = repo_root / "config" / "stage26_operations_contract_v1.0.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verify_plan(repo_root: Path, contract: dict) -> list[str]:
    errors: list[str] = []
    policy = contract["migration_policy"]
    sequence = policy["canonical_sequence"]
    orders = [row["order"] for row in sequence]
    if orders != list(range(1, len(sequence) + 1)):
        errors.append("migration order is not contiguous")
    canonical_paths = {row["path"] for row in sequence}
    for forbidden in policy["superseded_files_forbidden"]:
        if forbidden in canonical_paths:
            errors.append(f"superseded migration is canonical: {forbidden}")
    for row in sequence:
        path = repo_root / row["path"]
        if not path.is_file():
            errors.append(f"missing migration: {row['path']}")
            continue
        actual = git_blob_sha(path)
        if actual != row["git_blob_sha"]:
            errors.append(f"migration identity mismatch: {row['path']}")
    return errors


def staging_evidence_ok(path: Path) -> bool:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from release_gate import evaluate_evidence  # type: ignore
    evidence = json.loads(path.read_text(encoding="utf-8-sig"))
    return evidence.get("target_environment") == "staging" and not evaluate_evidence(evidence)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--target", choices=["staging", "production"], required=True)
    parser.add_argument("--execute", action="store_true", help="Actually invoke psql; default is plan-only dry run")
    parser.add_argument("--confirm-release-id", default="")
    parser.add_argument("--staging-evidence", type=Path)
    parser.add_argument("--backup-id", default="")
    args = parser.parse_args()

    root = args.repo_root.resolve()
    contract = load_contract(root)
    errors = verify_plan(root, contract)
    if errors:
        print(json.dumps({"status": "FAIL", "errors": errors}, indent=2))
        return 2

    sequence = contract["migration_policy"]["canonical_sequence"]
    if not args.execute:
        print(json.dumps({"status": "DRY_RUN", "target": args.target, "plan_version": contract["migration_policy"]["plan_version"], "files": [r["path"] for r in sequence]}, indent=2))
        return 0

    if not args.confirm_release_id.strip():
        print("Refusing execution: --confirm-release-id is required", file=sys.stderr)
        return 2
    if args.target == "production":
        if not args.backup_id.strip():
            print("Refusing production migration: --backup-id is required", file=sys.stderr)
            return 2
        if args.staging_evidence is None or not staging_evidence_ok(args.staging_evidence):
            print("Refusing production migration: accepted staging evidence is required", file=sys.stderr)
            return 2

    # Use libpq PG* runtime variables/service configuration. Never echo connection secrets.
    if not (os.getenv("PGSERVICE") or (os.getenv("PGHOST") and os.getenv("PGDATABASE") and os.getenv("PGUSER"))):
        print("Refusing execution: configure PGSERVICE or PGHOST/PGDATABASE/PGUSER via runtime secret injection", file=sys.stderr)
        return 2

    for row in sequence:
        migration = root / row["path"]
        completed = subprocess.run(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(migration)],
            cwd=root,
            check=False,
        )
        if completed.returncode != 0:
            print(json.dumps({"status": "FAIL", "failed_migration": row["path"], "release_id": args.confirm_release_id}, indent=2))
            return completed.returncode or 2

    print(json.dumps({"status": "PASS", "target": args.target, "release_id": args.confirm_release_id, "plan_version": contract["migration_policy"]["plan_version"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
