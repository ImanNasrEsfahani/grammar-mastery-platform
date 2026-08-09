from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import threading
from typing import Any, Callable

from .errors import APIError


CONTRACT_VERSION = "api-idempotency-v1.0.0"
_KEY = re.compile(r"^[\x21-\x7e]{16,128}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def request_hash(path_parameters: dict[str, Any], body: Any) -> str:
    canonical = json.dumps(
        {"path": path_parameters, "body": body},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class IdempotentResult:
    status: int
    body: Any
    replayed: bool


@dataclass
class _Record:
    principal_id: str
    operation_id: str
    key: str
    request_hash: str
    state: str
    created_at: datetime
    expires_at: datetime
    status: int | None = None
    body: Any = None


class InMemoryIdempotencyRegistry:
    """Reference semantics for a database-backed idempotency repository.

    A production adapter must create and finish the record in the same database
    transaction as the domain mutation.  On an exception this reference removes
    the in-progress marker, matching a rolled-back PostgreSQL transaction.
    """

    def __init__(self, ttl_seconds: int = 86400) -> None:
        if ttl_seconds <= 0:
            raise ValueError("IDEMPOTENCY_TTL_INVALID")
        self.ttl_seconds = int(ttl_seconds)
        self._records: dict[tuple[str, str, str], _Record] = {}
        self._lock = threading.RLock()

    @staticmethod
    def validate_key(key: str) -> None:
        if not _KEY.fullmatch(str(key)):
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The idempotency key is invalid.",
                {"Idempotency-Key": ["Use 16 to 128 visible ASCII characters."]},
            )

    def _purge(self, now: datetime) -> None:
        expired = [identity for identity, row in self._records.items() if row.expires_at <= now]
        for identity in expired:
            del self._records[identity]

    def begin(
        self,
        principal_id: str,
        operation_id: str,
        key: str,
        fingerprint: str,
        now: datetime | None = None,
    ) -> IdempotentResult | None:
        self.validate_key(key)
        timestamp = now or utcnow()
        identity = (str(principal_id), str(operation_id), str(key))
        with self._lock:
            self._purge(timestamp)
            existing = self._records.get(identity)
            if existing is not None:
                if existing.request_hash != fingerprint:
                    raise APIError(
                        409,
                        "IDEMPOTENCY_KEY_REUSED",
                        "This idempotency key was already used for a different request.",
                    )
                if existing.state == "IN_PROGRESS":
                    raise APIError(
                        409,
                        "IDEMPOTENCY_IN_PROGRESS",
                        "A request with this idempotency key is still in progress.",
                    )
                return IdempotentResult(
                    status=int(existing.status),
                    body=deepcopy(existing.body),
                    replayed=True,
                )
            self._records[identity] = _Record(
                principal_id=str(principal_id),
                operation_id=str(operation_id),
                key=str(key),
                request_hash=fingerprint,
                state="IN_PROGRESS",
                created_at=timestamp,
                expires_at=timestamp + timedelta(seconds=self.ttl_seconds),
            )
        return None

    def complete(
        self,
        principal_id: str,
        operation_id: str,
        key: str,
        status: int,
        body: Any,
    ) -> IdempotentResult:
        if not 100 <= int(status) <= 599:
            raise ValueError("IDEMPOTENCY_RESPONSE_STATUS_INVALID")
        identity = (str(principal_id), str(operation_id), str(key))
        with self._lock:
            row = self._records.get(identity)
            if row is None or row.state != "IN_PROGRESS":
                raise RuntimeError("IDEMPOTENCY_RECORD_NOT_IN_PROGRESS")
            row.state = "COMPLETED"
            row.status = int(status)
            row.body = deepcopy(body)
        return IdempotentResult(status=int(status), body=deepcopy(body), replayed=False)

    def rollback(self, principal_id: str, operation_id: str, key: str) -> None:
        identity = (str(principal_id), str(operation_id), str(key))
        with self._lock:
            row = self._records.get(identity)
            if row is not None and row.state == "IN_PROGRESS":
                del self._records[identity]

    def execute(
        self,
        principal_id: str,
        operation_id: str,
        key: str,
        path_parameters: dict[str, Any],
        body: Any,
        handler: Callable[[], tuple[int, Any]],
        now: datetime | None = None,
    ) -> IdempotentResult:
        fingerprint = request_hash(path_parameters, body)
        replay = self.begin(principal_id, operation_id, key, fingerprint, now=now)
        if replay is not None:
            return replay
        try:
            status, response = handler()
            return self.complete(principal_id, operation_id, key, status, response)
        except Exception:
            self.rollback(principal_id, operation_id, key)
            raise
