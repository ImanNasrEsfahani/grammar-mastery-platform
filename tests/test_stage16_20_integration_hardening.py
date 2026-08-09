from copy import deepcopy
import csv
import json
import sqlite3
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from error_review.engine import ReviewContractError, filter_items, materialize_error_items
from spaced_repetition.scheduler import DEFAULT_CONFIG, transition, validate_config


USER_ID = "11111111-1111-4111-8111-111111111111"
LESSON_ID = "4ec05ffb-8465-4c5c-9a50-d67136ad0472"
SUBTOPIC_ID = "cc58425c-1b50-4810-99a1-446683b31f5f"
MISCONCEPTION_ID = "dac62b22-7d9b-540f-b765-e4ad0c1fd476"


def load_json(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def answer_row(n, is_correct):
    return {
        "answer_id": f"aaaaaaaa-aaaa-4aaa-8aaa-{n:012d}",
        "attempt_id": f"bbbbbbbb-bbbb-4bbb-8bbb-{n:012d}",
        "test_question_id": f"cccccccc-cccc-4ccc-8ccc-{n:012d}",
        "answer_sequence": 1,
        "user_id": USER_ID,
        "question_id": f"dddddddd-dddd-4ddd-8ddd-{n:012d}",
        "lesson_id": LESSON_ID,
        "subtopic_id": SUBTOPIC_ID,
        "misconception_id": MISCONCEPTION_ID,
        "difficulty_code": "MEDIUM",
        "is_correct": is_correct,
        "answered_at": f"2026-08-{n:02d}T12:00:00Z",
        "question_status": "PUBLISHED",
        "serving_enabled": 1,
        "content_issue_excluded": 0,
    }


class IntegrationHardening(unittest.TestCase):
    def test_stage16_accepts_sqlite_integer_booleans(self):
        self.assertEqual(materialize_error_items([answer_row(1, 1)]), [])
        self.assertEqual(len(materialize_error_items([answer_row(2, 0)])), 1)

    def test_stage16_rejects_ambiguous_correctness_values(self):
        with self.assertRaises(ReviewContractError):
            materialize_error_items([answer_row(1, "false")])

    def test_stage16_generator_repeat_filter_is_stable(self):
        items = materialize_error_items([answer_row(1, 0), answer_row(2, 0)])
        filtered = filter_items((item for item in items), {"min_repeat_count": 2})
        self.assertEqual(len(filtered), 2)

    def test_stage17_default_config_matches_canonical_json_and_schema(self):
        canonical = load_json("config/stage17_scheduler.json")
        schema = load_json("schemas/stage17_config.schema.json")
        self.assertEqual(DEFAULT_CONFIG, canonical)
        self.assertEqual(set(DEFAULT_CONFIG), set(schema["required"]))
        validate_config(DEFAULT_CONFIG)

    def test_stage17_missing_or_changed_safety_policy_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "REQUIRED_FIELDS"):
            transition(None, {}, config={})
        changed = deepcopy(DEFAULT_CONFIG)
        changed["content_safety"]["exclude_confirmed_content_issue"] = False
        with self.assertRaisesRegex(ValueError, "CONTENT_SAFETY"):
            validate_config(changed)

    def test_stage17_sqlite_due_comparison_is_timezone_safe(self):
        sql = (ROOT / "database/sqlite/004_stage17_spaced_repetition_v0.9.sql").read_text(encoding="utf-8")
        self.assertIn("julianday(rq.due_at)<=julianday('now')", sql)

    def test_stage16_17_sqlite_patches_apply_cleanly(self):
        connection = sqlite3.connect(":memory:")
        connection.executescript(
            """
            PRAGMA foreign_keys=ON;
            CREATE TABLE users(id TEXT PRIMARY KEY);
            CREATE TABLE actors(id TEXT PRIMARY KEY);
            CREATE TABLE user_answers(id TEXT PRIMARY KEY);
            CREATE TABLE test_questions(id TEXT PRIMARY KEY);
            CREATE TABLE questions(id TEXT PRIMARY KEY);
            CREATE TABLE grammar_lessons(id TEXT PRIMARY KEY);
            CREATE TABLE grammar_subtopics(id TEXT PRIMARY KEY);
            CREATE TABLE misconceptions(id TEXT PRIMARY KEY);
            CREATE TABLE question_options(id TEXT PRIMARY KEY);
            CREATE TABLE review_queue(
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              target_type TEXT NOT NULL,
              question_id TEXT,
              subtopic_id TEXT,
              status TEXT NOT NULL,
              due_at TEXT NOT NULL,
              interval_days NUMERIC NOT NULL,
              lapse_count INTEGER NOT NULL DEFAULT 0,
              scheduler_version TEXT NOT NULL
            );
            """
        )
        for path in (
            "database/sqlite/003_stage16_error_review_v0.9.sql",
            "database/sqlite/004_stage17_spaced_repetition_v0.9.sql",
        ):
            connection.executescript((ROOT / path).read_text(encoding="utf-8"))
        self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
        connection.close()

    def test_stage19_supplemental_review_deep_link_is_explicit(self):
        contract = load_json("config/stage19_site_page_contract_v0.9.json")
        with (ROOT / "data/product/stage19_route_map_v0.9.csv").open(encoding="utf-8", newline="") as stream:
            routes = list(csv.DictReader(stream))
        deep_link = "/:locale/review/:group_key"
        self.assertEqual(len(routes), contract["localized_canonical_route_count"])
        self.assertIn(deep_link, contract["parameterized_route_templates"])
        self.assertIn(deep_link, contract["route_map_semantics"]["supplemental_deep_links_not_counted"])

    def test_stage20_bulk_contract_cannot_bypass_stage11(self):
        schema = load_json("schemas/stage20_bulk_import_schema_v1.0.json")
        contract = load_json("config/stage20_admin_contract_v1.0.json")
        row_constraints = schema["properties"]["rows"]["items"]["allOf"]
        self.assertEqual(row_constraints[1]["properties"]["status"]["const"], "DRAFT")
        forbidden = set(contract["bulk_status_policy"]["forbidden_target_statuses"])
        self.assertTrue({"APPROVED", "PUBLISHED", "REJECTED", "RETIRED"} <= forbidden)
        self.assertIn("Stage11", contract["bulk_status_policy"]["transition_gate"])

    def test_stage20_role_and_audit_mappings_preserve_stage12(self):
        contract = load_json("config/stage20_admin_contract_v1.0.json")
        sql = (ROOT / "database/postgres/005_stage20_audit_log_migration_v1.0.sql").read_text(encoding="utf-8")
        self.assertEqual(contract["role_storage_mapping"]["CONTENT_EDITOR"], "CONTENT_AUTHOR")
        self.assertEqual(contract["audit_contract"]["canonical_history_table"], "audit_logs")
        self.assertIn("canonical_audit_log_id bigint NOT NULL UNIQUE REFERENCES audit_logs(id)", sql)

    def test_stage20_openapi_operations_have_responses_and_path_parameters(self):
        api = (ROOT / "api/stage20_admin_api_spec_v1.0.yaml").read_text(encoding="utf-8")
        operations = sum(line.strip() in {"get:", "post:", "patch:"} for line in api.splitlines())
        self.assertEqual(operations, 11)
        self.assertEqual(api.count("responses:"), operations)
        self.assertEqual(api.count("operationId:"), operations)
        self.assertEqual(api.count('$ref: "#/components/parameters/QuestionId"'), 4)
        self.assertIn("securitySchemes:", api)


if __name__ == "__main__":
    unittest.main(verbosity=2)
