from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


release_gate = load_module("stage26_release_gate", ROOT / "ops/stage26/release_gate.py")
migration_runner = load_module("stage26_migration_runner", ROOT / "ops/stage26/migration_runner.py")
validator = load_module("stage26_validator", ROOT / "tools/validate_stage26.py")


def complete_evidence(target="production"):
    evidence = {
        "schema_version": "stage26-release-evidence-v1.0.0",
        "release_id": "release-2026-08-09-001",
        "git_sha": "f5f281ed52c30667d02e7a8d40d0cbba6d537791",
        "target_environment": target,
        "ci": {"status": "PASS", "stage24": "PASS", "stage25": "PASS", "stage26": "PASS"},
        "migrations": {"plan_version": "stage26-postgres-sequence-v1.1.0", "staging_dry_run": "PASS", "applied": "PASS", "used_superseded_file": False},
        "backup": {"recovery_point_created": True, "recovery_point_id": "rp-001", "restore_drill_status": "PASS", "measured_rto_minutes": 42},
        "providers": {
            "compute": "example-compute",
            "postgres": "example-postgres",
            "backup": "example-backup",
            "secret_manager": "example-secret-manager",
            "malware_scanner": "example-scanner",
            "error_monitoring": "example-monitoring",
            "dns_tls": "example-dns-tls",
            "alert_channel": "example-alerts",
            "admin_mfa": "example-mfa"
        },
        "security": {"https": "PASS", "headers": "PASS", "secret_scan": "PASS"},
        "health": {"status": "PASS", "database_connectivity": "PASS"},
        "smoke": {"status": "PASS", "frontend": "PASS", "safe_api": "PASS"},
        "monitoring": {"configured": True, "release_window_status": "PASS", "rollback_threshold_breached": False},
        "rollback": {"available": True, "previous_revision_recorded": True},
        "release_note": "Synthetic valid test evidence; not a production claim."
    }
    if target == "staging":
        evidence["backup"] = {"recovery_point_created": False, "recovery_point_id": "", "restore_drill_status": "NOT_RUN", "measured_rto_minutes": None}
        evidence["rollback"]["previous_revision_recorded"] = False
    return evidence


class Stage26ReleaseGateTests(unittest.TestCase):
    def test_valid_production_fixture_passes(self):
        self.assertEqual([], release_gate.evaluate_evidence(complete_evidence()))

    def test_valid_staging_fixture_passes(self):
        self.assertEqual([], release_gate.evaluate_evidence(complete_evidence("staging")))

    def test_missing_production_backup_fails(self):
        e = complete_evidence()
        e["backup"]["recovery_point_created"] = False
        self.assertTrue(any("recovery point" in x for x in release_gate.evaluate_evidence(e)))

    def test_failed_staging_rehearsal_fails(self):
        e = complete_evidence()
        e["migrations"]["staging_dry_run"] = "FAIL"
        self.assertTrue(any("staging migration" in x for x in release_gate.evaluate_evidence(e)))

    def test_superseded_migration_flag_fails(self):
        e = complete_evidence()
        e["migrations"]["used_superseded_file"] = True
        self.assertTrue(any("superseded" in x for x in release_gate.evaluate_evidence(e)))

    def test_unresolved_provider_fails(self):
        e = complete_evidence()
        e["providers"]["secret_manager"] = "UNRESOLVED"
        self.assertTrue(any("secret_manager" in x for x in release_gate.evaluate_evidence(e)))

    def test_missing_security_headers_fails(self):
        e = complete_evidence()
        e["security"]["headers"] = "FAIL"
        self.assertTrue(any("security.headers" in x for x in release_gate.evaluate_evidence(e)))

    def test_production_api_block_is_not_accepted(self):
        e = complete_evidence()
        e["smoke"]["safe_api"] = "BLOCKED_BY_UPSTREAM_RUNTIME"
        self.assertTrue(any("smoke.safe_api" in x for x in release_gate.evaluate_evidence(e)))

    def test_rto_over_four_hours_fails(self):
        e = complete_evidence()
        e["backup"]["measured_rto_minutes"] = 241
        self.assertTrue(any("RTO" in x for x in release_gate.evaluate_evidence(e)))

    def test_rollback_threshold_breach_fails(self):
        e = complete_evidence()
        e["monitoring"]["rollback_threshold_breached"] = True
        self.assertTrue(any("rollback threshold" in x for x in release_gate.evaluate_evidence(e)))


class Stage26MigrationTests(unittest.TestCase):
    def test_git_blob_sha_matches_git_formula(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.sql"
            p.write_bytes(b"SELECT 1;\n")
            # Known computed through the same Git object formula independently in the assertion setup.
            import hashlib
            data = p.read_bytes()
            expected = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            self.assertEqual(expected, migration_runner.git_blob_sha(p))

    def test_git_blob_sha_is_stable_across_windows_checkout_line_endings(self):
        with tempfile.TemporaryDirectory() as td:
            lf = Path(td) / "lf.sql"
            crlf = Path(td) / "crlf.sql"
            lf.write_bytes(b"SELECT 1;\nSELECT 2;\n")
            crlf.write_bytes(b"SELECT 1;\r\nSELECT 2;\r\n")
            self.assertEqual(
                migration_runner.git_blob_sha(lf),
                migration_runner.git_blob_sha(crlf),
            )

    def test_contract_rejects_superseded_from_canonical_plan(self):
        contract = json.loads((ROOT / "config/stage26_operations_contract_v1.0.json").read_text())
        canonical = {x["path"] for x in contract["migration_policy"]["canonical_sequence"]}
        forbidden = set(contract["migration_policy"]["superseded_files_forbidden"])
        self.assertFalse(canonical & forbidden)
        self.assertIn("database/postgres/007_stage23_import_pipeline_v1.1.sql", canonical)
        self.assertIn("database/postgres/008_stage27_calibration_v1.0.sql", canonical)

    def test_default_migration_includes_published_question_bank_seed(self):
        commands = migration_runner.canonical_data_commands(
            ROOT,
            target="staging",
            release_id="release-test",
            backup_id="",
        )
        self.assertEqual(
            ["canonical_reference_seed", "published_question_bank_seed"],
            [name for name, _ in commands],
        )
        self.assertIn("--publish-canonical-seed", commands[1][1])

    def test_production_data_seed_receives_release_and_backup_evidence(self):
        commands = migration_runner.canonical_data_commands(
            ROOT,
            target="production",
            release_id="release-prod-1",
            backup_id="backup-prod-1",
        )
        reference_command = commands[0][1]
        self.assertIn("release-prod-1", reference_command)
        self.assertIn("backup-prod-1", reference_command)


class Stage26PackageTests(unittest.TestCase):
    def test_overlay_validator_passes(self):
        result = validator.validate(ROOT, overlay_only=True)
        self.assertEqual("PASS", result["status"], result)
        self.assertEqual(8, result["migration_count"])


if __name__ == "__main__":
    unittest.main()
