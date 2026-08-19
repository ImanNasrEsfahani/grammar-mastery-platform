#!/usr/bin/env python3
"""Static/full readiness gate for the canonical Question Bank.

Read-only: this script does not mutate question content or database state.
It intentionally does not execute Stage 23.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

FULL_ROWS = 10_636
FULL_BATCH_MIN = 1
FULL_BATCH_MAX = 238
FULL_LESSONS = 52
STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"
EXPECTED_STAGE10_COLUMNS = 46
BATCH_RE = re.compile(r"(?:^|-)B(\d{3})(?:-|$)")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_repo_root(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    # Intended location: <repo>/ops/question_bank/verify_full_seed_readiness.py
    return Path(__file__).resolve().parents[2]


def max_batch_from_external_id(value: str) -> int | None:
    m = BATCH_RE.search(value or "")
    return int(m.group(1)) if m else None


def read_source(repo: Path, rel: str) -> dict[str, Any]:
    path = repo / rel
    if not path.exists():
        return {"path": rel, "exists": False}

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames or []
        rows = list(reader)

    batches = []
    lessons = set()
    external_ids = []
    for row in rows:
        external_id = (row.get("question_external_id") or "").strip()
        external_ids.append(external_id)
        batch = max_batch_from_external_id(external_id)
        if batch is not None:
            batches.append(batch)
        lesson_no = (row.get("lesson_no") or "").strip()
        if lesson_no:
            lessons.add(lesson_no)

    return {
        "path": rel,
        "exists": True,
        "rows": len(rows),
        "column_count": len(fields),
        "columns": fields,
        "sha256": sha256_file(path),
        "batch_min": min(batches) if batches else None,
        "batch_max": max(batches) if batches else None,
        "lessons": sorted(lessons),
        "external_ids": external_ids,
    }


def load_integrity_manifest(repo: Path, path_arg: str | None) -> tuple[Path | None, dict[str, Any] | None]:
    if path_arg:
        p = (repo / path_arg).resolve() if not Path(path_arg).is_absolute() else Path(path_arg)
    else:
        p = repo / "data/question_bank/full/v1.0/validation/question_bank_seed_integrity_manifest_v1.0.json"
    if not p.exists():
        return p, None
    return p, load_json(p)


def compare_integrity(source_results: list[dict[str, Any]], manifest: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not manifest:
        return [{"code": "INTEGRITY_MANIFEST_MISSING", "severity": "warning"}]
    expected = {x["path"]: x for x in manifest.get("sources", [])}
    issues = []
    for src in source_results:
        if not src.get("exists"):
            continue
        exp = expected.get(src["path"])
        if not exp:
            issues.append({"code": "INTEGRITY_SOURCE_NOT_IN_MANIFEST", "severity": "error", "path": src["path"]})
            continue
        if exp.get("sha256") != src.get("sha256"):
            issues.append({"code": "INTEGRITY_SHA256_MISMATCH", "severity": "error", "path": src["path"]})
        if int(exp.get("rows", -1)) != int(src.get("rows", -2)):
            issues.append({"code": "INTEGRITY_ROW_COUNT_MISMATCH", "severity": "error", "path": src["path"]})
    return issues


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root")
    ap.add_argument(
        "--catalog",
        default="data/question_bank/full/v1.0/master/question_bank_seed_catalog.json",
    )
    ap.add_argument("--integrity-manifest")
    ap.add_argument("--require-full", action="store_true")
    ap.add_argument("--skip-stage6-validator", action="store_true")
    ap.add_argument("--output")
    args = ap.parse_args()

    repo = resolve_repo_root(args.repo_root)
    catalog_path = repo / args.catalog
    report: dict[str, Any] = {
        "checker_version": "v1.0",
        "repo_root": str(repo),
        "catalog": args.catalog,
        "stage23": STAGE23_MARKER,
        "mutates_repository": False,
        "issues": [],
    }

    if not catalog_path.exists():
        report["issues"].append({"code": "CATALOG_MISSING", "severity": "error", "path": args.catalog})
        report["status"] = "FAIL"
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 2

    catalog = load_json(catalog_path)
    sources = catalog.get("sources", [])
    report["catalog_version"] = catalog.get("catalog_version")
    report["catalog_declared_rows"] = catalog.get("canonical_row_count")
    report["catalog_expected_lesson_count"] = catalog.get("expected_lesson_count")
    report["catalog_sources"] = sources

    source_results = [read_source(repo, rel) for rel in sources]
    slim_sources = []
    all_external_ids = []
    lesson_set = set()
    batch_values = []

    for src in source_results:
        if not src.get("exists"):
            report["issues"].append({"code": "SOURCE_MISSING", "severity": "error", "path": src["path"]})
            slim_sources.append(src)
            continue

        if src["column_count"] != EXPECTED_STAGE10_COLUMNS:
            report["issues"].append({
                "code": "STAGE10_COLUMN_COUNT_MISMATCH",
                "severity": "error",
                "path": src["path"],
                "expected": EXPECTED_STAGE10_COLUMNS,
                "actual": src["column_count"],
            })

        all_external_ids.extend(src["external_ids"])
        lesson_set.update(src["lessons"])
        if src["batch_min"] is not None:
            batch_values.append(src["batch_min"])
        if src["batch_max"] is not None:
            batch_values.append(src["batch_max"])

        slim_sources.append({k: v for k, v in src.items() if k not in {"external_ids", "lessons", "columns"}})

    actual_rows = sum(int(x.get("rows", 0)) for x in source_results if x.get("exists"))
    actual_unique_lessons = len(lesson_set)
    actual_batch_min = min(batch_values) if batch_values else None
    actual_batch_max = max(batch_values) if batch_values else None

    report["source_summary"] = slim_sources
    report["actual_rows"] = actual_rows
    report["actual_unique_lessons"] = actual_unique_lessons
    report["actual_batch_min"] = f"B{actual_batch_min:03d}" if actual_batch_min is not None else None
    report["actual_batch_max"] = f"B{actual_batch_max:03d}" if actual_batch_max is not None else None

    if int(catalog.get("canonical_row_count", -1)) != actual_rows:
        report["issues"].append({
            "code": "CATALOG_ROW_COUNT_MISMATCH",
            "severity": "error",
            "declared": catalog.get("canonical_row_count"),
            "actual": actual_rows,
        })

    declared_lessons = int(catalog.get("expected_lesson_count", -1))
    if declared_lessons != actual_unique_lessons:
        report["issues"].append({
            "code": "CATALOG_LESSON_COUNT_MISMATCH",
            "severity": "error",
            "declared": declared_lessons,
            "actual": actual_unique_lessons,
        })

    nonempty_ids = [x for x in all_external_ids if x]
    if len(nonempty_ids) != len(all_external_ids):
        report["issues"].append({"code": "EMPTY_QUESTION_EXTERNAL_ID", "severity": "error"})
    duplicates = sorted({x for x in nonempty_ids if nonempty_ids.count(x) > 1})
    if duplicates:
        report["issues"].append({
            "code": "DUPLICATE_QUESTION_EXTERNAL_ID",
            "severity": "error",
            "count": len(duplicates),
            "sample": duplicates[:20],
        })

    validation_rel = catalog.get("validation_artifact")
    if validation_rel:
        vp = repo / validation_rel
        if not vp.exists():
            report["issues"].append({"code": "VALIDATION_ARTIFACT_MISSING", "severity": "error", "path": validation_rel})
        else:
            validation = load_json(vp)
            vrows = (
                validation.get("canonical_master", {}).get("rows")
                if isinstance(validation.get("canonical_master"), dict)
                else None
            )
            vmax = validation.get("scope", {}).get("max_batch_id") if isinstance(validation.get("scope"), dict) else None
            report["validation_artifact"] = {
                "path": validation_rel,
                "reported_rows": vrows,
                "reported_max_batch_id": vmax,
                "sha256": sha256_file(vp),
            }
            if vrows is not None and int(vrows) != actual_rows:
                report["issues"].append({
                    "code": "VALIDATION_ROW_SCOPE_DRIFT",
                    "severity": "error",
                    "reported": vrows,
                    "actual": actual_rows,
                })
            expected_max = f"B{actual_batch_max:03d}" if actual_batch_max is not None else None
            if vmax and expected_max and vmax != expected_max:
                report["issues"].append({
                    "code": "VALIDATION_MAX_BATCH_SCOPE_DRIFT",
                    "severity": "error",
                    "reported": vmax,
                    "actual": expected_max,
                })

    manifest_path, integrity = load_integrity_manifest(repo, args.integrity_manifest)
    report["integrity_manifest"] = str(manifest_path) if manifest_path else None
    report["issues"].extend(compare_integrity(source_results, integrity))

    if not args.skip_stage6_validator:
        validator = repo / "ops/question_bank/validate_seed_stage6_compatibility.py"
        if not validator.exists():
            report["issues"].append({"code": "STAGE6_VALIDATOR_MISSING", "severity": "error"})
        else:
            proc = subprocess.run(
                [sys.executable, str(validator)],
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            report["stage6_validator"] = {
                "returncode": proc.returncode,
                "output_tail": proc.stdout[-8000:],
            }
            if proc.returncode != 0:
                report["issues"].append({
                    "code": "STAGE6_COMPATIBILITY_PREFLIGHT_FAILED",
                    "severity": "error",
                })

    report["full_target"] = {
        "rows": FULL_ROWS,
        "batch_min": f"B{FULL_BATCH_MIN:03d}",
        "batch_max": f"B{FULL_BATCH_MAX:03d}",
        "lessons": FULL_LESSONS,
    }
    full_complete = (
        actual_rows == FULL_ROWS
        and actual_batch_min == FULL_BATCH_MIN
        and actual_batch_max == FULL_BATCH_MAX
        and actual_unique_lessons == FULL_LESSONS
    )
    report["full_target_complete"] = full_complete
    if not full_complete:
        report["issues"].append({
            "code": "FULL_BANK_CONTENT_INCOMPLETE",
            "severity": "error" if args.require_full else "info",
            "missing_rows_vs_target": FULL_ROWS - actual_rows,
            "current_batch_max": report["actual_batch_max"],
            "current_lessons": actual_unique_lessons,
        })

    hard_errors = [i for i in report["issues"] if i.get("severity") == "error"]
    report["status"] = "PASS" if not hard_errors and (full_complete or not args.require_full) else "FAIL"

    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if args.output:
        out = Path(args.output)
        if not out.is_absolute():
            out = repo / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(rendered + "\n", encoding="utf-8")

    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
