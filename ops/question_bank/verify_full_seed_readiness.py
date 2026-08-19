#!/usr/bin/env python3
"""Static readiness gate for the canonical Question Bank repository seed.

Read-only:
- does not mutate question CSVs
- does not mutate the database
- does not execute Stage23 Import/Preview/Commit

This version is compatible with the repository's current seed catalog keys:
question_count, sources, validation, stage23_status
and Stage10 columns:
external_id, lesson_code, ...
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
LESSON_RE = re.compile(r"(?:^|/)L(\d{2})-L(\d{2})(?:$|/)")


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
    return Path(__file__).resolve().parents[2]


def batch_from_external_id(value: str) -> int | None:
    m = BATCH_RE.search(value or "")
    return int(m.group(1)) if m else None


def derive_expected_lesson_count(catalog: dict[str, Any]) -> int | None:
    explicit = catalog.get("expected_lesson_count")
    if explicit not in (None, ""):
        return int(explicit)
    scope = str(catalog.get("scope") or "")
    m = re.search(r"L(\d{2})-L(\d{2})", scope)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    return hi - lo + 1 if hi >= lo else None


def read_source(repo: Path, rel: str) -> dict[str, Any]:
    path = repo / rel
    if not path.exists():
        return {"path": rel, "exists": False}

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames or []
        rows = list(reader)

    batches: list[int] = []
    lessons: set[str] = set()
    external_ids: list[str] = []

    for row in rows:
        external_id = (
            row.get("external_id")
            or row.get("question_external_id")
            or ""
        ).strip()
        external_ids.append(external_id)

        batch = batch_from_external_id(external_id)
        if batch is not None:
            batches.append(batch)

        lesson = (
            row.get("lesson_code")
            or row.get("lesson_no")
            or row.get("lesson_id")
            or ""
        ).strip()
        if lesson:
            lessons.add(lesson)

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


def load_integrity_manifest(
    repo: Path, path_arg: str | None
) -> tuple[Path, dict[str, Any] | None]:
    if path_arg:
        p = Path(path_arg)
        if not p.is_absolute():
            p = (repo / p).resolve()
    else:
        p = repo / (
            "data/question_bank/full/v1.0/validation/"
            "question_bank_seed_integrity_manifest_v1.0.json"
        )
    return p, load_json(p) if p.exists() else None


def compare_integrity(
    source_results: list[dict[str, Any]],
    manifest: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not manifest:
        return [{"code": "INTEGRITY_MANIFEST_MISSING", "severity": "warning"}]

    expected = {
        x.get("path"): x
        for x in manifest.get("sources", [])
        if isinstance(x, dict) and x.get("path")
    }
    issues: list[dict[str, Any]] = []

    for src in source_results:
        if not src.get("exists"):
            continue
        exp = expected.get(src["path"])
        if not exp:
            issues.append({
                "code": "INTEGRITY_SOURCE_NOT_IN_MANIFEST",
                "severity": "error",
                "path": src["path"],
            })
            continue
        if exp.get("sha256") != src.get("sha256"):
            issues.append({
                "code": "INTEGRITY_SHA256_MISMATCH",
                "severity": "error",
                "path": src["path"],
            })
        if int(exp.get("rows", -1)) != int(src.get("rows", -2)):
            issues.append({
                "code": "INTEGRITY_ROW_COUNT_MISMATCH",
                "severity": "error",
                "path": src["path"],
            })
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
        "checker_version": "v1.1",
        "repo_root": str(repo),
        "catalog": args.catalog,
        "stage23": STAGE23_MARKER,
        "mutates_repository": False,
        "issues": [],
    }

    if not catalog_path.exists():
        report["issues"].append({
            "code": "CATALOG_MISSING",
            "severity": "error",
            "path": args.catalog,
        })
        report["status"] = "FAIL"
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 2

    catalog = load_json(catalog_path)
    sources = catalog.get("sources") or []
    declared_rows = catalog.get("question_count", catalog.get("canonical_row_count"))
    expected_lesson_count = derive_expected_lesson_count(catalog)
    validation_rel = catalog.get("validation", catalog.get("validation_artifact"))

    report["catalog_version"] = catalog.get("catalog_version")
    report["catalog_declared_rows"] = declared_rows
    report["catalog_expected_lesson_count"] = expected_lesson_count
    report["catalog_sources"] = sources

    if str(catalog.get("repository_source_status") or "") != "DRAFT":
        report["issues"].append({
            "code": "CATALOG_SOURCE_STATUS_NOT_DRAFT",
            "severity": "error",
            "actual": catalog.get("repository_source_status"),
        })

    if str(catalog.get("stage23_status") or "") != STAGE23_MARKER:
        report["issues"].append({
            "code": "CATALOG_STAGE23_MARKER_MISMATCH",
            "severity": "error",
            "actual": catalog.get("stage23_status"),
        })

    if not isinstance(sources, list) or not sources:
        report["issues"].append({
            "code": "CATALOG_HAS_NO_SOURCES",
            "severity": "error",
        })
        sources = []

    source_results = [read_source(repo, str(rel)) for rel in sources]
    slim_sources = []
    all_external_ids: list[str] = []
    lesson_set: set[str] = set()
    batch_values: list[int] = []

    for src in source_results:
        if not src.get("exists"):
            report["issues"].append({
                "code": "SOURCE_MISSING",
                "severity": "error",
                "path": src["path"],
            })
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

        slim_sources.append({
            k: v
            for k, v in src.items()
            if k not in {"external_ids", "lessons", "columns"}
        })

    actual_rows = sum(
        int(x.get("rows", 0))
        for x in source_results
        if x.get("exists")
    )
    actual_unique_lessons = len(lesson_set)
    actual_batch_min = min(batch_values) if batch_values else None
    actual_batch_max = max(batch_values) if batch_values else None

    report["source_summary"] = slim_sources
    report["actual_rows"] = actual_rows
    report["actual_unique_lessons"] = actual_unique_lessons
    report["actual_batch_min"] = (
        f"B{actual_batch_min:03d}" if actual_batch_min is not None else None
    )
    report["actual_batch_max"] = (
        f"B{actual_batch_max:03d}" if actual_batch_max is not None else None
    )

    if declared_rows is None:
        report["issues"].append({
            "code": "CATALOG_QUESTION_COUNT_MISSING",
            "severity": "error",
        })
    elif int(declared_rows) != actual_rows:
        report["issues"].append({
            "code": "CATALOG_ROW_COUNT_MISMATCH",
            "severity": "error",
            "declared": declared_rows,
            "actual": actual_rows,
        })

    if (
        expected_lesson_count is not None
        and expected_lesson_count != actual_unique_lessons
    ):
        report["issues"].append({
            "code": "CATALOG_LESSON_COUNT_MISMATCH",
            "severity": "error",
            "declared": expected_lesson_count,
            "actual": actual_unique_lessons,
        })

    nonempty_ids = [x for x in all_external_ids if x]
    if len(nonempty_ids) != len(all_external_ids):
        report["issues"].append({
            "code": "EMPTY_QUESTION_EXTERNAL_ID",
            "severity": "error",
            "count": len(all_external_ids) - len(nonempty_ids),
        })

    seen: set[str] = set()
    duplicates: set[str] = set()
    for external_id in nonempty_ids:
        if external_id in seen:
            duplicates.add(external_id)
        seen.add(external_id)
    if duplicates:
        report["issues"].append({
            "code": "DUPLICATE_QUESTION_EXTERNAL_ID",
            "severity": "error",
            "count": len(duplicates),
            "sample": sorted(duplicates)[:20],
        })

    if not validation_rel:
        report["issues"].append({
            "code": "VALIDATION_ARTIFACT_PATH_MISSING_FROM_CATALOG",
            "severity": "error",
        })
    else:
        vp = repo / str(validation_rel)
        if not vp.exists():
            report["issues"].append({
                "code": "VALIDATION_ARTIFACT_MISSING",
                "severity": "error",
                "path": validation_rel,
            })
        else:
            validation = load_json(vp)
            vstatus = validation.get("status")
            vrows = (
                validation.get("scope", {}).get("question_count")
                if isinstance(validation.get("scope"), dict)
                else None
            )
            vstage23 = (
                validation.get("stage23", {}).get("status")
                if isinstance(validation.get("stage23"), dict)
                else None
            )
            schema = validation.get("schema") or {}

            report["validation_artifact"] = {
                "path": str(validation_rel),
                "status": vstatus,
                "reported_rows": vrows,
                "sha256": sha256_file(vp),
                "stage23": vstage23,
            }

            if vstatus != "PASS_STATIC_CONSOLIDATION":
                report["issues"].append({
                    "code": "VALIDATION_STATUS_NOT_PASS_STATIC_CONSOLIDATION",
                    "severity": "error",
                    "actual": vstatus,
                })
            if vrows is None or int(vrows) != actual_rows:
                report["issues"].append({
                    "code": "VALIDATION_ROW_SCOPE_DRIFT",
                    "severity": "error",
                    "reported": vrows,
                    "actual": actual_rows,
                })
            if vstage23 != STAGE23_MARKER:
                report["issues"].append({
                    "code": "VALIDATION_STAGE23_MARKER_MISMATCH",
                    "severity": "error",
                    "actual": vstage23,
                })
            if (
                schema.get("master_header_matches") is not True
                or int(schema.get("actual_column_count", 0)) != EXPECTED_STAGE10_COLUMNS
            ):
                report["issues"].append({
                    "code": "VALIDATION_STAGE10_SCHEMA_NOT_CONFIRMED",
                    "severity": "error",
                })

    manifest_path, integrity = load_integrity_manifest(
        repo, args.integrity_manifest
    )
    report["integrity_manifest"] = str(manifest_path)
    report["issues"].extend(compare_integrity(source_results, integrity))

    if not args.skip_stage6_validator:
        validator = repo / "ops/question_bank/validate_seed_stage6_compatibility.py"
        if not validator.exists():
            report["issues"].append({
                "code": "STAGE6_VALIDATOR_MISSING",
                "severity": "error",
            })
        else:
            proc = subprocess.run(
                [sys.executable, str(validator)],
                cwd=repo,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                stage6_payload = json.loads(proc.stdout)
            except Exception:
                stage6_payload = None

            stage6_summary = {
                "returncode": proc.returncode,
                "status": (
                    stage6_payload.get("status")
                    if isinstance(stage6_payload, dict)
                    else None
                ),
                "question_count": (
                    stage6_payload.get("question_count")
                    if isinstance(stage6_payload, dict)
                    else None
                ),
                "not_suitable_count": (
                    stage6_payload.get("not_suitable_count")
                    if isinstance(stage6_payload, dict)
                    else None
                ),
                "missing_rule_count": (
                    stage6_payload.get("missing_rule_count")
                    if isinstance(stage6_payload, dict)
                    else None
                ),
                "conditional_count_for_explicit_review": (
                    stage6_payload.get("conditional_count_for_explicit_review")
                    if isinstance(stage6_payload, dict)
                    else None
                ),
            }
            if isinstance(stage6_payload, dict):
                stage6_summary["not_suitable_sample"] = (
                    stage6_payload.get("not_suitable") or []
                )[:20]
                stage6_summary["missing_rules_sample"] = (
                    stage6_payload.get("missing_rules") or []
                )[:20]
            else:
                stage6_summary["output_tail"] = proc.stdout[-4000:]

            report["stage6_validator"] = stage6_summary

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

    hard_errors = [
        issue
        for issue in report["issues"]
        if issue.get("severity") == "error"
    ]
    report["status"] = (
        "PASS"
        if not hard_errors and (full_complete or not args.require_full)
        else "FAIL"
    )

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
