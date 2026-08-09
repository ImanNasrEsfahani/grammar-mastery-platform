import csv
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_json(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def load_csv(path):
    with (ROOT / path).open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


class Stage18To20Contracts(unittest.TestCase):
    def test_stage18_confidence_gate_matches_stage15(self):
        stage15 = load_json("config/stage15_contract.json")
        stage18 = load_json("config/stage18_contract.json")
        self.assertEqual(
            stage18["kpis"]["lesson_status"]["confidence_gate"],
            stage15["config"]["thresholds"]["min_confidence_for_label"],
        )

    def test_stage18_display_bands_cover_zero_to_100_without_gaps(self):
        bands = load_json("config/stage18_contract.json")["kpis"]["lesson_status"]["bands"]
        self.assertEqual(bands[0]["min_pct"], 0)
        for left, right in zip(bands, bands[1:]):
            self.assertEqual(left["max_exclusive_pct"], right["min_pct"])
        self.assertEqual(bands[-1]["max_inclusive_pct"], 100)

    def test_stage18_prevents_unconfident_weakness_claim(self):
        contract = load_json("config/stage18_contract.json")
        lesson = contract["kpis"]["lesson_status"]
        self.assertEqual(lesson["insufficient_evidence_label"], "INSUFFICIENT_EVIDENCE")
        self.assertIn("do not assign", lesson["rule"])

    def test_stage19_page_and_route_counts(self):
        pages = load_csv("data/product/stage19_page_inventory_v0.9.csv")
        routes = load_csv("data/product/stage19_route_map_v0.9.csv")
        self.assertEqual(len(pages), 12)
        self.assertEqual(len(routes), 26)
        self.assertEqual({row["locale"] for row in routes}, {"en", "fa"})

    def test_stage19_routes_are_unique_and_locale_stable(self):
        routes = load_csv("data/product/stage19_route_map_v0.9.csv")
        paths = [row["route"] for row in routes]
        self.assertEqual(len(paths), len(set(paths)))
        by_locale = {
            locale: {row["route"][3:] for row in routes if row["locale"] == locale}
            for locale in ("en", "fa")
        }
        self.assertEqual(by_locale["en"], by_locale["fa"])

    def test_stage19_navigation_has_no_dangling_page_targets(self):
        pages = {row["page_key"] for row in load_csv("data/product/stage19_page_inventory_v0.9.csv")}
        nav = load_csv("data/product/stage19_navigation_matrix_v0.9.csv")
        for row in nav:
            self.assertIn(row["from_page"], pages)
            self.assertIn(row["primary_target"], pages)
            for target in filter(None, row["secondary_targets"].split("|")):
                self.assertIn(target, pages)

    def test_stage19_parameterized_template_count(self):
        contract = load_json("config/stage19_site_page_contract_v0.9.json")
        self.assertEqual(len(contract["parameterized_route_templates"]), 4)

    def test_stage20_role_separation(self):
        permissions = load_json("config/stage20_admin_contract_v1.0.json")["permissions"]
        self.assertNotIn("CONTENT_EDITOR", permissions["APPROVE_REJECT"])
        self.assertNotIn("REVIEWER", permissions["BULK_IMPORT"])
        self.assertEqual(permissions["RETIRE_IMMEDIATE"], ["ADMIN"])

    def test_stage20_bulk_commit_requires_confirmation(self):
        schema = load_json("schemas/stage20_bulk_import_schema_v1.0.json")
        conditional = schema["allOf"][0]
        self.assertEqual(conditional["if"]["properties"]["mode"]["const"], "COMMIT")
        self.assertIn("confirmation_token", conditional["then"]["required"])

    def test_stage20_admin_api_and_audit_contracts_exist(self):
        api = (ROOT / "api/stage20_admin_api_spec_v1.0.yaml").read_text(encoding="utf-8")
        sql = (ROOT / "database/postgres/005_stage20_audit_log_migration_v1.0.sql").read_text(encoding="utf-8")
        self.assertIn("/admin/imports/preview:", api)
        self.assertIn("/admin/imports/commit:", api)
        self.assertIn("reviewer != author/generator", api)
        self.assertIn("BEFORE UPDATE OR DELETE ON admin_audit_events", sql)


if __name__ == "__main__":
    unittest.main()
