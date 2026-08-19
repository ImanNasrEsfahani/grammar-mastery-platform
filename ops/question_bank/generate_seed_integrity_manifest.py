#!/usr/bin/env python3
"""Generate cryptographic integrity evidence for the canonical seed shards.

Run this only after the intended canonical repairs/assembly and validation.
It does not alter question CSV files and does not execute Stage 23.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

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
    return Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root")
    ap.add_argument(
        "--catalog",
        default="data/question_bank/full/v1.0/master/question_bank_seed_catalog.json",
    )
    ap.add_argument(
        "--output",
        default="data/question_bank/full/v1.0/validation/question_bank_seed_integrity_manifest_v1.0.json",
    )
    args = ap.parse_args()

    root = repo_root(args.repo_root)
    catalog_path = root / args.catalog
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

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
        entries.append({"path": rel, "rows": rows, "sha256": digest})

    validation_rel = catalog.get("validation_artifact")
    validation = None
    if validation_rel:
        vp = root / validation_rel
        if vp.exists():
            validation = {"path": validation_rel, "sha256": sha256_file(vp)}

    payload = {
        "manifest_version": "question-bank-seed-integrity-v1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "catalog": {
            "path": args.catalog,
            "catalog_version": catalog.get("catalog_version"),
            "declared_rows": catalog.get("canonical_row_count"),
            "expected_lesson_count": catalog.get("expected_lesson_count"),
            "sha256": sha256_file(catalog_path),
        },
        "sources": entries,
        "actual_total_rows": total_rows,
        "aggregate_digest": aggregate.hexdigest(),
        "validation_artifact": validation,
        "stage23": STAGE23_MARKER,
        "note": "Generated after canonical assembly/repairs; no Stage23 import/commit executed.",
    }

    if int(catalog.get("canonical_row_count", -1)) != total_rows:
        raise SystemExit(
            f"catalog row-count mismatch: declared={catalog.get('canonical_row_count')} actual={total_rows}"
        )

    out = root / args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
