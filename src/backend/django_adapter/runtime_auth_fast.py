from __future__ import annotations

"""Low-contention Stage 21 bearer-token verifier.

This verifier preserves the existing JWT/session/role security checks while
removing the per-request ``SELECT ... FOR UPDATE`` and ``last_seen_at`` write
from the normal authenticated request path.

Normal authenticated requests perform one read query. ``last_seen_at`` is
updated only when it is older than the configured touch interval (10 minutes by
default), and expired sessions are marked expired opportunistically.
"""

from datetime import datetime, timedelta
import uuid

from django.conf import settings
from django.db import connection
from django.utils import timezone

from backend.django_adapter import runtime_auth
from backend.errors import APIError
from backend.security import ALLOWED_ROLES, Principal


DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 10 * 60


def _session_touch_interval_seconds() -> int:
    value = int(
        getattr(
            settings,
            "STAGE21_SESSION_TOUCH_INTERVAL_SECONDS",
            DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS,
        )
    )
    return max(60, min(value, 60 * 60))


def _principal_from_claims(
    claims: dict[str, object],
    *,
    now: datetime | None = None,
) -> Principal:
    timestamp = now or timezone.now()
    user_id = uuid.UUID(str(claims["sub"]))
    session_id = uuid.UUID(str(claims["sid"]))

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                s.status,
                s.expires_at,
                s.last_seen_at,
                u.status::text,
                COALESCE(
                    array_agg(ura.role_code ORDER BY ura.role_code)
                        FILTER (WHERE ura.role_code IS NOT NULL),
                    ARRAY[]::varchar[]
                ) AS active_roles
            FROM auth_sessions AS s
            JOIN users AS u
              ON u.id = s.user_id
            LEFT JOIN user_role_assignments AS ura
              ON ura.user_id = u.id
             AND ura.revoked_at IS NULL
            WHERE s.id = %s
              AND s.user_id = %s
            GROUP BY
                s.id,
                s.status,
                s.expires_at,
                s.last_seen_at,
                u.status
            """,
            [session_id, user_id],
        )
        row = cursor.fetchone()

        if row is None:
            raise runtime_auth._revoked_session()

        (
            session_status,
            session_expires_at,
            last_seen_at,
            user_status,
            raw_roles,
        ) = row

        if str(user_status) != "ACTIVE":
            raise runtime_auth._invalid_token()
        if str(session_status) != "ACTIVE":
            raise runtime_auth._revoked_session()

        if session_expires_at <= timestamp:
            cursor.execute(
                """
                UPDATE auth_sessions
                SET status = 'EXPIRED',
                    last_seen_at = %s
                WHERE id = %s
                  AND user_id = %s
                  AND status = 'ACTIVE'
                  AND expires_at <= %s
                """,
                [timestamp, session_id, user_id, timestamp],
            )
            raise runtime_auth._revoked_session()

        roles = sorted(str(role) for role in (raw_roles or []))
        token_roles = sorted(str(role) for role in claims["roles"])
        if (
            not roles
            or not set(roles) <= ALLOWED_ROLES
            or roles != token_roles
        ):
            # Role changes still require a fresh access token. The optimization
            # only removes lock/write contention; authorization semantics remain
            # unchanged.
            raise runtime_auth._invalid_token()

        touch_interval = timedelta(seconds=_session_touch_interval_seconds())
        stale_before = timestamp - touch_interval
        if last_seen_at is None or last_seen_at <= stale_before:
            # This write happens at most once per touch interval per session.
            # The stale predicate also makes concurrent worker touches harmless.
            cursor.execute(
                """
                UPDATE auth_sessions
                SET last_seen_at = %s
                WHERE id = %s
                  AND user_id = %s
                  AND status = 'ACTIVE'
                  AND (last_seen_at IS NULL OR last_seen_at <= %s)
                """,
                [timestamp, session_id, user_id, stale_before],
            )

    return Principal(
        user_id=str(user_id),
        session_id=str(session_id),
        roles=tuple(roles),
        token_id=str(claims["jti"]),
    )


def verify_authorization_header(authorization_header: str) -> Principal:
    if not isinstance(authorization_header, str) or not authorization_header.startswith(
        "Bearer "
    ):
        raise APIError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
        )

    token = authorization_header[7:].strip()
    if not token:
        raise APIError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
        )

    claims = runtime_auth._decode_access_token(token)
    return _principal_from_claims(claims)
