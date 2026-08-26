from __future__ import annotations

from typing import Any
import uuid

from django.db import connection
from rest_framework.response import Response

from backend.django_adapter import runtime_learning
from backend.errors import APIError


ACCOUNT_RUNTIME_VERSION = "postgres-account-summary-provider-v1.0.0"


def _user_uuid(value: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise APIError(
            401,
            "TOKEN_INVALID",
            "The access token is invalid or expired.",
        ) from exc


def account_summary_request(request) -> Response:
    """Return the minimum account identity needed by the authenticated header.

    This additive surface intentionally exposes no credentials, session token,
    authorization internals, or mutable preferences. The header only needs a
    stable display name/email and locale metadata for its account summary.
    """
    principal = runtime_learning._principal(request)
    user_id = _user_uuid(principal.user_id)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                id,
                email::text,
                display_name,
                locale,
                timezone,
                created_at,
                updated_at
            FROM users
            WHERE id = %s
              AND status = 'ACTIVE'
            """,
            [user_id],
        )
        row = cursor.fetchone()

    if row is None:
        raise APIError(
            401,
            "TOKEN_INVALID",
            "The access token is invalid or expired.",
        )

    (
        account_id,
        email,
        display_name,
        locale,
        timezone_name,
        created_at,
        updated_at,
    ) = row

    return Response(
        {
            "data": {
                "id": str(account_id),
                "email": str(email),
                "display_name": None if display_name is None else str(display_name),
                "locale": str(locale),
                "timezone": str(timezone_name),
                "created_at": runtime_learning._iso(created_at),
                "updated_at": runtime_learning._iso(updated_at),
                "provider_version": ACCOUNT_RUNTIME_VERSION,
            },
            "meta": runtime_learning._meta(request),
        },
        status=200,
    )
