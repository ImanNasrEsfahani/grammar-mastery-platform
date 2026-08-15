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

    def test_all_seed_misconceptions_are_resolvable_without_guessing_stage7_identity(self):
        _, rows, _, _ = bootstrap.load_repository_seed(ROOT)
        stage7_dir = ROOT / "data/question_authoring/stage7"
        _, original_rows = bootstrap.read_csv(stage7_dir / "stage7_misconception_catalogue_v0.9.csv")
        _, recovered_rows = bootstrap.read_csv(stage7_dir / "stage7_misconception_catalogue_recovered_v1.0.csv")
        compatibility_rows = bootstrap.load_qbank_compatibility_catalogue(ROOT)

        original_ids = {bootstrap.stage7_value(row, "id") for row in original_rows}
        original_by_key: dict[tuple[str, str], list[str]] = {}
        for row in original_rows:
            key = (bootstrap.stage7_value(row, "subtopic_id"), bootstrap.stage7_value(row, "family"))
            original_by_key.setdefault(key, []).append(bootstrap.stage7_value(row, "id"))
        recovered_by_id = {bootstrap.stage7_value(row, "id"): row for row in recovered_rows}
        compatibility_by_id = {row["misconception_id"].strip(): row for row in compatibility_rows}

        used = {
            row[f"misconception_{letter}_id"].strip()
            for row in rows
            for letter in "abcd"
            if row[f"misconception_{letter}_id"].strip()
        }
        known = original_ids | set(recovered_by_id) | set(compatibility_by_id)
        self.assertFalse(used - known, f"unresolved misconception IDs: {sorted(used - known)[:10]}")

        # Recovered Stage7 identities must still resolve to exactly one historical
        # concept.  Compatibility IDs are explicitly not guessed into Stage7.
        for misconception_id in sorted((used & set(recovered_by_id)) - original_ids):
            recovered = recovered_by_id[misconception_id]
            key = (
                bootstrap.stage7_value(recovered, "subtopic_id"),
                bootstrap.stage7_value(recovered, "family"),
            )
            self.assertEqual(
                1,
                len(original_by_key.get(key, [])),
                f"recovered Stage7 ID has no unique historical alias: {misconception_id} / {key}",
            )

        compatibility_used = used - original_ids - set(recovered_by_id)
        self.assertEqual(set(compatibility_by_id), compatibility_used)
        self.assertEqual(146, len(compatibility_by_id))
        self.assertEqual(
            {bootstrap.QB_COMPATIBILITY_FAMILY},
            {row["family"].strip() for row in compatibility_rows},
        )

        usage: dict[str, list[tuple[str, str, str]]] = {}
        for row in rows:
            for letter in "abcd":
                mid = row[f"misconception_{letter}_id"].strip()
                if mid in compatibility_by_id:
                    usage.setdefault(mid, []).append(
                        (row["external_id"].strip(), row["subtopic_id"].strip(), row["subtopic_code"].strip())
                    )
        for mid, compat in compatibility_by_id.items():
            observed = usage[mid]
            self.assertEqual(compat["first_external_id"].strip(), observed[0][0])
            self.assertEqual(compat["home_subtopic_id"].strip(), observed[0][1])
            self.assertEqual(compat["home_subtopic_code"].strip(), observed[0][2])
            self.assertEqual(int(compat["use_count"]), len(observed))
            self.assertEqual(
                sorted(filter(None, compat["subtopic_codes_seen"].split(";"))),
                sorted({code for _, _, code in observed}),
            )

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
