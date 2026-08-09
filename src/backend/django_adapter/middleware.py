from __future__ import annotations

import re
import uuid


REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


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

