#!/usr/bin/env python3
"""Read-only, deterministic audit of Grammar Mastery's versioned question sources.

Does NOT access the network/database, publish content, mutate repo files, or fix
Stage 23's manifest blocker. Exit 0 means only SOURCE CHECKS passed.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
import re
import sys
from typing import Any

CATALOG = Path("data/question_bank/full/v1.0/master/question_bank_seed_catalog.json")
STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"
EXPECTED_COLUMNS = 46


def audit(root: Path) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    issues: list[str] = []
    warnings: list[str] = []
    root = root.resolve()

    def check(name: str, condition: bool, message: str) -> None:
        checks.append({"name": name, "result": "PASS" if condition else "FAIL", "detail": message})
        if not condition:
            issues.append(f"{name}: {message}")

    path = root / CATALOG
    if not path.is_file():
        return {"scope": "repository-source-only", "status": "FAIL", "issues": [f"Missing catalog: {CATALOG}"], "warnings": [], "checks": [], "statistics": {}}
    try:
        catalog = json.loads(path.read_text(encoding="utf-8-sig"))
    except (ValueError, UnicodeError) as exc:
        return {"scope": "repository-source-only", "status": "FAIL", "issues": [f"Catalog JSON invalid: {exc}"], "warnings": [], "checks": [], "statistics": {}}

    sources = catalog.get("sources")
    if not isinstance(sources, list) or not sources:
        return {"scope": "repository-source-only", "status": "FAIL", "issues": ["No source file list in catalog"], "warnings": [], "checks": [], "statistics": {}}
    check("source_count", len(sources) == 52, f"Found {len(sources)} lesson-source entries; expected 52")
    check("catalog_status", catalog.get("repository_source_status") == "DRAFT", "Canonical source status should be DRAFT")
    check("source_path_uniqueness", len(sources) == len(set(sources)), "Source file paths must be unique")

    validation_ref = catalog.get("validation")
    validation: dict[str, Any] = {}
    if isinstance(validation_ref, str) and (root / validation_ref).is_file():
        try:
            validation = json.loads((root / validation_ref).read_text(encoding="utf-8-sig"))
        except (ValueError, UnicodeError) as exc:
            issues.append(f"Validation JSON invalid: {exc}")
    else:
        issues.append(f"Missing validation reference: {validation_ref}")

    actual_rows = 0
    counts_by_lesson: Counter[str] = Counter()
    seen_ids: set[str] = set()
    duplicates: list[str] = []
    schema_rows = 0
    bad_status_rows = 0
    bad_options_rows = 0
    bad_lesson_rows = 0
    bad_id_rows = 0
    for source_ref in sources:
        if not isinstance(source_ref, str):
            issues.append("Non-string catalog source path")
            continue
        source = root / source_ref
        try:
            # Refuse absolute and parent-traversal source references.
            source.resolve().relative_to(root)
        except ValueError:
            issues.append(f"Unsafe catalog path outside checkout: {source_ref}")
            continue
        if not source.is_file():
            issues.append(f"Source missing: {source_ref}")
            continue
        match = re.search(r"question_bank_full_(L\d{2})\.csv$", source.name)
        if not match:
            issues.append(f"Unexpected source filename: {source_ref}")
            continue
        lesson_expected = match.group(1)
        try:
            with source.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if reader.fieldnames is None or len(reader.fieldnames) != EXPECTED_COLUMNS:
                    issues.append(f"Invalid CSV header length in {source_ref}: {len(reader.fieldnames or [])}")
                    continue
                fields = set(reader.fieldnames)
                mandatory = {"external_id", "lesson_code", "status", "correct_option", "option_a", "option_b", "option_c", "option_d"}
                if not mandatory.issubset(fields):
                    issues.append(f"Missing mandatory columns in {source_ref}: {sorted(mandatory-fields)}")
                    continue
                for row in reader:
                    actual_rows += 1
                    if None in row or any(v is None for v in row.values()):
                        schema_rows += 1
                    qid = (row.get("external_id") or "").strip()
                    if not qid:
                        bad_id_rows += 1
                    elif qid in seen_ids:
                        if len(duplicates) < 10:
                            duplicates.append(qid)
                    else:
                        seen_ids.add(qid)
                    lesson = (row.get("lesson_code") or "").strip()
                    counts_by_lesson[lesson] += 1
                    if lesson != lesson_expected:
                        bad_lesson_rows += 1
                    if (row.get("status") or "").strip() != "DRAFT":
                        bad_status_rows += 1
                    options = [(row.get(f"option_{c}") or "").strip() for c in "abcd"]
                    key = (row.get("correct_option") or "").strip()
                    if not all(options) or len(set(x.casefold() for x in options)) != 4 or key not in {"A", "B", "C", "D"}:
                        bad_options_rows += 1
        except (OSError, UnicodeError, csv.Error) as exc:
            issues.append(f"Could not parse {source_ref}: {exc}")

    expected = catalog.get("question_count")
    check("row_count", actual_rows == expected, f"Parsed {actual_rows}; catalog declares {expected}")
    check("lesson_coverage", len(counts_by_lesson) == 52, f"Parsed {len(counts_by_lesson)} distinct lessons")
    check("row_schema", schema_rows == 0, f"Malformed-row count: {schema_rows}")
    check("draft_status", bad_status_rows == 0, f"Non-DRAFT rows: {bad_status_rows}")
    check("four_options", bad_options_rows == 0, f"Invalid answer-option rows: {bad_options_rows}")
    check("lesson_code", bad_lesson_rows == 0, f"Rows in wrong lesson source: {bad_lesson_rows}")
    check("external_id", not duplicates and bad_id_rows == 0, f"Duplicate sample: {duplicates}; missing: {bad_id_rows}")

    if validation:
        check("validation_count", validation.get("scope", {}).get("question_count") == actual_rows,
              f"Validation report declares {validation.get('scope', {}).get('question_count')}; parsed {actual_rows}")
        check("validation_schema", validation.get("schema", {}).get("actual_column_count") == EXPECTED_COLUMNS,
              f"Validation report declares {validation.get('schema', {}).get('actual_column_count')} columns")
        check("validation_status", validation.get("status") == "PASS_STATIC_CONSOLIDATION",
              f"Validation status: {validation.get('status')}")
    static_marker = catalog.get("stage23_status")
    validation_marker = (validation.get("stage23") or {}).get("status")
    code_path = root / "ops/question_bank/bootstrap.py"
    code_text = code_path.read_text(encoding="utf-8") if code_path.is_file() else ""
    check("stage23_marker_consistency", static_marker == validation_marker == STAGE23_MARKER and STAGE23_MARKER in code_text,
          "Catalog, validation and bootstrap must currently agree on recorded blocker marker; do not modify it to fake completion")
    if static_marker == STAGE23_MARKER:
        warnings.append("STAGE23_STANDARD_IMPORT_OPEN_GATE: manifest-hash-drift marker remains recorded; this audit does not resolve it")
    warnings.append("PRODUCTION_NOT_AUDITED: static source checks do not verify deployed question counts, learner journeys, backup or security")
    return {
        "scope": "repository-source-only",
        "status": "PASS_STATIC_WITH_OPEN_GATES" if not issues else "FAIL_STATIC",
        "statistics": {
            "catalog_question_count": expected,
            "parsed_question_count": actual_rows,
            "lesson_files": len(sources),
            "lessons_with_rows": len(counts_by_lesson),
            "distinct_external_ids": len(seen_ids),
        },
        "issues": issues,
        "warnings": warnings,
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only canonical source inventory audit (NOT a production certification)")
    parser.add_argument("--root", type=Path, default=Path("."), help="Repository checkout root")
    parser.add_argument("--json-output", type=Path, help="Optional path to save report; no files are written without this flag")
    args = parser.parse_args(argv)
    result = audit(args.root)
    output = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    print(output, end="")
    if args.json_output is not None:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(output, encoding="utf-8")
    return 1 if result["issues"] else 0


if __name__ == "__main__":
    sys.exit(main())
