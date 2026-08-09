from __future__ import annotations

import csv
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings"
)

import django

django.setup()

from backend.django_adapter.permissions import HasStage21Role
from backend.django_adapter.urls import ROUTE_OPERATION_IDS
from backend.security import Principal


class RuntimeApiRoutingHotfixTests(unittest.TestCase):
    def test_every_stage21_operation_is_routed(self):
        with (ROOT / "docs/stages/stage21/resource_map_v1.0.csv").open(
            encoding="utf-8", newline=""
        ) as stream:
            expected = {row["operation_id"] for row in csv.DictReader(stream)}

        self.assertEqual(len(expected), 34)
        self.assertEqual(ROUTE_OPERATION_IDS, expected)

    def test_runtime_mounts_stage21_api_under_api_v1(self):
        source = (ROOT / "docker/backend/gmp_runtime/urls.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('path("api/v1/", include("backend.django_adapter.urls"))', source)

    def test_method_specific_roles_do_not_weaken_admin_post(self):
        permission = HasStage21Role()
        reviewer = Principal(
            user_id="11111111-1111-4111-8111-111111111111",
            session_id="22222222-2222-4222-8222-222222222222",
            roles=("REVIEWER",),
            token_id="33333333-3333-4333-8333-333333333333",
        )
        view = SimpleNamespace(
            required_roles_by_method={
                "GET": ("ADMIN", "CONTENT_EDITOR", "REVIEWER"),
                "POST": ("ADMIN", "CONTENT_EDITOR"),
            }
        )

        self.assertTrue(
            permission.has_permission(
                SimpleNamespace(method="GET", auth=reviewer),
                view,
            )
        )
        self.assertFalse(
            permission.has_permission(
                SimpleNamespace(method="POST", auth=reviewer),
                view,
            )
        )

    def test_public_route_role_still_works(self):
        permission = HasStage21Role()
        view = SimpleNamespace(
            required_roles_by_method={"POST": ("PUBLIC",)}
        )
        self.assertTrue(
            permission.has_permission(
                SimpleNamespace(method="POST", auth=None),
                view,
            )
        )


if __name__ == "__main__":
    unittest.main()
