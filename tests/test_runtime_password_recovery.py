from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings")

import django

django.setup()

from django.test import override_settings

from backend.django_adapter import runtime_password_recovery as recovery
from backend.errors import APIError


class PasswordRecoveryTests(unittest.TestCase):
    def test_request_payload_normalizes_email(self):
        payload = recovery._validate_request_payload(
            {"email": " Learner@Example.COM ", "locale": "en-CA"}
        )
        self.assertEqual(payload, {"email": "learner@example.com", "locale": "en-CA"})

    def test_confirm_payload_requires_stage21_password_length(self):
        with self.assertRaises(APIError) as raised:
            recovery._validate_confirm_payload(
                {"token": "a" * 43, "new_password": "too-short"}
            )
        self.assertEqual(raised.exception.status, 422)
        self.assertEqual(raised.exception.code, "VALIDATION_ERROR")

    @override_settings(
        APP_ENV="production",
        PASSWORD_RESET_PUBLIC_ORIGIN="https://learn.example.com",
    )
    def test_production_reset_origin_must_be_https_and_fixed(self):
        self.assertEqual(recovery._public_origin(), "https://learn.example.com")

    @override_settings(
        APP_ENV="production",
        PASSWORD_RESET_PUBLIC_ORIGIN="http://learn.example.com",
    )
    def test_production_rejects_http_reset_origin(self):
        with self.assertRaises(APIError) as raised:
            recovery._public_origin()
        self.assertEqual(raised.exception.status, 503)

    def test_request_response_is_generic(self):
        request = type("Request", (), {"data": {"email": "nobody@example.com"}, "request_id": "request-12345"})()
        with patch.object(recovery, "request_password_reset") as handler:
            response = recovery.PasswordResetRequestView().post(request)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["data"]["status"], "ACCEPTED")
        handler.assert_called_once()

    def test_storage_migration_never_has_plain_email_column(self):
        source = (ROOT / "database/postgres/009_password_recovery_v1.0.sql").read_text(encoding="utf-8")
        self.assertIn("email_fingerprint", source)
        self.assertIn("token_hash", source)
        self.assertNotIn(" email text", source.lower())
        self.assertNotIn("raw_token", source.lower())

    def test_confirm_path_revokes_active_sessions(self):
        source = (ROOT / "src/backend/django_adapter/runtime_password_recovery.py").read_text(encoding="utf-8")
        self.assertIn("UPDATE auth_sessions", source)
        self.assertIn("status = 'REVOKED'", source)
        self.assertIn("password_algorithm = 'argon2id'", source)


if __name__ == "__main__":
    unittest.main()
