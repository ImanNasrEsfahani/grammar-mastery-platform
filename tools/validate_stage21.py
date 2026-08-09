from __future__ import annotations

from pathlib import Path
import csv
import json
import os
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "backend.django_adapter.test_settings"
)
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def load_json(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def load_csv(path: str):
    with (ROOT / path).open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def resolve_local(document, ref: str):
    assert ref.startswith("#/"), f"external/unexpected ref: {ref}"
    value = document
    for raw_part in ref[2:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        value = value[part]
    return value


def collect_refs(value):
    if isinstance(value, dict):
        if "$ref" in value:
            yield value["$ref"]
        for child in value.values():
            yield from collect_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from collect_refs(child)


def operations(spec):
    for path, path_item in spec["paths"].items():
        for method, operation in path_item.items():
            if method in HTTP_METHODS:
                yield method.upper(), path, operation, path_item


def parameter_object(spec, parameter):
    return resolve_local(spec, parameter["$ref"]) if "$ref" in parameter else parameter


def main() -> int:
    import django
    import rest_framework
    from django.core.checks import run_checks

    django.setup()
    django_check_messages = run_checks()
    assert not django_check_messages, "; ".join(str(item) for item in django_check_messages)

    contract = load_json("config/stage21_backend_contract_v1.0.json")
    rows = load_csv("docs/stages/stage21/resource_map_v1.0.csv")
    spec = yaml.safe_load((ROOT / "api/stage21_core_api_spec_v1.0.yaml").read_text(encoding="utf-8"))
    stage20 = load_json("config/stage20_admin_contract_v1.0.json")
    error_schema = load_json("schemas/stage21_error_response_v1.0.json")
    idempotency_schema = load_json("schemas/stage21_idempotency_record_v1.0.json")

    assert spec["openapi"] == "3.1.0"
    assert spec["servers"][0]["url"] == contract["api"]["base_path"] == "/api/v1"
    assert spec["info"]["x-contract-version"] == contract["manifest"]["versions"]["api"]
    assert spec["security"] == [{"bearerAuth": []}]
    profile = contract["technology_stack"]
    assert profile["decision_status"] == "ACCEPTED_BY_OWNER"
    assert profile["backend"]["framework"] == "Django"
    assert profile["backend"]["series"] == "5.2 LTS"
    assert profile["backend"]["api_framework"] == "Django REST Framework"
    assert profile["frontend"]["framework"] == "Next.js"
    assert profile["frontend"]["release_line"] == "16 Active LTS"
    assert profile["frontend"]["implementation_stage"] == 22
    assert django.VERSION[:2] == (5, 2)
    drf_parts = tuple(int(part) for part in rest_framework.VERSION.split(".")[:2])
    assert drf_parts >= (3, 16)
    assert (
        spec["info"]["x-implementation-profile"]["version"]
        == contract["manifest"]["versions"]["implementation_profile"]
    )

    operation_rows = list(operations(spec))
    operation_ids = [operation["operationId"] for _, _, operation, _ in operation_rows]
    assert len(operation_rows) == 34
    assert len(set(operation_ids)) == len(operation_ids)
    assert len(rows) == len(operation_rows)
    assert {row["operation_id"] for row in rows} == set(operation_ids)

    resource_lookup = {row["operation_id"]: row for row in rows}
    for method, path, operation, path_item in operation_rows:
        operation_id = operation["operationId"]
        row = resource_lookup[operation_id]
        assert (row["method"], row["path"]) == (method, path)
        assert operation.get("responses"), f"missing responses: {operation_id}"
        assert operation.get("tags"), f"missing tags: {operation_id}"
        assert operation.get("x-service") == row["service"], f"service drift: {operation_id}"
        assert operation.get("x-roles"), f"roles missing: {operation_id}"

        placeholders = set(re.findall(r"{([^}]+)}", path))
        parameters = list(path_item.get("parameters", [])) + list(operation.get("parameters", []))
        path_parameters = {
            value["name"]: value
            for value in (parameter_object(spec, item) for item in parameters)
            if value.get("in") == "path"
        }
        assert placeholders == set(path_parameters), f"path parameter drift: {operation_id}"
        assert all(item.get("required") is True for item in path_parameters.values())

    assert spec["paths"]["/auth/register"]["post"]["security"] == []
    assert spec["paths"]["/auth/login"]["post"]["security"] == []
    assert all(
        operation.get("security") != []
        for _, _, operation, _ in operation_rows
        if operation["operationId"] not in {"registerUser", "loginUser"}
    )

    idempotent_operations = set(contract["idempotency"]["required_operations"])
    for _, _, operation, _ in operation_rows:
        if operation["operationId"] not in idempotent_operations:
            continue
        assert operation.get("x-idempotency") == "REQUIRED"
        parameter_refs = {item.get("$ref") for item in operation.get("parameters", [])}
        assert "#/components/parameters/IdempotencyKey" in parameter_refs
        assert resource_lookup[operation["operationId"]]["idempotency"] == "REQUIRED"

    forbidden = {
        "correct_option_id",
        "is_correct",
        "full_explanation",
        "explanation",
        "misconception_id",
        "answer_key",
    }
    attempt_question_properties = set(
        spec["components"]["schemas"]["AttemptQuestion"]["properties"]
    )
    attempt_option_properties = set(
        spec["components"]["schemas"]["AttemptOption"]["properties"]
    )
    assert not (forbidden & attempt_question_properties)
    assert not (forbidden & attempt_option_properties)
    feedback_properties = set(spec["components"]["schemas"]["AnswerFeedback"]["properties"])
    assert {"is_correct", "correct_option_id"} <= feedback_properties

    for ref in collect_refs(spec):
        resolve_local(spec, ref)

    assert error_schema["properties"]["error"]["required"] == [
        "code",
        "message",
        "fields",
        "request_id",
    ]
    assert idempotency_schema["properties"]["contract_version"]["const"] == contract["manifest"]["versions"]["idempotency"]

    admin_expectations = {
        "listAdminQuestions": set(stage20["permissions"]["VIEW_BANK"]),
        "createAdminQuestionDraft": set(stage20["permissions"]["CREATE_DRAFT"]),
        "reviewAdminQuestion": set(stage20["permissions"]["APPROVE_REJECT"]),
        "retireAdminQuestion": set(stage20["permissions"]["RETIRE_IMMEDIATE"]),
        "requestAdminQuestionRetirement": set(stage20["permissions"]["RETIRE_REQUEST"]),
        "previewAdminImport": set(stage20["permissions"]["BULK_IMPORT"]),
        "commitAdminImport": set(stage20["permissions"]["BULK_IMPORT"]),
        "listAdminAuditEvents": set(stage20["permissions"]["VIEW_AUDIT_LOG"]),
    }
    by_id = {operation["operationId"]: operation for _, _, operation, _ in operation_rows}
    for operation_id, roles in admin_expectations.items():
        assert set(by_id[operation_id]["x-roles"]) == roles, f"Stage20 role drift: {operation_id}"

    sql = (ROOT / "database/postgres/006_stage21_api_runtime_v1.0.sql").read_text(encoding="utf-8")
    for table in (
        "user_credentials",
        "user_role_assignments",
        "auth_sessions",
        "api_idempotency_records",
        "analytics_jobs",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    assert "trg_s21_idempotency_transition" in sql
    assert "trg_s21_auth_session_transition" in sql
    assert not re.search(r"\b(DROP TABLE|TRUNCATE|DELETE FROM|UPDATE questions)\b", sql, re.IGNORECASE)

    decisions = contract["decisions"]
    by_decision = {item["code"]: item for item in decisions}
    assert set(by_decision) == {
        "S21_D01_RUNTIME_FRAMEWORK",
        "S21_D02_SIGNING_KEY_LIFECYCLE",
        "S21_D03_ANALYTICS_RUNNER",
        "S21_D04_PRODUCTION_BASE_URL",
        "S21_D05_FRONTEND_FRAMEWORK",
    }
    assert by_decision["S21_D01_RUNTIME_FRAMEWORK"]["status"] == "RESOLVED_DJANGO_DRF"
    assert by_decision["S21_D05_FRONTEND_FRAMEWORK"]["status"] == "RESOLVED_NEXTJS"
    open_decisions = load_csv("docs/stages/stage21/needs_decision_v1.0.csv")
    assert len(open_decisions) == 3
    assert all(
        "NEEDS_DECISION" in item["status"] or "DEFERRED" in item["status"]
        for item in open_decisions
    )

    required_files = [
        "docs/stages/stage21/README.md",
        "docs/stages/stage21/service_boundaries_v1.0.md",
        "docs/stages/stage21/auth_policy_v1.0.md",
        "docs/stages/stage21/error_contract_v1.0.md",
        "docs/stages/stage21/framework_decision_v1.0.md",
        "docs/stages/stage21/review_report_v1.0.md",
        "docs/stages/stage21/validation_v1.0.json",
        "requirements.txt",
        "src/backend/django_adapter/authentication.py",
        "src/backend/django_adapter/exceptions.py",
        "src/backend/django_adapter/middleware.py",
        "src/backend/django_adapter/permissions.py",
    ]
    assert all((ROOT / path).is_file() for path in required_files)
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "Django>=5.2.17,<5.3" in requirements
    assert "djangorestframework>=3.16,<4.0" in requirements

    from backend.django_adapter.authentication import Stage21BearerAuthentication
    from backend.django_adapter.exceptions import stage21_exception_handler
    from backend.django_adapter.middleware import RequestIdMiddleware
    from backend.django_adapter.permissions import HasStage21Role

    assert Stage21BearerAuthentication and stage21_exception_handler
    assert RequestIdMiddleware and HasStage21Role

    print(
        json.dumps(
            {
                "stage": 21,
                "status": "PASS",
                "operations": len(operation_rows),
                "paths": len(spec["paths"]),
                "resource_map_rows": len(rows),
                "openapi_refs_resolved": len(list(collect_refs(spec))),
                "idempotent_operations": len(idempotent_operations),
                "resolved_framework_decisions": 2,
                "open_decisions_explicit": len(open_decisions),
                "django": django.get_version(),
                "djangorestframework": rest_framework.VERSION,
                "django_system_checks": "PASS",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"STAGE21_VALIDATION=FAIL {error}", file=sys.stderr)
        raise
