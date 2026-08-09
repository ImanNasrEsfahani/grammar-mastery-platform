from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_validator():
    path = ROOT / "tools/validate_stage26_ci_hotfix.py"
    spec = importlib.util.spec_from_file_location("stage26_ci_hotfix_validator", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class Stage26CIHotfixTests(unittest.TestCase):
    def test_postgres_rehearsal_installs_python_dependencies_before_live_test(self):
        validator = load_validator()
        result = validator.validate(ROOT)
        self.assertEqual("PASS", result["status"], result)
        self.assertTrue(result["checks"]["dependency_install_present"])
        self.assertTrue(result["checks"]["dependency_install_before_live_test"])
        self.assertTrue(result["checks"]["live_postgres_test_present"])


if __name__ == "__main__":
    unittest.main()
