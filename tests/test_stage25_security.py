from __future__ import annotations

import hashlib
import json
import unittest

from backend.stage25_security import (
    SecurityPolicyError, UploadGate, UploadScanResult, assert_no_answer_leak,
    redact_sensitive, utc_scan_result, validate_security_headers, verify_backup_manifest,
)


class Stage25SecurityTests(unittest.TestCase):
    def test_sensitive_values_are_redacted_recursively(self):
        source = {"email": "a@example.test", "password": "p", "nested": [{"access_token": "t"}]}
        safe = redact_sensitive(source)
        self.assertEqual(safe["password"], "[REDACTED]")
        self.assertEqual(safe["nested"][0]["access_token"], "[REDACTED]")
        self.assertEqual(source["password"], "p")

    def test_pre_submit_payload_accepts_options_but_rejects_answer_key(self):
        assert_no_answer_leak({"question_id": "q1", "options": [{"id": "a", "text": "x"}]})
        with self.assertRaisesRegex(SecurityPolicyError, "ANSWER_LEAK"):
            assert_no_answer_leak({"question": {"correct_option": "a"}})

    def test_upload_gate_accepts_bound_clean_scan_and_rejects_failures(self):
        content = b"schema_version,stem\nv1,example"
        gate = UploadGate(lambda body: utc_scan_result(body, clean=True))
        self.assertTrue(gate.require_clean(content).clean)
        dirty = UploadGate(lambda body: utc_scan_result(body, clean=False, reason="MALWARE"))
        with self.assertRaisesRegex(SecurityPolicyError, "UPLOAD_REJECTED"):
            dirty.require_clean(content)
        mismatched = UploadGate(lambda body: UploadScanResult("e", "v", True, "now", "0" * 64))
        with self.assertRaisesRegex(SecurityPolicyError, "SCAN_DIGEST_MISMATCH"):
            mismatched.require_clean(content)

    def test_security_headers_have_valid_and_invalid_examples(self):
        valid = {
            "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=()", "Strict-Transport-Security": "max-age=31536000",
        }
        validate_security_headers(valid)
        with self.assertRaisesRegex(SecurityPolicyError, "SECURITY_HEADERS_MISSING"):
            validate_security_headers({"X-Content-Type-Options": "nosniff"})

    def test_restore_manifest_detects_corruption(self):
        files = {"database.dump": b"db", "objects/index.json": b"objects"}
        manifest = json.dumps({"files": {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}}).encode()
        verify_backup_manifest(manifest, files)
        with self.assertRaisesRegex(SecurityPolicyError, "RESTORE_DIGEST_MISMATCH"):
            verify_backup_manifest(manifest, {**files, "database.dump": b"corrupt"})


if __name__ == "__main__":
    unittest.main()
