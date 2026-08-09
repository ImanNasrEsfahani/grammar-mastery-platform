from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import csv
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings"
)

import django

django.setup()

from django.http import JsonResponse
from django.test import RequestFactory, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory

from backend.application import InMemoryLearningStore, LearningApplication
from backend.django_adapter.authentication import Stage21BearerAuthentication
from backend.django_adapter.exceptions import stage21_exception_handler
from backend.django_adapter.middleware import RequestIdMiddleware
from backend.django_adapter.permissions import HasStage21Role, enforce_owner
from backend.errors import APIError
from backend.idempotency import InMemoryIdempotencyRegistry, request_hash
from backend.pagination import CursorCodec, paginate, query_fingerprint
from backend.projections import find_forbidden_preanswer_fields, public_attempt_question
from backend.security import (
    FixedWindowRateLimiter,
    InMemoryAuthService,
    InMemorySessionRegistry,
    PasswordHasher,
    Principal,
    TokenSigner,
)


NOW = "2026-08-09T12:00:00Z"
NOW_DT = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"


def load_json(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def load_csv(path):
    with (ROOT / path).open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def load_openapi():
    return yaml.safe_load((ROOT / "api/stage21_core_api_spec_v1.0.yaml").read_text(encoding="utf-8"))


def iter_operations(spec):
    for path, item in spec["paths"].items():
        for method, operation in item.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                yield method.upper(), path, operation


def question_snapshot():
    return {
        "test_question_id": "60000000-0000-4000-8000-000000000001",
        "question_revision_id": "10000000-0000-4000-8000-000000000001",
        "question_uid": "20000000-0000-4000-8000-000000000001",
        "lesson_id": "30000000-0000-4000-8000-000000000001",
        "subtopic_id": "40000000-0000-4000-8000-000000000001",
        "stem": "Choisissez la bonne réponse.",
        "stem_locale": "fr-FR",
        "question_type": "SINGLE_CHOICE_4",
        "difficulty": "MEDIUM",
        "correct_option_id": "50000000-0000-4000-8000-000000000001",
        "full_explanation": "La réponse A applique la règle.",
        "question_status": "PUBLISHED",
        "serving_enabled": True,
        "is_current_revision": True,
        "blocked_not_scorable": False,
        "compatibility_status": "ALLOWED",
        "internal_answer_key_metadata": {"source": "fixture"},
        "options": [
            {
                "id": "50000000-0000-4000-8000-000000000001",
                "position": "A",
                "text": "Option A",
                "explanation": "Correct.",
                "misconception_id": None,
            },
            {
                "id": "50000000-0000-4000-8000-000000000002",
                "position": "B",
                "text": "Option B",
                "explanation": "Confusion B.",
                "misconception_id": "70000000-0000-4000-8000-000000000002",
            },
            {
                "id": "50000000-0000-4000-8000-000000000003",
                "position": "C",
                "text": "Option C",
                "explanation": "Confusion C.",
                "misconception_id": "70000000-0000-4000-8000-000000000003",
            },
            {
                "id": "50000000-0000-4000-8000-000000000004",
                "position": "D",
                "text": "Option D",
                "explanation": "Confusion D.",
                "misconception_id": "70000000-0000-4000-8000-000000000004",
            },
        ],
    }


class Stage21ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = load_json("config/stage21_backend_contract_v1.0.json")
        cls.spec = load_openapi()
        cls.operations = list(iter_operations(cls.spec))
        cls.by_id = {row[2]["operationId"]: row for row in cls.operations}

    def test_manifest_has_owner_date_version_and_review_status(self):
        manifest = self.contract["manifest"]
        self.assertEqual(manifest["governance"]["technical_owner"], "Iman")
        self.assertEqual(manifest["prepared_at_utc"], "2026-08-09")
        self.assertEqual(manifest["package_version"], "stage21-v1.1-review")
        self.assertIn("PENDING_OWNER_ACCEPTANCE", manifest["status"])

    def test_framework_profile_is_resolved_for_django_and_nextjs(self):
        stack = self.contract["technology_stack"]
        self.assertEqual(stack["decision_status"], "ACCEPTED_BY_OWNER")
        self.assertEqual(stack["backend"]["framework"], "Django")
        self.assertEqual(stack["backend"]["series"], "5.2 LTS")
        self.assertEqual(stack["backend"]["api_framework"], "Django REST Framework")
        self.assertEqual(stack["frontend"]["framework"], "Next.js")
        self.assertEqual(stack["frontend"]["release_line"], "16 Active LTS")
        self.assertEqual(stack["frontend"]["implementation_stage"], 22)
        self.assertEqual(
            self.spec["info"]["x-implementation-profile"]["version"],
            self.contract["manifest"]["versions"]["implementation_profile"],
        )

    def test_openapi_is_versioned_and_complete(self):
        self.assertEqual(self.spec["openapi"], "3.1.0")
        self.assertEqual(self.spec["servers"][0]["url"], "/api/v1")
        self.assertEqual(len(self.operations), 34)
        self.assertEqual(len(self.by_id), 34)
        for _, _, operation in self.operations:
            self.assertTrue(operation["responses"])
            self.assertTrue(operation["x-service"])
            self.assertTrue(operation["x-roles"])

    def test_resource_map_exactly_matches_openapi(self):
        rows = load_csv("docs/stages/stage21/resource_map_v1.0.csv")
        mapped = {(row["method"], row["path"], row["operation_id"]) for row in rows}
        actual = {(method, path, operation["operationId"]) for method, path, operation in self.operations}
        self.assertEqual(mapped, actual)

    def test_only_register_and_login_are_anonymous(self):
        anonymous = {
            operation["operationId"]
            for _, _, operation in self.operations
            if operation.get("security") == []
        }
        self.assertEqual(anonymous, {"registerUser", "loginUser"})

    def test_required_idempotency_operations_have_header(self):
        required = set(self.contract["idempotency"]["required_operations"])
        self.assertEqual(len(required), 8)
        for operation_id in required:
            operation = self.by_id[operation_id][2]
            self.assertEqual(operation["x-idempotency"], "REQUIRED")
            self.assertIn(
                "#/components/parameters/IdempotencyKey",
                {item.get("$ref") for item in operation.get("parameters", [])},
            )

    def test_preanswer_openapi_schema_has_no_answer_key(self):
        forbidden = {
            "correct_option_id",
            "is_correct",
            "full_explanation",
            "explanation",
            "misconception_id",
            "answer_key",
        }
        question = set(self.spec["components"]["schemas"]["AttemptQuestion"]["properties"])
        option = set(self.spec["components"]["schemas"]["AttemptOption"]["properties"])
        self.assertFalse(forbidden & question)
        self.assertFalse(forbidden & option)
        feedback = set(self.spec["components"]["schemas"]["AnswerFeedback"]["properties"])
        self.assertTrue({"is_correct", "correct_option_id"} <= feedback)

    def test_stage16_review_actions_are_exposed_without_score_mutation(self):
        expected = {
            "listReviews",
            "getReviewItem",
            "gradeReview",
            "revealReviewAnswer",
            "setReviewMark",
        }
        self.assertTrue(expected <= set(self.by_id))
        self.assertIn("original score/mastery/SRS evidence is unchanged", self.by_id["gradeReview"][2]["description"])

    def test_stage18_dashboard_is_aggregated(self):
        operation = self.by_id["getDashboard"][2]
        self.assertEqual(operation["x-service"], "ANALYTICS")
        self.assertIn("aggregated", operation["summary"])
        dashboard = self.spec["components"]["schemas"]["DashboardEnvelope"]
        required = set(dashboard["properties"]["data"]["required"])
        self.assertTrue({"next_action", "mastery", "review_queue", "error_review", "trend"} <= required)

    def test_stage20_roles_and_gates_are_preserved(self):
        stage20 = load_json("config/stage20_admin_contract_v1.0.json")
        self.assertEqual(
            set(self.by_id["reviewAdminQuestion"][2]["x-roles"]),
            set(stage20["permissions"]["APPROVE_REJECT"]),
        )
        self.assertEqual(
            set(self.by_id["previewAdminImport"][2]["x-roles"]),
            set(stage20["permissions"]["BULK_IMPORT"]),
        )
        self.assertTrue(self.by_id["reviewAdminQuestion"][2]["x-stage11-transition-gate"])
        self.assertTrue(self.by_id["commitAdminBulkStatus"][2]["x-stage11-transition-gate"])

    def test_error_schema_has_exact_stable_shape(self):
        schema = load_json("schemas/stage21_error_response_v1.0.json")
        self.assertFalse(schema["additionalProperties"])
        error = schema["properties"]["error"]
        self.assertFalse(error["additionalProperties"])
        self.assertEqual(error["required"], ["code", "message", "fields", "request_id"])

    def test_database_patch_is_additive_and_has_all_runtime_tables(self):
        sql = (ROOT / "database/postgres/006_stage21_api_runtime_v1.0.sql").read_text(encoding="utf-8")
        for table in (
            "user_credentials",
            "user_role_assignments",
            "auth_sessions",
            "api_idempotency_records",
            "analytics_jobs",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", sql)
        self.assertNotIn("DROP TABLE", sql.upper())
        self.assertNotIn("TRUNCATE", sql.upper())
        self.assertIn("completed idempotency response is immutable", sql)

    def test_resolved_and_open_decisions_are_explicit(self):
        by_code = {item["code"]: item for item in self.contract["decisions"]}
        self.assertEqual(by_code["S21_D01_RUNTIME_FRAMEWORK"]["status"], "RESOLVED_DJANGO_DRF")
        self.assertEqual(by_code["S21_D05_FRONTEND_FRAMEWORK"]["status"], "RESOLVED_NEXTJS")
        decisions = load_csv("docs/stages/stage21/needs_decision_v1.0.csv")
        self.assertEqual(len(decisions), 3)
        self.assertTrue(all("NEEDS_DECISION" in row["status"] or "DEFERRED" in row["status"] for row in decisions))


class DjangoAdapterTests(unittest.TestCase):
    def test_request_id_middleware_preserves_safe_id(self):
        request = RequestFactory().get("/", HTTP_X_REQUEST_ID="client-request-0001")
        middleware = RequestIdMiddleware(lambda incoming: JsonResponse({"ok": True}))
        response = middleware(request)
        self.assertEqual(request.request_id, "client-request-0001")
        self.assertEqual(response["X-Request-ID"], "client-request-0001")

    def test_request_id_middleware_replaces_unsafe_id(self):
        request = RequestFactory().get("/", HTTP_X_REQUEST_ID="bad id")
        response = RequestIdMiddleware(lambda incoming: JsonResponse({"ok": True}))(request)
        self.assertRegex(response["X-Request-ID"], r"^req_[a-f0-9]{32}$")

    def test_drf_exception_handler_preserves_domain_error_contract(self):
        request = APIRequestFactory().post("/")
        request.request_id = "adapter-request-0001"
        response = stage21_exception_handler(
            APIError(409, "STATE_CONFLICT", "Conflict."),
            {"request": request},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "STATE_CONFLICT")
        self.assertEqual(response.data["error"]["request_id"], "adapter-request-0001")
        self.assertEqual(response["X-Request-ID"], "adapter-request-0001")

    def test_drf_validation_error_uses_field_paths(self):
        request = APIRequestFactory().post("/")
        request.request_id = "adapter-request-0002"
        response = stage21_exception_handler(
            ValidationError({"scope": {"lesson_ids": ["At least one is required."]}}),
            {"request": request},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["error"]["code"], "VALIDATION_ERROR")
        self.assertEqual(
            response.data["error"]["fields"]["scope.lesson_ids"],
            ["At least one is required."],
        )

    def test_drf_bearer_adapter_returns_stage21_principal(self):
        principal = Principal(
            user_id=USER_ID,
            session_id="33333333-3333-4333-8333-333333333333",
            roles=("USER",),
            token_id="44444444-4444-4444-8444-444444444444",
        )

        def verify(header):
            self.assertEqual(header, "Bearer adapter-token")
            return principal

        with override_settings(STAGE21_TOKEN_VERIFIER=verify):
            request = APIRequestFactory().get(
                "/", HTTP_AUTHORIZATION="Bearer adapter-token"
            )
            user, authenticated = Stage21BearerAuthentication().authenticate(request)
        self.assertEqual(user.id, USER_ID)
        self.assertTrue(user.is_authenticated)
        self.assertIs(authenticated, principal)

    def test_drf_role_and_owner_permissions_fail_closed(self):
        principal = Principal(
            user_id=USER_ID,
            session_id="33333333-3333-4333-8333-333333333333",
            roles=("USER",),
            token_id="44444444-4444-4444-8444-444444444444",
        )
        request = SimpleNamespace(auth=principal)
        permission = HasStage21Role()
        self.assertTrue(
            permission.has_permission(request, SimpleNamespace(required_roles=("USER",)))
        )
        self.assertFalse(
            permission.has_permission(request, SimpleNamespace(required_roles=("ADMIN",)))
        )
        self.assertFalse(permission.has_permission(request, SimpleNamespace()))
        with self.assertRaises(APIError) as raised:
            enforce_owner(principal, OTHER_USER_ID)
        self.assertEqual(raised.exception.code, "RESOURCE_NOT_FOUND")


class ErrorAndSecurityTests(unittest.TestCase):
    def test_api_error_payload_is_uniform_and_defensive(self):
        error = APIError(422, "VALIDATION_ERROR", "Invalid.", {"email": "Required."})
        payload = error.payload("req_stage21_001")
        self.assertEqual(set(payload), {"error"})
        self.assertEqual(set(payload["error"]), {"code", "message", "fields", "request_id"})
        payload["error"]["fields"]["email"].append("mutated")
        self.assertEqual(error.fields["email"], ["Required."])

    def test_password_hash_uses_random_salt_and_constant_comparison_path(self):
        hasher = PasswordHasher(iterations=100000)
        first = hasher.hash("a sufficiently long password")
        second = hasher.hash("a sufficiently long password")
        self.assertNotEqual(first, second)
        self.assertTrue(hasher.verify("a sufficiently long password", first))
        self.assertFalse(hasher.verify("wrong password", first))
        self.assertFalse(hasher.verify("anything", "malformed"))

    def test_registration_cannot_self_assign_staff_role(self):
        auth = InMemoryAuthService(b"s" * 32, now=lambda: NOW_DT, hasher=PasswordHasher(100000))
        user = auth.register(" User@Example.COM ", "a sufficiently long password")
        self.assertEqual(user["email"], "user@example.com")
        self.assertEqual(user["roles"], ["USER"])

    def test_login_authenticate_and_logout_revokes_session(self):
        auth = InMemoryAuthService(b"s" * 32, now=lambda: NOW_DT, hasher=PasswordHasher(100000))
        user = auth.register("user@example.com", "a sufficiently long password")
        login = auth.login("USER@example.com", "a sufficiently long password")
        header = f"Bearer {login['access_token']}"
        principal = auth.authenticate(header)
        self.assertEqual(principal.user_id, user["id"])
        self.assertEqual(principal.roles, ("USER",))
        auth.logout(header)
        with self.assertRaises(APIError) as raised:
            auth.authenticate(header)
        self.assertEqual(raised.exception.code, "SESSION_REVOKED")

    def test_token_tamper_and_expiry_fail_closed(self):
        sessions = InMemorySessionRegistry()
        signer = TokenSigner(b"k" * 32, sessions, access_ttl_seconds=60)
        session_id = sessions.create(USER_ID, NOW_DT + timedelta(days=1))
        token = signer.issue(USER_ID, session_id, ["USER"], now=NOW_DT)
        with self.assertRaises(APIError) as tampered:
            signer.verify(token[:-1] + ("A" if token[-1] != "A" else "B"), now=NOW_DT)
        self.assertEqual(tampered.exception.code, "TOKEN_INVALID")
        with self.assertRaises(APIError) as expired:
            signer.verify(token, now=NOW_DT + timedelta(seconds=61))
        self.assertEqual(expired.exception.code, "TOKEN_INVALID")

    def test_rate_limit_fails_with_retry_information(self):
        limiter = FixedWindowRateLimiter()
        self.assertEqual(limiter.require("login", "ip+email", 2, 60, now=NOW_DT), 1)
        self.assertEqual(limiter.require("login", "ip+email", 2, 60, now=NOW_DT), 0)
        with self.assertRaises(APIError) as raised:
            limiter.require("login", "ip+email", 2, 60, now=NOW_DT)
        self.assertEqual(raised.exception.status, 429)
        self.assertIn("retry_after_seconds", raised.exception.fields)


class IdempotencyAndPaginationTests(unittest.TestCase):
    def setUp(self):
        self.registry = InMemoryIdempotencyRegistry()
        self.key = "stage21-key-0000001"

    def test_same_request_replays_original_response_once(self):
        calls = []

        def handler():
            calls.append(True)
            return 201, {"id": "resource-1"}

        first = self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 1}, handler, now=NOW_DT)
        second = self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 1}, handler, now=NOW_DT)
        self.assertFalse(first.replayed)
        self.assertTrue(second.replayed)
        self.assertEqual(len(calls), 1)
        second.body["id"] = "mutated"
        self.assertEqual(first.body["id"], "resource-1")

    def test_same_key_with_different_request_conflicts(self):
        self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 1}, lambda: (201, {}), now=NOW_DT)
        with self.assertRaises(APIError) as raised:
            self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 2}, lambda: (201, {}), now=NOW_DT)
        self.assertEqual(raised.exception.code, "IDEMPOTENCY_KEY_REUSED")

    def test_in_progress_request_conflicts(self):
        fingerprint = request_hash({}, {"n": 1})
        self.registry.begin(USER_ID, "createTest", self.key, fingerprint, now=NOW_DT)
        with self.assertRaises(APIError) as raised:
            self.registry.begin(USER_ID, "createTest", self.key, fingerprint, now=NOW_DT)
        self.assertEqual(raised.exception.code, "IDEMPOTENCY_IN_PROGRESS")

    def test_failed_transaction_rolls_back_marker_for_safe_retry(self):
        def failure():
            raise RuntimeError("storage failed")

        with self.assertRaises(RuntimeError):
            self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 1}, failure, now=NOW_DT)
        result = self.registry.execute(USER_ID, "createTest", self.key, {}, {"n": 1}, lambda: (201, {"ok": True}), now=NOW_DT)
        self.assertFalse(result.replayed)

    def test_cursor_pagination_is_bound_to_query_and_tamper_evident(self):
        codec = CursorCodec(b"cursor-secret-1234567890")
        fingerprint = query_fingerprint({"active": True}, "lesson_no")
        first = paginate([{"n": n} for n in range(5)], 2, None, codec, fingerprint)
        self.assertEqual([row["n"] for row in first["data"]], [0, 1])
        second = paginate([{"n": n} for n in range(5)], 2, first["page"]["next_cursor"], codec, fingerprint)
        self.assertEqual([row["n"] for row in second["data"]], [2, 3])
        with self.assertRaises(APIError):
            paginate([{"n": n} for n in range(5)], 2, first["page"]["next_cursor"], codec, "different-query")
        tampered = first["page"]["next_cursor"][:-1] + "A"
        with self.assertRaises(APIError):
            paginate([{"n": n} for n in range(5)], 2, tampered, codec, fingerprint)

    def test_page_size_is_bounded(self):
        codec = CursorCodec(b"cursor-secret-1234567890")
        with self.assertRaises(APIError) as raised:
            paginate([], 101, None, codec, "query")
        self.assertEqual(raised.exception.code, "QUERY_PARAMETER_INVALID")


class LearningApplicationTests(unittest.TestCase):
    def setUp(self):
        self.store = InMemoryLearningStore()
        self.app = LearningApplication(self.store, now=lambda: NOW)
        self.test = self.app.create_test_snapshot(USER_ID, [question_snapshot()], {"mode": "custom"})
        self.attempt = self.app.start_attempt(USER_ID, self.test["id"])

    def submit_wrong(self):
        return self.app.submit_answer(
            USER_ID,
            self.attempt["id"],
            "60000000-0000-4000-8000-000000000001",
            "50000000-0000-4000-8000-000000000002",
            response_ms=1500,
            answered_at=NOW,
        )

    def submit_correct(self):
        return self.app.submit_answer(
            USER_ID,
            self.attempt["id"],
            "60000000-0000-4000-8000-000000000001",
            "50000000-0000-4000-8000-000000000001",
            response_ms=1000,
            answered_at=NOW,
        )

    def test_preanswer_projection_is_allow_listed_and_leak_free(self):
        projected = self.app.get_next_question(USER_ID, self.attempt["id"])
        self.assertEqual(find_forbidden_preanswer_fields(projected), [])
        self.assertNotIn("internal_answer_key_metadata", projected)
        raw = question_snapshot()
        raw["position"] = 1
        direct = public_attempt_question(raw)
        self.assertEqual(find_forbidden_preanswer_fields(direct), [])

    def test_wrong_answer_atomically_updates_all_learning_resources(self):
        receipt = self.submit_wrong()
        self.assertFalse(receipt["feedback"]["is_correct"])
        self.assertEqual(len(self.store.answers), 1)
        self.assertEqual(len(self.store.mastery), 1)
        self.assertEqual(len(self.store.mastery_snapshots), 1)
        self.assertEqual(len(self.store.review_items), 1)
        self.assertEqual(len(self.store.srs), 1)
        self.assertEqual(len(self.store.srs_events), 1)
        self.assertEqual(receipt["review_schedule"]["learning_state"], "LEARNING")

    def test_correct_answer_does_not_fabricate_error_review_item(self):
        receipt = self.submit_correct()
        self.assertTrue(receipt["feedback"]["is_correct"])
        self.assertIsNone(receipt["review_item_id"])
        self.assertEqual(self.store.review_items, {})

    def test_idempotent_answer_replay_does_not_duplicate_evidence(self):
        registry = InMemoryIdempotencyRegistry()
        key = "answer-key-00000001"
        arguments = (
            registry,
            USER_ID,
            key,
            self.attempt["id"],
            "60000000-0000-4000-8000-000000000001",
            "50000000-0000-4000-8000-000000000002",
        )
        first = self.app.submit_answer_idempotent(*arguments, response_ms=1500, answered_at=NOW)
        second = self.app.submit_answer_idempotent(*arguments, response_ms=1500, answered_at=NOW)
        self.assertFalse(first.replayed)
        self.assertTrue(second.replayed)
        self.assertEqual(first.body["answer_id"], second.body["answer_id"])
        self.assertEqual(len(self.store.answers), 1)
        self.assertEqual(len(self.store.srs_events), 1)

    def test_idempotency_key_cannot_hide_a_changed_answer(self):
        registry = InMemoryIdempotencyRegistry()
        key = "answer-key-00000002"
        self.app.submit_answer_idempotent(
            registry,
            USER_ID,
            key,
            self.attempt["id"],
            "60000000-0000-4000-8000-000000000001",
            "50000000-0000-4000-8000-000000000002",
            answered_at=NOW,
        )
        with self.assertRaises(APIError) as raised:
            self.app.submit_answer_idempotent(
                registry,
                USER_ID,
                key,
                self.attempt["id"],
                "60000000-0000-4000-8000-000000000001",
                "50000000-0000-4000-8000-000000000003",
                answered_at=NOW,
            )
        self.assertEqual(raised.exception.code, "IDEMPOTENCY_KEY_REUSED")
        self.assertEqual(len(self.store.answers), 1)

    def test_owner_mismatch_is_concealed_as_not_found(self):
        with self.assertRaises(APIError) as raised:
            self.app.get_next_question(OTHER_USER_ID, self.attempt["id"])
        self.assertEqual(raised.exception.status, 404)
        self.assertEqual(raised.exception.code, "RESOURCE_NOT_FOUND")

    def test_non_idempotent_duplicate_answer_conflicts(self):
        self.submit_wrong()
        with self.assertRaises(APIError) as raised:
            self.submit_wrong()
        self.assertEqual(raised.exception.code, "ANSWER_ALREADY_SUBMITTED")
        self.assertEqual(len(self.store.answers), 1)

    def test_result_is_gated_until_completion(self):
        with self.assertRaises(APIError):
            self.app.get_result(USER_ID, self.attempt["id"])
        with self.assertRaises(APIError):
            self.app.complete_attempt(USER_ID, self.attempt["id"])
        self.submit_correct()
        completed = self.app.complete_attempt(USER_ID, self.attempt["id"])
        result = self.app.get_result(USER_ID, self.attempt["id"])
        self.assertEqual(completed["status"], "COMPLETED")
        self.assertEqual(result["score_pct"], 100.0)
        self.assertEqual(len(result["breakdown"]), 1)

    def test_review_retry_changes_resolution_not_original_score_mastery_or_srs(self):
        receipt = self.submit_wrong()
        self.app.complete_attempt(USER_ID, self.attempt["id"])
        before = {
            "attempt": deepcopy(self.store.attempts),
            "answers": deepcopy(self.store.answers),
            "mastery": deepcopy(self.store.mastery),
            "srs": deepcopy(self.store.srs),
        }
        graded = self.app.grade_review(
            USER_ID,
            receipt["review_item_id"],
            "50000000-0000-4000-8000-000000000001",
            event_at=NOW,
        )
        self.assertEqual(graded["review_item"]["resolution_status"], "CORRECTED")
        self.assertEqual(before["attempt"], self.store.attempts)
        self.assertEqual(before["answers"], self.store.answers)
        self.assertEqual(before["mastery"], self.store.mastery)
        self.assertEqual(before["srs"], self.store.srs)
        self.assertEqual(len(self.store.review_events), 1)

    def test_explicit_reveal_is_audited_but_does_not_resolve(self):
        receipt = self.submit_wrong()
        revealed = self.app.reveal_review(USER_ID, receipt["review_item_id"], event_at=NOW)
        self.assertEqual(revealed["review_item"]["resolution_status"], "UNRESOLVED")
        self.assertEqual(self.store.review_events[-1]["event_type"], "ANSWER_REVEALED")

    def test_mark_is_only_review_state(self):
        receipt = self.submit_wrong()
        srs_before = deepcopy(self.store.srs)
        marked = self.app.set_review_mark(USER_ID, receipt["review_item_id"], True, event_at=NOW)
        self.assertTrue(marked["marked_for_review"])
        self.assertEqual(srs_before, self.store.srs)

    def test_transaction_failure_rolls_back_every_answer_side_effect(self):
        failing_store = InMemoryLearningStore()

        def fail_after_mastery():
            raise RuntimeError("simulated storage failure")

        app = LearningApplication(failing_store, now=lambda: NOW, after_mastery_hook=fail_after_mastery)
        test = app.create_test_snapshot(USER_ID, [question_snapshot()])
        attempt = app.start_attempt(USER_ID, test["id"])
        with self.assertRaises(RuntimeError):
            app.submit_answer(
                USER_ID,
                attempt["id"],
                "60000000-0000-4000-8000-000000000001",
                "50000000-0000-4000-8000-000000000002",
                answered_at=NOW,
            )
        self.assertEqual(failing_store.answers, [])
        self.assertEqual(failing_store.mastery, {})
        self.assertEqual(failing_store.mastery_snapshots, [])
        self.assertEqual(failing_store.review_items, {})
        self.assertEqual(failing_store.srs, {})
        self.assertEqual(failing_store.srs_events, [])

    def test_dashboard_pairs_mastery_with_confidence_and_coverage(self):
        empty = self.app.get_dashboard(USER_ID, as_of=NOW)
        self.assertEqual(empty["next_action"], "BUILD_EVIDENCE")
        self.assertTrue({"recent_test", "trend", "activity"} <= set(empty))
        self.submit_wrong()
        dashboard = self.app.get_dashboard(USER_ID, as_of="2026-08-11T12:00:00Z")
        self.assertEqual(dashboard["next_action"], "OVERDUE_REVIEW")
        item = dashboard["mastery"][0]
        self.assertTrue({"mastery_score_pct", "confidence", "coverage_ratio"} <= set(item))

    def test_empty_test_snapshot_fails_instead_of_fabricating_content(self):
        with self.assertRaises(APIError) as raised:
            self.app.create_test_snapshot(USER_ID, [])
        self.assertEqual(raised.exception.code, "NO_ELIGIBLE_QUESTIONS")
        unsafe = question_snapshot()
        unsafe["question_status"] = "DRAFT"
        with self.assertRaises(APIError) as unpublished:
            self.app.create_test_snapshot(USER_ID, [unsafe])
        self.assertEqual(unpublished.exception.code, "NO_ELIGIBLE_QUESTIONS")


if __name__ == "__main__":
    unittest.main(verbosity=2)
