from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from stage24_fixtures import PERFORMANCE
from stage24_performance_harness import run_reference_baseline


class Stage24PerformanceTests(unittest.TestCase):
    def test_production_scale_synthetic_reference_guardrails(self):
        result = run_reference_baseline(PERFORMANCE)
        self.assertEqual(result["volume"]["question_bank_rows"], 10636)
        self.assertEqual(result["volume"]["dashboard_mastery_scopes"], 304)
        self.assertEqual(result["volume"]["dashboard_history_points"], 10636)
        self.assertTrue(result["selection"]["pass"], result["selection"])
        self.assertTrue(result["dashboard"]["pass"], result["dashboard"])
        self.assertTrue(result["overall_pass"])
        self.assertEqual(result["production_sla"], "NOT_CLAIMED")


if __name__ == "__main__":
    unittest.main()
