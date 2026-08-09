from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings"
)

import django

django.setup()

from django.test import override_settings
from rest_framework.response import Response

from backend.django_adapter import runtime_auth
from backend.django_adapter.views import ContractEndpointView
from backend.errors import APIError


USER_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "22222222-2222-4222-8222-222222222222"
NOW = datetime(2026, 8, 9, 22, 30, tzinfo=timezone.utc)


class RuntimeAuthProviderTests(unittest.TestCase):
    def test_register_validation_blocks_role_injection(self):
        with self.assertRaises(APIError) as raised:
            runtime_auth._validate_register_payload(
                {
                    "email": "learner@example.com",
                    "password": "a-secure-password-123",
                    "roles": ["ADMIN"],
                }
            )
        self.assertEqual(raised.exception.status, 422)
        self.assertEqual(raised.exception.code, "VALIDATION_ERROR")

    def test_register_validation_normalizes_email_and_defaults(self):
        payload = runtime_auth._validate_register_payload(
            {
                "email": "  Learner@Example.COM ",
                "password": "a-secure-password-123",
            }
        )
        self.assertEqual(payload["email"], "learner@example.com")
        self.assertEqual(payload["locale"], "fa-IR")
        self.assertEqual(payload["timezone"], "UTC")

    @override_settings(
        STAGE21_JWT_SIGNING_KEY="k" * 64,
        STAGE21_JWT_KEY_ID="unit-v1",
        STAGE21_JWT_ISSUER="grammar-mastery",
        STAGE21_JWT_AUDIENCE="grammar-mastery-api",
        STAGE21_JWT_ACCESS_TTL_SECONDS=900,
        STAGE21_SESSION_TTL_SECONDS=30 * 24 * 60 * 60,
        STAGE21_JWT_PREVIOUS_SIGNING_KEY="",
        STAGE21_JWT_PREVIOUS_KEY_ID="",
    )
    def test_jwt_round_trip_has_stage21_claims(self):
        token = runtime_auth._issue_access_token(
            USER_ID,
            SESSION_ID,
            ["USER"],
            now=NOW,
        )
        claims = runtime_auth._decode_access_token(
            token,
            now=NOW + timedelta(seconds=1),
        )
        self.assertEqual(claims["sub"], USER_ID)
        self.assertEqual(claims["sid"], SESSION_ID)
        self.assertEqual(claims["roles"], ["USER"])
        self.assertEqual(claims["exp"] - claims["iat"], 900)

    @override_settings(
        STAGE21_JWT_SIGNING_KEY="n" * 64,
        STAGE21_JWT_KEY_ID="new-v2",
        STAGE21_JWT_PREVIOUS_SIGNING_KEY="o" * 64,
        STAGE21_JWT_PREVIOUS_KEY_ID="old-v1",
        STAGE21_JWT_ISSUER="grammar-mastery",
        STAGE21_JWT_AUDIENCE="grammar-mastery-api",
        STAGE21_JWT_ACCESS_TTL_SECONDS=900,
        STAGE21_SESSION_TTL_SECONDS=30 * 24 * 60 * 60,
    )
    def test_keyring_accepts_rotation_overlap_configuration(self):
        current, ring = runtime_auth._keyring()
        self.assertEqual(current.kid, "new-v2")
        self.assertEqual(set(ring), {"new-v2", "old-v1"})

    def test_auth_operations_dispatch_to_bound_provider(self):
        view = ContractEndpointView()
        view.operations = {"POST": "registerUser"}
        request = SimpleNamespace(method="POST")
        expected = Response({"ok": True}, status=201)
        with patch.object(
            runtime_auth,
            "register_request",
            return_value=expected,
        ) as handler:
            actual = view._dispatch_contract(request)
        self.assertIs(actual, expected)
        handler.assert_called_once_with(request)

    def test_unbound_non_auth_operation_still_fails_closed(self):
        view = ContractEndpointView()
        view.operations = {"GET": "getDashboard"}
        request = SimpleNamespace(method="GET")
        with self.assertRaises(APIError) as raised:
            view._dispatch_contract(request)
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.code, "DEPENDENCY_UNAVAILABLE")

    def test_runtime_settings_bind_postgres_token_verifier(self):
        settings_source = (
            ROOT / "docker/backend/gmp_runtime/settings.py"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "backend.django_adapter.runtime_auth.verify_authorization_header",
            settings_source,
        )
        self.assertIn("Argon2PasswordHasher", settings_source)

    def test_provider_targets_only_canonical_auth_tables(self):
        source = (
            ROOT / "src/backend/django_adapter/runtime_auth.py"
        ).read_text(encoding="utf-8")
        for table in (
            "users",
            "user_credentials",
            "user_role_assignments",
            "auth_sessions",
        ):
            self.assertIn(table, source)
        self.assertNotIn("auth_user", source)


if __name__ == "__main__":
    unittest.main()
