#!/usr/bin/env python3
"""Stage 26 release evidence gate.

Provider-neutral and fail-closed. It never deploys anything and never reads secrets.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

UNRESOLVED_MARKERS = {"UNRESOLVED", "REQUIRED_OWNER_INPUT", "REPLACE_ME", "TBD", "TODO", "NONE"}
PASS = "PASS"


def _provider_resolved(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    clean = value.strip()
    return len(clean) >= 2 and clean.upper() not in UNRESOLVED_MARKERS and "REQUIRED" not in clean.upper()


def evaluate_evidence(evidence: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    target = evidence.get("target_environment")
    if target not in {"staging", "production"}:
        errors.append("target_environment must be staging or production")
        return errors

    if evidence.get("schema_version") != "stage26-release-evidence-v1.0.0":
        errors.append("unsupported schema_version")

    git_sha = evidence.get("git_sha", "")
    if not isinstance(git_sha, str) or len(git_sha) != 40 or any(c not in "0123456789abcdef" for c in git_sha):
        errors.append("git_sha must be a lowercase 40-character SHA")

    ci = evidence.get("ci", {})
    for key in ("status", "stage24", "stage25", "stage26"):
        if ci.get(key) != PASS:
            errors.append(f"ci.{key} must be PASS")

    migrations = evidence.get("migrations", {})
    if migrations.get("plan_version") != "stage26-postgres-sequence-v1.0.0":
        errors.append("migration plan version mismatch")
    if migrations.get("used_superseded_file") is not False:
        errors.append("superseded migration file must never be used")
    if migrations.get("staging_dry_run") != PASS:
        errors.append("staging migration rehearsal must PASS")
    if migrations.get("applied") != PASS:
        errors.append("target migration application must PASS")

    providers = evidence.get("providers", {})
    for key in ("compute", "postgres", "backup", "secret_manager", "malware_scanner", "error_monitoring", "dns_tls", "alert_channel", "admin_mfa"):
        if not _provider_resolved(providers.get(key)):
            errors.append(f"providers.{key} is unresolved")

    security = evidence.get("security", {})
    for key in ("https", "headers", "secret_scan"):
        if security.get(key) != PASS:
            errors.append(f"security.{key} must be PASS")

    health = evidence.get("health", {})
    if health.get("status") != PASS:
        errors.append("health.status must be PASS")
    if health.get("database_connectivity") != PASS:
        errors.append("health.database_connectivity must be PASS")

    smoke = evidence.get("smoke", {})
    if smoke.get("status") != PASS:
        errors.append("smoke.status must be PASS")
    if smoke.get("frontend") != PASS:
        errors.append("smoke.frontend must be PASS")
    if target == "production" and smoke.get("safe_api") != PASS:
        errors.append("production smoke.safe_api must be PASS")
    elif target == "staging" and smoke.get("safe_api") not in {PASS, "BLOCKED_BY_UPSTREAM_RUNTIME"}:
        errors.append("staging smoke.safe_api must PASS or explicitly record upstream runtime block")

    monitoring = evidence.get("monitoring", {})
    if monitoring.get("configured") is not True:
        errors.append("monitoring must be configured")
    if target == "production" and monitoring.get("release_window_status") != PASS:
        errors.append("production monitoring release window must PASS")
    if monitoring.get("rollback_threshold_breached") is not False:
        errors.append("rollback threshold is breached")

    rollback = evidence.get("rollback", {})
    if rollback.get("available") is not True:
        errors.append("rollback must be available")
    if target == "production" and rollback.get("previous_revision_recorded") is not True:
        errors.append("production previous revision must be recorded")

    backup = evidence.get("backup", {})
    if target == "production":
        if backup.get("recovery_point_created") is not True:
            errors.append("production recovery point must exist")
        if not str(backup.get("recovery_point_id", "")).strip():
            errors.append("production recovery_point_id is required")
        if backup.get("restore_drill_status") != PASS:
            errors.append("production-like restore drill must PASS before production-ready claim")
        rto = backup.get("measured_rto_minutes")
        if not isinstance(rto, (int, float)):
            errors.append("measured restore RTO is required for production")
        elif rto > 240:
            errors.append("measured RTO exceeds current 4-hour planning target")

    release_note = evidence.get("release_note")
    if not isinstance(release_note, str) or len(release_note.strip()) < 3 or release_note.strip().upper() in UNRESOLVED_MARKERS:
        errors.append("release_note must be recorded")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8-sig"))
    errors = evaluate_evidence(evidence)
    result = {"status": "PASS" if not errors else "FAIL", "errors": errors}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
