from __future__ import annotations

import json
import os
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
POSTGRES_DSN = os.environ.get("GMP_STAGE24_POSTGRES_DSN")


@unittest.skipUnless(POSTGRES_DSN, "set GMP_STAGE24_POSTGRES_DSN for live PostgreSQL integration")
class Stage24PostgresIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg

        cls.psycopg = psycopg
        cls.schema = f"stage24_{os.getpid()}"
        cls.connection = psycopg.connect(POSTGRES_DSN, autocommit=True)
        with cls.connection.cursor() as cursor:
            cursor.execute(f'CREATE SCHEMA "{cls.schema}"')
            cursor.execute(f'SET search_path TO "{cls.schema}", public')
        plan = json.loads(
            (ROOT / "config/stage24_migration_plan_v1.0.json").read_text(encoding="utf-8")
        )
        try:
            for relative in plan["fresh_schema_sequence"]:
                sql = (ROOT / relative).read_text(encoding="utf-8")
                with cls.connection.cursor() as cursor:
                    cursor.execute(sql)
        except Exception:
            with cls.connection.cursor() as cursor:
                cursor.execute(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE')
            cls.connection.close()
            raise

    @classmethod
    def tearDownClass(cls):
        if not POSTGRES_DSN:
            return
        with cls.connection.cursor() as cursor:
            cursor.execute(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE')
        cls.connection.close()

    def test_fresh_sequence_preserves_legacy_and_adds_stage23_tables(self):
        expected = {
            "import_batches",
            "question_import_batches",
            "question_import_batch_rows",
            "question_import_batch_events",
        }
        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema=%s",
                (self.schema,),
            )
            tables = {row[0] for row in cursor.fetchall()}
        self.assertTrue(expected <= tables)

    def test_stage23_storage_columns_and_guards_are_installed(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema=%s AND table_name='question_import_batches'",
                (self.schema,),
            )
            columns = {row[0] for row in cursor.fetchall()}
            cursor.execute(
                "SELECT trigger_name FROM information_schema.triggers "
                "WHERE event_object_schema=%s",
                (self.schema,),
            )
            triggers = {row[0] for row in cursor.fetchall()}
        self.assertTrue(
            {"raw_sha256", "confirmation_token_sha256", "semantic_review_count"} <= columns
        )
        self.assertIn("trg_s23_question_import_events_append_only", triggers)
        self.assertIn("trg_s23_question_import_batch_transition", triggers)


if __name__ == "__main__":
    unittest.main()
