#!/usr/bin/env python3
"""Generate cryptographic integrity evidence for canonical Question Bank seed shards.

This tool writes only the integrity-manifest JSON requested by --output.
It does not alter question CSV files, the database, or Stage23 runtime state.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def row_count(path: Path) -> int:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return sum(1 for _ in csv.DictReader(fh))


def repo_root(explicit: str | None) -> Path:
    return (
        Path(explicit).resolve()
        if explicit
        else Path(__file__).resolve().parents[2]
    )


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root")
    ap.add_argument(
        "--catalog",
        default="data/question_bank/full/v1.0/master/question_bank_seed_catalog.json",
    )
    ap.add_argument(
        "--output",
        default=(
            "data/question_bank/full/v1.0/validation/"
            "question_bank_seed_integrity_manifest_v1.0.json"
        ),
    )
    args = ap.parse_args()

    root = repo_root(args.repo_root)
    catalog_path = root / args.catalog
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

    declared_rows = catalog.get(
        "question_count",
        catalog.get("canonical_row_count"),
    )
    if declared_rows is None:
        raise SystemExit(
            "seed catalog has neither question_count nor canonical_row_count"
        )

    expected_lessons = derive_expected_lesson_count(catalog)
    validation_rel = catalog.get(
        "validation",
        catalog.get("validation_artifact"),
    )

    entries = []
    aggregate = hashlib.sha256()
    total_rows = 0

    for rel in catalog.get("sources", []):
        path = root / rel
        if not path.exists():
            raise SystemExit(f"missing canonical source: {rel}")

        digest = sha256_file(path)
        rows = row_count(path)
        total_rows += rows

        aggregate.update(rel.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(digest.encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(str(rows).encode("ascii"))

        entries.append({
            "path": rel,
            "rows": rows,
            "sha256": digest,
        })

    validation = None
    if validation_rel:
        vp = root / str(validation_rel)
        if not vp.exists():
            raise SystemExit(
                f"catalog validation artifact missing: {validation_rel}"
            )
        validation = {
            "path": str(validation_rel),
            "sha256": sha256_file(vp),
        }

    if int(declared_rows) != total_rows:
        raise SystemExit(
            "catalog row-count mismatch: "
            f"declared={declared_rows} actual={total_rows}"
        )

    if str(catalog.get("stage23_status") or "") != STAGE23_MARKER:
        raise SystemExit(
            "catalog Stage23 marker is absent or changed"
        )

    payload = {
        "manifest_version": "question-bank-seed-integrity-v1.1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "catalog": {
            "path": args.catalog,
            "catalog_version": catalog.get("catalog_version"),
            "declared_rows": int(declared_rows),
            "expected_lesson_count": expected_lessons,
            "scope": catalog.get("scope"),
            "sha256": sha256_file(catalog_path),
        },
        "sources": entries,
        "actual_total_rows": total_rows,
        "aggregate_digest": aggregate.hexdigest(),
        "validation_artifact": validation,
        "stage23": STAGE23_MARKER,
        "stage23_runtime_executed": False,
        "note": (
            "Generated after canonical assembly/repairs; "
            "no Stage23 Import/Preview/Commit executed."
        ),
    }

    out = root / args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
