from __future__ import annotations

import logging
from typing import Any

from django.http import Http404
from rest_framework import exceptions as drf_exceptions
from rest_framework.response import Response

from backend.errors import APIError
from backend.django_adapter.middleware import REQUEST_ID_HEADER, create_request_id


logger = logging.getLogger(__name__)


def _messages(value: Any, prefix: str = "") -> dict[str, list[str]]:
    fields: dict[str, list[str]] = {}
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            nested = _messages(child, path)
            for nested_key, items in nested.items():
                fields.setdefault(nested_key, []).extend(items)
        return fields
    if isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            if isinstance(child, (dict, list, tuple)):
                path = f"{prefix}[{index}]" if prefix else str(index)
                nested = _messages(child, path)
                for nested_key, items in nested.items():
                    fields.setdefault(nested_key, []).extend(items)
            else:
                fields.setdefault(prefix or "non_field_errors", []).append(str(child))
        return fields
    fields.setdefault(prefix or "non_field_errors", []).append(str(value))
    return fields


def _api_error(exc: Exception) -> tuple[APIError, int | None]:
    retry_after = None
    if isinstance(exc, APIError):
        return exc, retry_after
    if isinstance(exc, (Http404, drf_exceptions.NotFound)):
        return APIError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found."), retry_after
    if isinstance(exc, drf_exceptions.ParseError):
        return APIError(400, "INVALID_JSON", "The request body is not valid JSON."), retry_after
    if isinstance(exc, drf_exceptions.ValidationError):
        return APIError(
            422,
            "VALIDATION_ERROR",
            "The request contains invalid fields.",
            _messages(exc.detail),
        ), retry_after
    if isinstance(exc, drf_exceptions.NotAuthenticated):
        return APIError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."), retry_after
    if isinstance(exc, drf_exceptions.AuthenticationFailed):
        return APIError(401, "TOKEN_INVALID", "The access token is invalid or expired."), retry_after
    if isinstance(exc, drf_exceptions.PermissionDenied):
        return APIError(403, "FORBIDDEN", "You do not have permission to perform this action."), retry_after
    if isinstance(exc, drf_exceptions.MethodNotAllowed):
        return APIError(405, "METHOD_NOT_ALLOWED", "This HTTP method is not allowed."), retry_after
    if isinstance(exc, drf_exceptions.NotAcceptable):
        return APIError(406, "NOT_ACCEPTABLE", "The requested response format is not available."), retry_after
    if isinstance(exc, drf_exceptions.UnsupportedMediaType):
        return APIError(415, "UNSUPPORTED_MEDIA_TYPE", "The request media type is not supported."), retry_after
    if isinstance(exc, drf_exceptions.Throttled):
        retry_after = max(1, int(exc.wait or 1))
        return APIError(
            429,
            "RATE_LIMITED",
            "Too many requests. Try again later.",
            {"retry_after_seconds": [str(retry_after)]},
        ), retry_after
    logger.exception("Unhandled Stage 21 API exception", exc_info=exc)
    return APIError(500, "INTERNAL_ERROR", "An unexpected server error occurred."), retry_after


def stage21_exception_handler(exc, context):
    """Convert Django/DRF/domain failures to the frozen Stage 21 envelope."""

    request = context.get("request") if isinstance(context, dict) else None
    request_id = create_request_id(getattr(request, "request_id", None))
    error, retry_after = _api_error(exc)
    response = Response(error.payload(request_id), status=error.status)
    response[REQUEST_ID_HEADER] = request_id
    if retry_after is not None:
        response["Retry-After"] = str(retry_after)
    return response

