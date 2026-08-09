from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from backend.projections import find_forbidden_preanswer_fields, public_attempt_question
from stage24_fixtures import question_snapshot


def operations(spec):
    for path, item in spec["paths"].items():
        for method, operation in item.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                yield method.upper(), path, operation


class Stage24ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = yaml.safe_load((ROOT / "api/stage21_core_api_spec_v1.0.yaml").read_text(encoding="utf-8"))
        cls.import_api = yaml.safe_load((ROOT / "api/stage23_import_api_spec_v1.0.yaml").read_text(encoding="utf-8"))
        cls.plan = json.loads((ROOT / "config/stage24_migration_plan_v1.0.json").read_text(encoding="utf-8"))

    def test_preanswer_runtime_and_schema_do_not_leak_answer_keys(self):
        projection = public_attempt_question(question_snapshot())
        self.assertEqual(find_forbidden_preanswer_fields(projection), [])
        forbidden = {
            "correct_option_id",
            "is_correct",
            "full_explanation",
            "explanation",
            "misconception_id",
            "answer_key",
        }
        schemas = self.core["components"]["schemas"]
        self.assertFalse(forbidden & set(schemas["AttemptQuestion"]["properties"]))
        self.assertFalse(forbidden & set(schemas["AttemptOption"]["properties"]))
        self.assertTrue(
            {"is_correct", "correct_option_id"}
            <= set(schemas["AnswerFeedback"]["properties"])
        )

    def test_api_operations_have_unique_ids_responses_and_security(self):
        combined = list(operations(self.core)) + list(operations(self.import_api))
        operation_ids = [operation["operationId"] for _, _, operation in combined]
        self.assertEqual(len(operation_ids), len(set(operation_ids)))
        for _, _, operation in combined:
            self.assertTrue(operation["responses"])
        self.assertEqual(self.import_api["security"], [{"bearerAuth": []}])
        for _, _, operation in operations(self.import_api):
            self.assertTrue(operation["x-roles"])

    def test_stage23_commit_and_rollback_contracts_require_idempotency(self):
        for path in ("/admin/imports/{batchId}/commit", "/admin/imports/{batchId}/rollback"):
            operation = self.import_api["paths"][path]["post"]
            self.assertEqual(operation["x-idempotency"], "REQUIRED")
            refs = {parameter.get("$ref") for parameter in operation["parameters"]}
            self.assertIn("#/components/parameters/IdempotencyKey", refs)

    def test_migration_collision_is_detected_and_non_destructively_replaced(self):
        base = (ROOT / "database/postgres/001_stage12_schema_v0.9.sql").read_text(encoding="utf-8")
        old = (ROOT / "database/postgres/007_stage23_import_pipeline_v1.0.sql").read_text(encoding="utf-8")
        fixed = (ROOT / "database/postgres/007_stage23_import_pipeline_v1.1.sql").read_text(encoding="utf-8")
        base_match = re.search(r"CREATE TABLE IF NOT EXISTS import_batches\((.*?)\);", base, re.S)
        old_match = re.search(r"CREATE TABLE IF NOT EXISTS import_batches \((.*?)\n\);", old, re.S)
        self.assertIsNotNone(base_match)
        self.assertIsNotNone(old_match)
        self.assertIn("content_version", base_match.group(1))
        self.assertNotIn("raw_sha256", base_match.group(1))
        self.assertIn("raw_sha256", old_match.group(1))
        self.assertNotEqual(base_match.group(1), old_match.group(1))
        self.assertNotIn("CREATE TABLE IF NOT EXISTS import_batches (", fixed)
        for table in (
            "question_import_batches",
            "question_import_batch_rows",
            "question_import_batch_events",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", fixed)
        sequence = self.plan["fresh_schema_sequence"]
        self.assertNotIn("database/postgres/007_stage23_import_pipeline_v1.0.sql", sequence)
        self.assertEqual(sequence[-1], "database/postgres/007_stage23_import_pipeline_v1.1.sql")


if __name__ == "__main__":
    unittest.main()
