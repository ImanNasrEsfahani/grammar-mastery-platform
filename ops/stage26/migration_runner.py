#!/usr/bin/env python3
"""Canonical PostgreSQL migration runner for Stage 26.

Dry-run by default. Execution relies on libpq PG* environment variables or a
runtime-configured service; connection secrets are never printed by this tool.

The ``--bootstrap-empty-production`` mode is a narrow pre-launch exception for
an absolutely empty production database. It does not weaken the normal
production release gate for databases that already contain application schema
or data. The mode requires:
- a recorded backup id,
- an independently migrated rehearsal database,
- canonical migration file identity verification,
- and a zero-relation public schema on the production target.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


CANONICAL_DATA_STEPS = (
    "ops/stage12/seed_canonical_reference.py",
    "ops/question_bank/bootstrap.py",
)


def git_blob_sha(path: Path) -> str:
    # Repository text blobs are pinned after Git's standard CRLF -> LF clean
    # filter. Normalize checkout line endings so the same plan validates on
    # Windows operators and Linux containers.
    data = path.read_bytes().replace(b"\r\n", b"\n")
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
    data_policy = contract.get("canonical_data_bootstrap_policy", {})
    data_sequence = data_policy.get("sequence", [])
    if [row.get("order") for row in data_sequence] != list(range(1, len(data_sequence) + 1)):
        errors.append("canonical data bootstrap order is not contiguous")
    data_paths = tuple(str(row.get("path")) for row in data_sequence)
    if data_paths != CANONICAL_DATA_STEPS:
        errors.append("canonical data bootstrap sequence mismatch")
    for relative in data_paths:
        if not (repo_root / relative).is_file():
            errors.append(f"missing canonical data bootstrap: {relative}")
    return errors


def staging_evidence_ok(path: Path) -> bool:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from release_gate import evaluate_evidence  # type: ignore

    evidence = json.loads(path.read_text(encoding="utf-8-sig"))
    return evidence.get("target_environment") == "staging" and not evaluate_evidence(evidence)


def connection_configured() -> bool:
    return bool(
        os.getenv("PGSERVICE")
        or (os.getenv("PGHOST") and os.getenv("PGDATABASE") and os.getenv("PGUSER"))
    )


def psql_scalar(sql: str, *, database: str | None = None) -> str:
    """Run one read-only validation query without printing connection secrets."""
    env = os.environ.copy()
    if database:
        env["PGDATABASE"] = database
    completed = subprocess.run(
        ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    if completed.returncode != 0:
        raise RuntimeError("psql validation query failed")
    return completed.stdout.strip()


def production_public_schema_is_empty() -> bool:
    count = psql_scalar(
        """
        SELECT count(*)
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r','p','v','m','S','f');
        """
    )
    return count == "0"


def rehearsal_database_ok(database: str) -> bool:
    """Verify that the rehearsal DB reached the end of the canonical Stage 26 plan."""
    sql = """
    SELECT CASE WHEN
      to_regclass('public.users') IS NOT NULL
      AND to_regclass('public.user_credentials') IS NOT NULL
      AND to_regclass('public.user_role_assignments') IS NOT NULL
      AND to_regclass('public.auth_sessions') IS NOT NULL
      AND to_regclass('public.question_import_batches') IS NOT NULL
      AND to_regclass('public.calibration_model_versions') IS NOT NULL
      AND to_regclass('public.system_versions') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.system_versions
        WHERE component='stage21.storage'
          AND version='api-runtime-storage-v1.0.0'
      )
      AND EXISTS (
        SELECT 1 FROM public.system_versions
        WHERE component='stage23.import_storage'
          AND version='stage23-import-storage-v1.1.0'
      )
      AND EXISTS (
        SELECT 1 FROM public.system_versions
        WHERE component='stage12.reference_seed'
          AND version='canonical-knowledge-taxonomy-seed-v1.0.0'
          AND status='APPLIED'
      )
      AND EXISTS (
        SELECT 1 FROM public.system_versions
        WHERE component='question_bank.canonical_seed'
          AND version='canonical-question-bank-publication-v1.0.0'
          AND status='APPLIED'
      )
      AND (SELECT count(*) FROM public.questions WHERE status='PUBLISHED') =
          (SELECT (metadata->>'question_count')::bigint FROM public.system_versions
           WHERE component='question_bank.canonical_seed'
             AND version='canonical-question-bank-publication-v1.0.0'
             AND status='APPLIED' LIMIT 1)
      AND (SELECT count(*) FROM public.v_serving_questions) =
          (SELECT (metadata->>'question_count')::bigint FROM public.system_versions
           WHERE component='question_bank.canonical_seed'
             AND version='canonical-question-bank-publication-v1.0.0'
             AND status='APPLIED' LIMIT 1)
    THEN 'PASS' ELSE 'FAIL' END;
    """
    return psql_scalar(sql, database=database) == "PASS"


def canonical_data_commands(
    repo_root: Path,
    *,
    target: str,
    release_id: str,
    backup_id: str,
) -> list[tuple[str, list[str]]]:
    reference = [
        sys.executable,
        str(repo_root / CANONICAL_DATA_STEPS[0]),
        "--target",
        target,
        "--execute",
    ]
    if target == "production":
        reference.extend(
            [
                "--backup-id",
                backup_id,
                "--confirm-seed-id",
                release_id,
            ]
        )
    question_bank = [
        sys.executable,
        str(repo_root / CANONICAL_DATA_STEPS[1]),
        "--publish-canonical-seed",
    ]
    return [
        ("canonical_reference_seed", reference),
        ("published_question_bank_seed", question_bank),
    ]


def execute_canonical_data(
    repo_root: Path,
    *,
    target: str,
    release_id: str,
    backup_id: str,
) -> str | None:
    for step, command in canonical_data_commands(
        repo_root,
        target=target,
        release_id=release_id,
        backup_id=backup_id,
    ):
        completed = subprocess.run(command, cwd=repo_root, check=False)
        if completed.returncode != 0:
            return step
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--target", choices=["staging", "production"], required=True)
    parser.add_argument("--execute", action="store_true", help="Actually invoke psql; default is plan-only dry run")
    parser.add_argument("--confirm-release-id", default="")
    parser.add_argument("--staging-evidence", type=Path)
    parser.add_argument("--backup-id", default="")
    parser.add_argument(
        "--schema-only",
        action="store_true",
        help=(
            "Apply only SQL schema migrations. By default the canonical reference data "
            "and the repository Question Bank are also seeded and published."
        ),
    )
    parser.add_argument(
        "--bootstrap-empty-production",
        action="store_true",
        help="Allow canonical bootstrap only when the production public schema is completely empty.",
    )
    parser.add_argument(
        "--bootstrap-rehearsal-db",
        default="",
        help="Database name on the same PostgreSQL service where the canonical staging rehearsal already passed.",
    )
    args = parser.parse_args()

    if args.bootstrap_empty_production and args.target != "production":
        print("Refusing bootstrap mode: --bootstrap-empty-production requires --target production", file=sys.stderr)
        return 2

    root = args.repo_root.resolve()
    contract = load_contract(root)
    errors = verify_plan(root, contract)
    if errors:
        print(json.dumps({"status": "FAIL", "errors": errors}, indent=2))
        return 2

    sequence = contract["migration_policy"]["canonical_sequence"]
    if not args.execute:
        payload = {
            "status": "DRY_RUN",
            "target": args.target,
            "plan_version": contract["migration_policy"]["plan_version"],
            "files": [r["path"] for r in sequence],
            "canonical_data_steps": [] if args.schema_only else list(CANONICAL_DATA_STEPS),
        }
        if args.bootstrap_empty_production:
            payload["mode"] = "bootstrap_empty_production"
            payload["rehearsal_db"] = args.bootstrap_rehearsal_db or None
        print(json.dumps(payload, indent=2))
        return 0

    if not args.confirm_release_id.strip():
        print("Refusing execution: --confirm-release-id is required", file=sys.stderr)
        return 2

    if not connection_configured():
        print(
            "Refusing execution: configure PGSERVICE or PGHOST/PGDATABASE/PGUSER via runtime secret injection",
            file=sys.stderr,
        )
        return 2

    if args.target == "production":
        if not args.backup_id.strip():
            print("Refusing production migration: --backup-id is required", file=sys.stderr)
            return 2

        if args.bootstrap_empty_production:
            rehearsal_db = args.bootstrap_rehearsal_db.strip()
            if not rehearsal_db:
                print(
                    "Refusing empty-production bootstrap: --bootstrap-rehearsal-db is required",
                    file=sys.stderr,
                )
                return 2
            current_db = os.getenv("PGDATABASE", "").strip()
            if current_db and rehearsal_db == current_db:
                print(
                    "Refusing empty-production bootstrap: rehearsal database must differ from production database",
                    file=sys.stderr,
                )
                return 2
            try:
                if not production_public_schema_is_empty():
                    print(
                        "Refusing empty-production bootstrap: production public schema is not empty",
                        file=sys.stderr,
                    )
                    return 2
                if not rehearsal_database_ok(rehearsal_db):
                    print(
                        "Refusing empty-production bootstrap: rehearsal database does not prove the canonical migration sequence completed",
                        file=sys.stderr,
                    )
                    return 2
            except RuntimeError as exc:
                print(f"Refusing empty-production bootstrap: {exc}", file=sys.stderr)
                return 2
        else:
            if args.staging_evidence is None or not staging_evidence_ok(args.staging_evidence):
                print(
                    "Refusing production migration: accepted staging evidence is required",
                    file=sys.stderr,
                )
                return 2

    for row in sequence:
        migration = root / row["path"]
        completed = subprocess.run(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-f", str(migration)],
            cwd=root,
            check=False,
        )
        if completed.returncode != 0:
            print(
                json.dumps(
                    {
                        "status": "FAIL",
                        "failed_migration": row["path"],
                        "release_id": args.confirm_release_id,
                    },
                    indent=2,
                )
            )
            return completed.returncode or 2

    if not args.schema_only:
        failed_step = execute_canonical_data(
            root,
            target=args.target,
            release_id=args.confirm_release_id,
            backup_id=args.backup_id,
        )
        if failed_step is not None:
            print(
                json.dumps(
                    {
                        "status": "FAIL",
                        "failed_data_step": failed_step,
                        "release_id": args.confirm_release_id,
                    },
                    indent=2,
                )
            )
            return 2

    result = {
        "status": "PASS",
        "target": args.target,
        "release_id": args.confirm_release_id,
        "plan_version": contract["migration_policy"]["plan_version"],
        "canonical_data": "SKIPPED" if args.schema_only else "APPLIED",
    }
    if args.bootstrap_empty_production:
        result["mode"] = "bootstrap_empty_production"
        result["rehearsal_db"] = args.bootstrap_rehearsal_db
        result["backup_id"] = args.backup_id
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
