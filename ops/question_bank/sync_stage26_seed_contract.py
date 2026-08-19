#!/usr/bin/env python3
"""Synchronize stale Stage 26 seed-count evidence with the canonical catalog.

Default mode is preview-only. Use --write to modify the local contract file.
No question content, DB state, or Stage23 resource is changed.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"


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
        "--contract",
        default="config/stage26_operations_contract_v1.0.json",
    )
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    root = repo_root(args.repo_root)
    catalog = json.loads((root / args.catalog).read_text(encoding="utf-8"))
    contract_path = root / args.contract
    contract = json.loads(contract_path.read_text(encoding="utf-8"))

    count = int(catalog["canonical_row_count"])
    lessons = int(catalog["expected_lesson_count"])
    catalog_version = catalog.get("catalog_version", "unknown")

    changes = []

    def set_if_present(obj, key, value, path):
        if isinstance(obj, dict) and key in obj and obj[key] != value:
            changes.append({"path": path + "." + key, "old": obj[key], "new": value})
            obj[key] = value

    upstream = contract.get("upstream_invariants", {})
    set_if_present(
        upstream,
        "published_question_inventory_after_default_migration",
        count,
        "upstream_invariants",
    )

    evidence = contract.get("evidence_summary", {})
    set_if_present(evidence, "question_bank_bootstrap_rows", count, "evidence_summary")
    set_if_present(evidence, "question_bank_bootstrap_published_rows", count, "evidence_summary")

    policy = contract.get("canonical_data_bootstrap_policy", {})
    if isinstance(policy, dict) and "postcondition" in policy:
        new_text = (
            f"exactly {count:,} canonical Question Bank rows declared by "
            f"{catalog_version} are present and published; expected lesson count={lessons}. "
            "The count/scope must be synchronized from the canonical seed catalog rather than hard-coded."
        )
        if policy["postcondition"] != new_text:
            changes.append({
                "path": "canonical_data_bootstrap_policy.postcondition",
                "old": policy["postcondition"],
                "new": new_text,
            })
            policy["postcondition"] = new_text

    # Preserve a machine-readable synchronization record without inventing a new runtime dependency.
    sync_meta = {
        "source_catalog": args.catalog,
        "catalog_version": catalog_version,
        "canonical_row_count": count,
        "expected_lesson_count": lessons,
        "stage23": STAGE23_MARKER,
    }
    old_meta = contract.get("question_bank_seed_catalog_sync")
    if old_meta != sync_meta:
        changes.append({
            "path": "question_bank_seed_catalog_sync",
            "old": old_meta,
            "new": sync_meta,
        })
        contract["question_bank_seed_catalog_sync"] = sync_meta

    print(json.dumps({"write": args.write, "changes": changes}, ensure_ascii=False, indent=2))

    if args.write:
        contract_path.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"updated: {contract_path}")
    else:
        print("preview only; rerun with --write to update the local contract")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
