from __future__ import annotations

import logging
import re
import time
import uuid

from django.conf import settings
from django.db import connection


REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_PERF_LOGGER = logging.getLogger("gmp.performance")


def create_request_id(incoming: str | None = None) -> str:
    value = str(incoming or "").strip()
    if _REQUEST_ID.fullmatch(value):
        return value
    return f"req_{uuid.uuid4().hex}"


class RequestIdMiddleware:
    """Attach one safe correlation ID to the request and response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = create_request_id(request.headers.get(REQUEST_ID_HEADER))
        response = self.get_response(request)
        response[REQUEST_ID_HEADER] = request.request_id
        return response


def _compact_sql(sql: object, limit: int = 320) -> str:
    value = " ".join(str(sql or "").split())
    if len(value) <= limit:
        return value
    return f"{value[: limit - 1]}…"


class _QueryTimingWrapper:
    def __init__(self, request_id: str, stats: dict[str, float | int]):
        self.request_id = request_id
        self.stats = stats
        self.slow_query_ms = float(getattr(settings, "PERF_SLOW_QUERY_MS", 100))

    def __call__(self, execute, sql, params, many, context):
        started = time.perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            self.stats["query_count"] = int(self.stats["query_count"]) + 1
            self.stats["db_ms"] = float(self.stats["db_ms"]) + elapsed_ms
            if elapsed_ms >= self.slow_query_ms:
                _PERF_LOGGER.warning(
                    "slow_db_query request_id=%s duration_ms=%.1f sql=%s",
                    self.request_id,
                    elapsed_ms,
                    _compact_sql(sql),
                )


class PerformanceTimingMiddleware:
    """Measure end-to-end API and database time with low runtime overhead.

    Every response exposes ``Server-Timing`` and ``X-Response-Time-Ms`` so the
    browser/network panel shows actual server time. Slow SQL and slow requests
    are emitted to the normal application log without logging SQL parameters.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.slow_request_ms = float(
            getattr(settings, "PERF_SLOW_REQUEST_MS", 500)
        )
        self.log_all = bool(getattr(settings, "PERF_LOG_ALL_REQUESTS", False))

    def __call__(self, request):
        request_id = create_request_id(getattr(request, "request_id", None))
        request.request_id = request_id
        stats: dict[str, float | int] = {"query_count": 0, "db_ms": 0.0}
        started = time.perf_counter()

        with connection.execute_wrapper(_QueryTimingWrapper(request_id, stats)):
            response = self.get_response(request)

        total_ms = (time.perf_counter() - started) * 1000
        db_ms = float(stats["db_ms"])
        query_count = int(stats["query_count"])

        response["Server-Timing"] = (
            f'app;dur={total_ms:.1f};desc="Django", '
            f'db;dur={db_ms:.1f};desc="PostgreSQL"'
        )
        response["X-Response-Time-Ms"] = f"{total_ms:.1f}"

        log = _PERF_LOGGER.warning if total_ms >= self.slow_request_ms else _PERF_LOGGER.info
        if self.log_all or total_ms >= self.slow_request_ms:
            log(
                "api_timing request_id=%s method=%s path=%s status=%s duration_ms=%.1f db_ms=%.1f queries=%d",
                request_id,
                request.method,
                request.path,
                getattr(response, "status_code", "unknown"),
                total_ms,
                db_ms,
                query_count,
            )

        return response
