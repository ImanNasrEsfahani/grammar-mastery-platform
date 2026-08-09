#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def validate(root: Path) -> dict:
    errors: list[str] = []
    workflow = root / ".github/workflows/stage26-release-gate.yml"
    if not workflow.is_file():
        return {"status": "FAIL", "errors": ["missing stage26 workflow"]}

    text = workflow.read_text(encoding="utf-8")
    marker = "  postgres-migration-rehearsal:"
    if marker not in text:
        return {"status": "FAIL", "errors": ["missing postgres-migration-rehearsal job"]}

    section = text.split(marker, 1)[1]
    install = "python -m pip install -r requirements-dev.txt"
    live_test = "test_stage24_postgres.py"

    if install not in section:
        errors.append("postgres-migration-rehearsal must install requirements-dev.txt")
    if live_test not in section:
        errors.append("postgres-migration-rehearsal must run the live Stage24 PostgreSQL test")
    if install in section and live_test in section and section.index(install) > section.index(live_test):
        errors.append("Python dependencies must be installed before the live PostgreSQL test")

    setup_python = 'python-version: "3.12"'
    if setup_python not in section:
        errors.append("postgres rehearsal must pin Python 3.12")

    return {
        "status": "PASS" if not errors else "FAIL",
        "errors": errors,
        "checks": {
            "dependency_install_present": install in section,
            "dependency_install_before_live_test": install in section and live_test in section and section.index(install) < section.index(live_test),
            "live_postgres_test_present": live_test in section,
            "python_3_12_present": setup_python in section,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = validate(args.repo_root.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
