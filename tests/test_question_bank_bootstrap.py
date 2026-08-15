from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "ops/question_bank/bootstrap.py"
SPEC = importlib.util.spec_from_file_location("question_bank_bootstrap", MODULE_PATH)
bootstrap = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = bootstrap
SPEC.loader.exec_module(bootstrap)


class QuestionBankBootstrapTests(unittest.TestCase):
    def test_canonical_master_is_complete_and_remains_draft_at_source(self):
        source, rows, validation, _ = bootstrap.load_repository_seed(ROOT)
        self.assertEqual(3640, len(rows))
        self.assertEqual({"DRAFT"}, {row["status"] for row in rows})
        self.assertEqual("PASS_STATIC_CONSOLIDATION", validation["status"])
        self.assertEqual(3640, validation["scope"]["question_count"])
        self.assertEqual("question_bank_seed_catalog.json", source.name)

    def test_migration_publication_is_explicitly_system_owned(self):
        self.assertEqual(
            "canonical-question-bank-publisher-v1.0",
            bootstrap.CANONICAL_PUBLISHER_EXTERNAL_ID,
        )
        args = bootstrap.build_parser().parse_args(["--publish-canonical-seed"])
        self.assertTrue(args.publish_canonical_seed)
        self.assertFalse(args.publish_reviewed)


if __name__ == "__main__":
    unittest.main()
