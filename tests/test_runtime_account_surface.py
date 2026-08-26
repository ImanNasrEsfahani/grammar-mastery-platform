from __future__ import annotations

from datetime import datetime, timezone
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings")

import django

django.setup()

from backend.django_adapter import runtime_account
from backend.django_adapter.urls import ROUTE_OPERATION_IDS, urlpatterns
from backend.security import Principal


class _Cursor:
    def __init__(self, row):
        self.row = row
        self.executed = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.executed = (sql, params)

    def fetchone(self):
        return self.row


class RuntimeAccountSurfaceTests(unittest.TestCase):
    def test_account_route_is_additive_and_does_not_change_frozen_operation_set(self):
        names = {pattern.name for pattern in urlpatterns}
        self.assertIn("getAccountSummary", names)
        self.assertNotIn("getAccountSummary", ROUTE_OPERATION_IDS)
        self.assertEqual(len(ROUTE_OPERATION_IDS), 34)

    def test_account_projection_exposes_only_header_safe_identity(self):
        user_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
        now = datetime(2026, 8, 26, 12, 30, tzinfo=timezone.utc)
        row = (
            user_id,
            "iman@example.com",
            "Iman",
            "fa-IR",
            "America/Vancouver",
            now,
            now,
        )
        request = SimpleNamespace(
            auth=Principal(
                user_id=str(user_id),
                session_id="22222222-2222-4222-8222-222222222222",
                roles=("USER",),
                token_id="33333333-3333-4333-8333-333333333333",
            ),
            request_id="account-menu-test",
        )

        cursor = _Cursor(row)
        with patch.object(runtime_account.connection, "cursor", return_value=cursor):
            response = runtime_account.account_summary_request(request)

        self.assertEqual(response.status_code, 200)
        data = response.data["data"]
        self.assertEqual(data["id"], str(user_id))
        self.assertEqual(data["email"], "iman@example.com")
        self.assertEqual(data["display_name"], "Iman")
        self.assertEqual(data["locale"], "fa-IR")
        self.assertEqual(data["timezone"], "America/Vancouver")
        self.assertNotIn("password", data)
        self.assertNotIn("roles", data)
        self.assertNotIn("session", data)


if __name__ == "__main__":
    unittest.main()
