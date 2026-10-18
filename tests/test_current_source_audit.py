"""Self-contained fixtures for the non-mutating repository source audit."""
from __future__ import annotations

import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from audit_project_static import audit, STAGE23_MARKER


class ReadOnlySourceAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        rel = Path("data/question_bank/full/v1.0/master")
        (self.root / rel).mkdir(parents=True, exist_ok=True)
        (self.root / "data/question_bank/full/v1.0/validation").mkdir(parents=True)
        (self.root / "ops/question_bank").mkdir(parents=True)
        (self.root / "ops/question_bank/bootstrap.py").write_text(
            f'STAGE23_MARKER = "{STAGE23_MARKER}"\n', encoding="utf-8"
        )
        self.columns = ["external_id", "lesson_code", "status", "correct_option", "option_a", "option_b", "option_c", "option_d"] + [f"field_{i}" for i in range(38)]
        sources = []
        for lesson in range(1, 53):
            lesson_code = f"L{lesson:02d}"
            filename = f"question_bank_full_{lesson_code}.csv"
            source = rel / filename
            sources.append(source.as_posix())
            with (self.root / source).open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=self.columns)
                w.writeheader()
                w.writerow({"external_id": f"ID-{lesson:04d}", "lesson_code": lesson_code, "status": "DRAFT", "correct_option": "A", "option_a": "A1", "option_b": "B1", "option_c": "C1", "option_d": "D1"})
        self.catalog = {
            "repository_source_status": "DRAFT", "question_count": 52,
            "sources": sources,
            "validation": "data/question_bank/full/v1.0/validation/current.json",
            "stage23_status": STAGE23_MARKER,
        }
        self.validation = {
            "status": "PASS_STATIC_CONSOLIDATION",
            "scope": {"question_count": 52},
            "schema": {"actual_column_count": 46},
            "stage23": {"status": STAGE23_MARKER},
        }
        self.persist()

    def persist(self) -> None:
        (self.root / "data/question_bank/full/v1.0/master/question_bank_seed_catalog.json").write_text(
            json.dumps(self.catalog), encoding="utf-8"
        )
        (self.root / "data/question_bank/full/v1.0/validation/current.json").write_text(
            json.dumps(self.validation), encoding="utf-8"
        )

    def test_valid_inventory_passes_with_explicit_open_gates(self) -> None:
        result = audit(self.root)
        self.assertEqual(result["status"], "PASS_STATIC_WITH_OPEN_GATES", result["issues"])
        self.assertEqual(result["statistics"]["parsed_question_count"], 52)
        self.assertTrue(any("STAGE23_STANDARD_IMPORT_OPEN_GATE" in x for x in result["warnings"]))
        self.assertTrue(any("PRODUCTION_NOT_AUDITED" in x for x in result["warnings"]))

    def test_duplicate_external_id_fails(self) -> None:
        path = self.root / self.catalog["sources"][1]
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            row = next(reader)
        row["external_id"] = "ID-0001"
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=self.columns)
            writer.writeheader()
            writer.writerow(row)
        result = audit(self.root)
        self.assertEqual(result["status"], "FAIL_STATIC")
        self.assertTrue(any("external_id" in x for x in result["issues"]))

    def test_inconsistent_marker_fails(self) -> None:
        self.validation["stage23"]["status"] = "FIXED_WITHOUT_TESTS"
        self.persist()
        result = audit(self.root)
        self.assertEqual(result["status"], "FAIL_STATIC")
        self.assertTrue(any("stage23_marker_consistency" in x for x in result["issues"]))

    def test_count_mismatch_fails(self) -> None:
        self.catalog["question_count"] = 999
        self.persist()
        result = audit(self.root)
        self.assertEqual(result["status"], "FAIL_STATIC")
        self.assertTrue(any("row_count" in x for x in result["issues"]))


if __name__ == "__main__":
    unittest.main()
