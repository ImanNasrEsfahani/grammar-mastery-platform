from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping, Sequence
import re


_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")


class APIError(Exception):
    """Stable transport-independent error used by Stage 21 services."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        fields: Mapping[str, Sequence[str] | str] | None = None,
    ) -> None:
        if not 400 <= int(status) <= 599:
            raise ValueError("API_ERROR_STATUS_INVALID")
        if not _CODE.fullmatch(str(code)):
            raise ValueError("API_ERROR_CODE_INVALID")
        if not str(message).strip():
            raise ValueError("API_ERROR_MESSAGE_REQUIRED")
        normalized: dict[str, list[str]] = {}
        for key, value in (fields or {}).items():
            messages = [value] if isinstance(value, str) else list(value)
            if not messages or any(not str(item).strip() for item in messages):
                raise ValueError("API_ERROR_FIELD_MESSAGE_INVALID")
            normalized[str(key)] = [str(item) for item in messages]
        super().__init__(message)
        self.status = int(status)
        self.code = str(code)
        self.message = str(message)
        self.fields = normalized

    def payload(self, request_id: str) -> dict[str, Any]:
        if not str(request_id).strip():
            raise ValueError("REQUEST_ID_REQUIRED")
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "fields": deepcopy(self.fields),
                "request_id": str(request_id),
            }
        }


def not_found() -> APIError:
    return APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")


def forbidden() -> APIError:
    return APIError(403, "FORBIDDEN", "You do not have permission to perform this action.")


def require_roles(actual: Sequence[str], allowed: Sequence[str]) -> None:
    if not set(actual) & set(allowed):
        raise forbidden()

