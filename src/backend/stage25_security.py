from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import re
from typing import Any, Callable, Mapping


SECURITY_POLICY_VERSION = "stage25-security-v1.0.0"
SENSITIVE_KEY = re.compile(r"password|passphrase|token|authorization|cookie|secret|api[_-]?key", re.I)
ANSWER_KEY = re.compile(r"correct(_option|_answer)?|answer_key|solution", re.I)


class SecurityPolicyError(ValueError):
    pass


def redact_sensitive(value: Any) -> Any:
    """Return a logging-safe copy without mutating the source object."""
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_sensitive(item) for item in value]
    return value


def assert_no_answer_leak(payload: Any) -> None:
    """Fail closed when a pre-submit learner payload exposes answer material."""
    if isinstance(payload, Mapping):
        for key, value in payload.items():
            if ANSWER_KEY.fullmatch(str(key)):
                raise SecurityPolicyError(f"ANSWER_LEAK:{key}")
            assert_no_answer_leak(value)
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            assert_no_answer_leak(item)


@dataclass(frozen=True)
class UploadScanResult:
    engine: str
    signature_version: str
    clean: bool
    scanned_at: str
    digest_sha256: str
    reason: str | None = None


class UploadGate:
    """Fail-closed boundary for the production malware/content scanner adapter."""

    def __init__(self, scanner: Callable[[bytes], UploadScanResult], max_bytes: int = 20 * 1024 * 1024):
        if not callable(scanner) or max_bytes <= 0:
            raise SecurityPolicyError("UPLOAD_GATE_CONFIGURATION_INVALID")
        self.scanner = scanner
        self.max_bytes = int(max_bytes)

    def require_clean(self, content: bytes) -> UploadScanResult:
        if not content:
            raise SecurityPolicyError("UPLOAD_EMPTY")
        if len(content) > self.max_bytes:
            raise SecurityPolicyError("UPLOAD_TOO_LARGE")
        result = self.scanner(content)
        if not isinstance(result, UploadScanResult):
            raise SecurityPolicyError("SCAN_RESULT_INVALID")
        if not result.engine or not result.signature_version or not result.scanned_at:
            raise SecurityPolicyError("SCAN_EVIDENCE_INCOMPLETE")
        digest = hashlib.sha256(content).hexdigest()
        if not hmac.compare_digest(result.digest_sha256, digest):
            raise SecurityPolicyError("SCAN_DIGEST_MISMATCH")
        if not result.clean:
            raise SecurityPolicyError(f"UPLOAD_REJECTED:{result.reason or 'UNSAFE'}")
        return result


def validate_security_headers(headers: Mapping[str, str]) -> None:
    normalized = {str(k).lower(): str(v) for k, v in headers.items()}
    required = {
        "content-security-policy",
        "x-content-type-options",
        "referrer-policy",
        "permissions-policy",
        "strict-transport-security",
    }
    missing = sorted(required - set(normalized))
    if missing:
        raise SecurityPolicyError("SECURITY_HEADERS_MISSING:" + ",".join(missing))
    if normalized["x-content-type-options"].lower() != "nosniff":
        raise SecurityPolicyError("NOSNIFF_REQUIRED")
    csp = normalized["content-security-policy"]
    for directive in ("default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"):
        if directive not in csp:
            raise SecurityPolicyError("CSP_REQUIRED:" + directive)


def verify_backup_manifest(manifest_bytes: bytes, restored_files: Mapping[str, bytes]) -> None:
    """Verify a restore drill against a versioned SHA-256 manifest."""
    try:
        manifest = json.loads(manifest_bytes)
        expected = manifest["files"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise SecurityPolicyError("BACKUP_MANIFEST_INVALID") from error
    if set(expected) != set(restored_files):
        raise SecurityPolicyError("RESTORE_FILE_SET_MISMATCH")
    for path, digest in expected.items():
        actual = hashlib.sha256(restored_files[path]).hexdigest()
        if not hmac.compare_digest(str(digest), actual):
            raise SecurityPolicyError(f"RESTORE_DIGEST_MISMATCH:{path}")


def utc_scan_result(content: bytes, *, clean: bool, reason: str | None = None) -> UploadScanResult:
    """Deterministic adapter helper; production must supply its real engine metadata."""
    return UploadScanResult(
        engine="stage25-test-adapter",
        signature_version="fixture-v1",
        clean=clean,
        scanned_at=datetime.now(timezone.utc).isoformat(),
        digest_sha256=hashlib.sha256(content).hexdigest(),
        reason=reason,
    )
