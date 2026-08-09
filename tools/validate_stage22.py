#!/usr/bin/env python3
import json
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    test_path = ROOT / "tests/test_stage22_frontend_contract.py"
    spec = importlib.util.spec_from_file_location("test_stage22_frontend_contract", test_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {test_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    summary = {
        "stage": 22,
        "contract_version": "stage22-frontend-v1.0.0",
        "tests_run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "status": "PASS" if result.wasSuccessful() else "FAIL",
        "owner_acceptance": "PENDING_IMAN_REVIEW",
    }
    print(json.dumps(summary, indent=2))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
