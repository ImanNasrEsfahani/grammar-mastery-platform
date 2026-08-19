#!/usr/bin/env python3
"""Synchronize Stage26 Question Bank seed-count evidence with the current catalog.

Default mode is preview-only. Use --write to modify the local contract file.
No question content, database state, or Stage23 runtime resource is changed.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

STAGE23_MARKER = "STAGE23_IMPORT_BLOCKED_BY_MANIFEST_HASH_DRIFT"


def repo_root(explicit: str | None) -> Path:
    return (
        Path(explicit).resolve()
        if explicit
        else Path(__file__).resolve().parents[2]
    )


def derive_lesson_scope(catalog: dict[str, Any]) -> tuple[int | None, str | None]:
    scope = str(catalog.get("scope") or "")
    m = re.search(r"L(\d{2})-L(\d{2})", scope)
    if not m:
        return None, None
    lo, hi = int(m.group(1)), int(m.group(2))
    count = hi - lo + 1 if hi >= lo else None
    return count, f"L{lo:02d}-L{hi:02d}"


def derive_batch_scope(catalog: dict[str, Any]) -> str | None:
    scope = str(catalog.get("scope") or "")
    m = re.search(r"B(\d{3})-B(\d{3})", scope)
    if not m:
        return None
    return f"B{int(m.group(1)):03d}-B{int(m.group(2)):03d}"


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
    catalog = json.loads(
        (root / args.catalog).read_text(encoding="utf-8")
    )
    contract_path = root / args.contract
    contract = json.loads(contract_path.read_text(encoding="utf-8"))

    count_raw = catalog.get(
        "question_count",
        catalog.get("canonical_row_count"),
    )
    if count_raw is None:
        raise SystemExit(
            "seed catalog has neither question_count nor canonical_row_count"
        )
    count = int(count_raw)

    lesson_count, lesson_scope = derive_lesson_scope(catalog)
    batch_scope = derive_batch_scope(catalog)
    catalog_version = catalog.get("catalog_version", "unknown")

    if str(catalog.get("stage23_status") or "") != STAGE23_MARKER:
        raise SystemExit("catalog Stage23 marker is absent or changed")

    changes: list[dict[str, Any]] = []

    def set_value(obj: dict[str, Any], key: str, value: Any, path: str) -> None:
        old = obj.get(key)
        if old != value:
            changes.append({
                "path": f"{path}.{key}",
                "old": old,
                "new": value,
            })
            obj[key] = value

    # Current contract stores this in upstream_runtime_constraints.
    upstream = contract.setdefault("upstream_runtime_constraints", {})
    set_value(
        upstream,
        "published_question_inventory_after_default_migration",
        count,
        "upstream_runtime_constraints",
    )

    if batch_scope and lesson_scope:
        set_value(
            upstream,
            "published_inventory_scope",
            (
                f"{batch_scope} / {lesson_scope} canonical repository "
                "Question Bank"
            ),
            "upstream_runtime_constraints",
        )

    # Update the bootstrap postcondition in the canonical bootstrap sequence.
    policy = contract.get("canonical_data_bootstrap_policy", {})
    sequence = policy.get("sequence", []) if isinstance(policy, dict) else []
    for item in sequence:
        if (
            isinstance(item, dict)
            and item.get("path") == "ops/question_bank/bootstrap.py"
        ):
            new_postcondition = (
                f"all {count} canonical Question Bank rows are "
                "PUBLISHED and serving"
            )
            if item.get("postcondition") != new_postcondition:
                changes.append({
                    "path": (
                        "canonical_data_bootstrap_policy.sequence"
                        "[bootstrap].postcondition"
                    ),
                    "old": item.get("postcondition"),
                    "new": new_postcondition,
                })
                item["postcondition"] = new_postcondition

    sync_meta = {
        "source_catalog": args.catalog,
        "catalog_version": catalog_version,
        "question_count": count,
        "scope": catalog.get("scope"),
        "expected_lesson_count": lesson_count,
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

    print(json.dumps(
        {"write": args.write, "changes": changes},
        ensure_ascii=False,
        indent=2,
    ))

    if args.write:
        contract_path.write_text(
            json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"updated: {contract_path}")
    else:
        print(
            "preview only; rerun with --write to update the local contract"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
