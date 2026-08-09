from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, Mapping
import base64
import hashlib
import hmac
import json
import re
import uuid

from django.conf import settings
from django.contrib.auth.hashers import (
    check_password,
    get_hasher,
    identify_hasher,
    make_password,
)
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework.response import Response

from backend.django_adapter.middleware import create_request_id
from backend.errors import APIError
from backend.security import ALLOWED_ROLES, PasswordHasher, Principal


AUTH_RUNTIME_POLICY_VERSION = "stage25-runtime-auth-v1.0.0"
API_VERSION = "v1"
DEFAULT_ACCESS_TTL_SECONDS = 900
DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
MAX_LOGIN_FAILURES = 5
ACCOUNT_LOCK_SECONDS = 15 * 60

_EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class SigningKey:
    kid: str
    secret: bytes


def _dependency_unavailable() -> APIError:
    return APIError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        "The authentication runtime dependency is not configured.",
    )


def _invalid_credentials() -> APIError:
    return APIError(401, "TOKEN_INVALID", "The email or password is invalid.")


def _invalid_token() -> APIError:
    return APIError(401, "TOKEN_INVALID", "The access token is invalid or expired.")


def _revoked_session() -> APIError:
    return APIError(401, "SESSION_REVOKED", "The session is no longer active.")


def _meta(request) -> dict[str, str]:
    request_id = create_request_id(getattr(request, "request_id", None))
    return {"request_id": request_id, "api_version": API_VERSION}


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().casefold()


def _validation_error(fields: Mapping[str, list[str] | str]) -> APIError:
    return APIError(
        422,
        "VALIDATION_ERROR",
        "The request contains invalid fields.",
        fields,
    )


def _payload_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise _validation_error({"non_field_errors": ["A JSON object is required."]})
    return dict(value)


def _validate_email_value(value: Any) -> str:
    email = _normalize_email(value)
    if not email or len(email) > 320 or not _EMAIL_SHAPE.fullmatch(email):
        raise _validation_error({"email": ["Enter a valid email address."]})
    try:
        validate_email(email)
    except DjangoValidationError as exc:
        raise _validation_error({"email": ["Enter a valid email address."]}) from exc
    return email


def _validate_register_payload(raw: Any) -> dict[str, Any]:
    payload = _payload_object(raw)
    allowed = {"email", "password", "display_name", "locale", "timezone"}
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise _validation_error(
            {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}."]}
        )

    email = _validate_email_value(payload.get("email"))
    password = payload.get("password")
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise _validation_error(
            {"password": ["Use between 12 and 256 characters."]}
        )

    display_name = payload.get("display_name")
    if display_name is not None:
        if not isinstance(display_name, str) or len(display_name) > 200:
            raise _validation_error(
                {"display_name": ["Use at most 200 characters."]}
            )
        display_name = display_name.strip() or None

    locale = payload.get("locale", "fa-IR")
    if locale not in {"fa-IR", "en-CA"}:
        raise _validation_error({"locale": ["Use fa-IR or en-CA."]})

    tz_name = payload.get("timezone", "UTC")
    if not isinstance(tz_name, str) or not 1 <= len(tz_name.strip()) <= 80:
        raise _validation_error(
            {"timezone": ["Use a timezone string between 1 and 80 characters."]}
        )

    return {
        "email": email,
        "password": password,
        "display_name": display_name,
        "locale": locale,
        "timezone": tz_name.strip(),
    }


def _validate_login_payload(raw: Any) -> dict[str, str]:
    payload = _payload_object(raw)
    allowed = {"email", "password"}
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise _validation_error(
            {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}."]}
        )
    email = _validate_email_value(payload.get("email"))
    password = payload.get("password")
    if not isinstance(password, str) or not 1 <= len(password) <= 256:
        raise _validation_error({"password": ["Password is required."]})
    return {"email": email, "password": password}


def _password_parameters() -> dict[str, Any]:
    return {
        "framework": "django",
        "hasher": "argon2",
        "variant": "argon2id",
        "policy_version": AUTH_RUNTIME_POLICY_VERSION,
    }


def _hash_password(password: str) -> str:
    # Django's Argon2PasswordHasher uses argon2-cffi's Argon2id profile.
    return make_password(password, hasher="argon2")


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    # Used to reduce account-enumeration timing differences for unknown emails.
    return _hash_password("not-a-real-user-password-000000")


def _verify_password(
    password: str,
    encoded: str,
    stored_algorithm: str,
) -> tuple[bool, bool]:
    valid = False
    legacy_custom = False
    try:
        valid = check_password(password, encoded)
    except (ValueError, TypeError):
        valid = False

    # Stage 21's reference in-memory PBKDF2 format predates the Django
    # persistence adapter and is not byte-compatible with Django's PBKDF2
    # encoding. Verify it only as a migration bridge, then upgrade to Argon2id.
    if not valid and stored_algorithm == "pbkdf2_sha256":
        try:
            valid = PasswordHasher().verify(password, encoded)
            legacy_custom = valid
        except (ValueError, TypeError):
            valid = False

    if not valid:
        return False, False
    if legacy_custom:
        return True, True

    try:
        current = identify_hasher(encoded)
        preferred = get_hasher("argon2")
        needs_upgrade = (
            current.algorithm != preferred.algorithm or current.must_update(encoded)
        )
    except (ValueError, TypeError):
        needs_upgrade = True
    return True, needs_upgrade


def _secret_bytes(value: Any) -> bytes:
    raw = str(value or "").encode("utf-8")
    if len(raw) < 32:
        raise _dependency_unavailable()
    return raw


def _keyring() -> tuple[SigningKey, dict[str, bytes]]:
    current_kid = str(
        getattr(settings, "STAGE21_JWT_KEY_ID", "primary-v1") or "primary-v1"
    ).strip()
    if not current_kid:
        raise _dependency_unavailable()
    current = SigningKey(
        kid=current_kid,
        secret=_secret_bytes(getattr(settings, "STAGE21_JWT_SIGNING_KEY", "")),
    )
    ring = {current.kid: current.secret}

    previous_secret = str(
        getattr(settings, "STAGE21_JWT_PREVIOUS_SIGNING_KEY", "") or ""
    )
    previous_kid = str(
        getattr(settings, "STAGE21_JWT_PREVIOUS_KEY_ID", "") or ""
    ).strip()
    if previous_secret or previous_kid:
        if not previous_secret or not previous_kid or previous_kid == current.kid:
            raise _dependency_unavailable()
        ring[previous_kid] = _secret_bytes(previous_secret)
    return current, ring


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _jwt_config() -> tuple[str, str, int, int]:
    issuer = str(
        getattr(settings, "STAGE21_JWT_ISSUER", "grammar-mastery")
        or "grammar-mastery"
    )
    audience = str(
        getattr(settings, "STAGE21_JWT_AUDIENCE", "grammar-mastery-api")
        or "grammar-mastery-api"
    )
    access_ttl = int(
        getattr(
            settings,
            "STAGE21_JWT_ACCESS_TTL_SECONDS",
            DEFAULT_ACCESS_TTL_SECONDS,
        )
    )
    session_ttl = int(
        getattr(
            settings,
            "STAGE21_SESSION_TTL_SECONDS",
            DEFAULT_SESSION_TTL_SECONDS,
        )
    )
    if access_ttl < 60 or access_ttl > 3600:
        raise _dependency_unavailable()
    if session_ttl <= access_ttl or session_ttl > 90 * 24 * 60 * 60:
        raise _dependency_unavailable()
    return issuer, audience, access_ttl, session_ttl


def _issue_access_token(
    user_id: str,
    session_id: str,
    roles: list[str] | tuple[str, ...],
    *,
    now: datetime | None = None,
) -> str:
    current_key, _ = _keyring()
    issuer, audience, access_ttl, _ = _jwt_config()
    timestamp = now or timezone.now()
    role_set = sorted(set(str(role) for role in roles))
    if not role_set or not set(role_set) <= ALLOWED_ROLES:
        raise _dependency_unavailable()

    header = {"alg": "HS256", "typ": "JWT", "kid": current_key.kid}
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": str(user_id),
        "sid": str(session_id),
        "roles": role_set,
        "iat": int(timestamp.timestamp()),
        "exp": int(timestamp.timestamp()) + access_ttl,
        "jti": str(uuid.uuid4()),
    }
    encoded_header = _b64url(
        json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    encoded_payload = _b64url(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = _b64url(
        hmac.new(current_key.secret, signing_input, hashlib.sha256).digest()
    )
    return f"{encoded_header}.{encoded_payload}.{signature}"


def _require_uuid(value: Any) -> str:
    return str(uuid.UUID(str(value)))


def _decode_access_token(
    token: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    invalid = _invalid_token()
    timestamp = now or timezone.now()
    issuer, audience, _, _ = _jwt_config()
    current_key, ring = _keyring()
    try:
        encoded_header, encoded_payload, supplied_signature = token.split(".", 2)
        header = json.loads(_unb64url(encoded_header))
        payload = json.loads(_unb64url(encoded_payload))

        if not isinstance(header, dict) or header.get("alg") != "HS256":
            raise invalid
        if header.get("typ") != "JWT":
            raise invalid
        if set(header) - {"alg", "typ", "kid"}:
            raise invalid

        kid = header.get("kid")
        if kid is None:
            secret = current_key.secret
        else:
            secret = ring.get(str(kid))
            if secret is None:
                raise invalid

        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        expected_signature = _b64url(
            hmac.new(secret, signing_input, hashlib.sha256).digest()
        )
        if not hmac.compare_digest(expected_signature, supplied_signature):
            raise invalid

        required = {"iss", "aud", "sub", "sid", "roles", "iat", "exp", "jti"}
        if not isinstance(payload, dict) or required - set(payload):
            raise invalid
        if payload["iss"] != issuer or payload["aud"] != audience:
            raise invalid

        iat = payload["iat"]
        exp = payload["exp"]
        if isinstance(iat, bool) or isinstance(exp, bool):
            raise invalid
        iat = int(iat)
        exp = int(exp)
        now_seconds = int(timestamp.timestamp())
        if iat > now_seconds + 30 or exp <= now_seconds or exp <= iat:
            raise invalid

        payload["sub"] = _require_uuid(payload["sub"])
        payload["sid"] = _require_uuid(payload["sid"])
        payload["jti"] = _require_uuid(payload["jti"])

        raw_roles = payload["roles"]
        if not isinstance(raw_roles, list) or not raw_roles:
            raise invalid
        roles = [str(role) for role in raw_roles]
        if len(set(roles)) != len(roles) or not set(roles) <= ALLOWED_ROLES:
            raise invalid
        payload["roles"] = sorted(roles)
        payload["iat"] = iat
        payload["exp"] = exp
        return payload
    except APIError:
        raise
    except (
        ValueError,
        TypeError,
        KeyError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        base64.binascii.Error,
    ) as exc:
        raise invalid from exc


def _active_roles(cursor, user_id) -> list[str]:
    cursor.execute(
        """
        SELECT role_code
        FROM user_role_assignments
        WHERE user_id = %s
          AND revoked_at IS NULL
        ORDER BY role_code
        """,
        [user_id],
    )
    return [str(row[0]) for row in cursor.fetchall()]


def _register_user(payload: dict[str, Any]) -> dict[str, Any]:
    encoded = _hash_password(payload["password"])
    parameters = json.dumps(_password_parameters(), separators=(",", ":"))
    role_metadata = json.dumps(
        {
            "source": "public_registration",
            "policy_version": AUTH_RUNTIME_POLICY_VERSION,
        },
        separators=(",", ":"),
    )
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO users (
                        email,
                        display_name,
                        locale,
                        timezone,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, 'ACTIVE', now(), now())
                    RETURNING id, email::text, display_name
                    """,
                    [
                        payload["email"],
                        payload["display_name"],
                        payload["locale"],
                        payload["timezone"],
                    ],
                )
                user_id, email, display_name = cursor.fetchone()
                cursor.execute(
                    """
                    INSERT INTO user_credentials (
                        user_id,
                        password_hash,
                        password_algorithm,
                        password_parameters,
                        password_changed_at,
                        failed_attempt_count,
                        locked_until,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        %s,
                        %s,
                        'argon2id',
                        %s::jsonb,
                        now(),
                        0,
                        NULL,
                        now(),
                        now()
                    )
                    """,
                    [user_id, encoded, parameters],
                )
                cursor.execute(
                    """
                    INSERT INTO user_role_assignments (
                        user_id,
                        role_code,
                        metadata
                    )
                    VALUES (%s, 'USER', %s::jsonb)
                    """,
                    [user_id, role_metadata],
                )
    except IntegrityError as exc:
        raise APIError(
            409,
            "STATE_CONFLICT",
            "An account already exists for this email.",
        ) from exc

    return {
        "id": str(user_id),
        "email": str(email),
        "display_name": display_name,
        "roles": ["USER"],
    }


def _login_user(
    payload: dict[str, str],
    *,
    request_id: str,
) -> dict[str, Any]:
    now = timezone.now()
    _, _, access_ttl, session_ttl = _jwt_config()
    result: dict[str, Any] | None = None
    failure: APIError | None = None
    found = False

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    u.id,
                    u.status::text,
                    c.password_hash,
                    c.password_algorithm,
                    c.failed_attempt_count,
                    c.locked_until
                FROM users AS u
                JOIN user_credentials AS c
                  ON c.user_id = u.id
                WHERE u.email = %s
                FOR UPDATE OF u, c
                """,
                [payload["email"]],
            )
            row = cursor.fetchone()
            if row is not None:
                found = True
                (
                    user_id,
                    user_status,
                    encoded_password,
                    stored_algorithm,
                    failed_attempt_count,
                    locked_until,
                ) = row

                if locked_until is not None and locked_until <= now:
                    cursor.execute(
                        """
                        UPDATE user_credentials
                        SET failed_attempt_count = 0,
                            locked_until = NULL,
                            updated_at = now()
                        WHERE user_id = %s
                        """,
                        [user_id],
                    )
                    failed_attempt_count = 0
                    locked_until = None

                password_valid, needs_upgrade = _verify_password(
                    payload["password"],
                    encoded_password,
                    str(stored_algorithm),
                )

                if (
                    user_status != "ACTIVE"
                    or (locked_until is not None and locked_until > now)
                    or not password_valid
                ):
                    if user_status == "ACTIVE" and (
                        locked_until is None or locked_until <= now
                    ) and not password_valid:
                        new_count = int(failed_attempt_count) + 1
                        new_locked_until = (
                            now + timedelta(seconds=ACCOUNT_LOCK_SECONDS)
                            if new_count >= MAX_LOGIN_FAILURES
                            else None
                        )
                        cursor.execute(
                            """
                            UPDATE user_credentials
                            SET failed_attempt_count = %s,
                                locked_until = %s,
                                updated_at = now()
                            WHERE user_id = %s
                            """,
                            [new_count, new_locked_until, user_id],
                        )
                    failure = _invalid_credentials()
                else:
                    if needs_upgrade:
                        upgraded = _hash_password(payload["password"])
                        cursor.execute(
                            """
                            UPDATE user_credentials
                            SET password_hash = %s,
                                password_algorithm = 'argon2id',
                                password_parameters = %s::jsonb,
                                password_changed_at = now(),
                                failed_attempt_count = 0,
                                locked_until = NULL,
                                updated_at = now()
                            WHERE user_id = %s
                            """,
                            [
                                upgraded,
                                json.dumps(
                                    _password_parameters(),
                                    separators=(",", ":"),
                                ),
                                user_id,
                            ],
                        )
                    else:
                        cursor.execute(
                            """
                            UPDATE user_credentials
                            SET failed_attempt_count = 0,
                                locked_until = NULL,
                                updated_at = now()
                            WHERE user_id = %s
                            """,
                            [user_id],
                        )

                    roles = _active_roles(cursor, user_id)
                    if not roles or not set(roles) <= ALLOWED_ROLES:
                        failure = _invalid_credentials()
                    else:
                        session_id = uuid.uuid4()
                        expires_at = now + timedelta(seconds=session_ttl)
                        token = _issue_access_token(
                            str(user_id),
                            str(session_id),
                            roles,
                            now=now,
                        )
                        cursor.execute(
                            """
                            INSERT INTO auth_sessions (
                                id,
                                user_id,
                                status,
                                issued_at,
                                expires_at,
                                revoked_at,
                                last_seen_at,
                                client_metadata,
                                created_at
                            )
                            VALUES (
                                %s,
                                %s,
                                'ACTIVE',
                                %s,
                                %s,
                                NULL,
                                %s,
                                %s::jsonb,
                                %s
                            )
                            """,
                            [
                                session_id,
                                user_id,
                                now,
                                expires_at,
                                now,
                                json.dumps(
                                    {
                                        "login_request_id": request_id,
                                        "policy_version": AUTH_RUNTIME_POLICY_VERSION,
                                    },
                                    separators=(",", ":"),
                                ),
                                now,
                            ],
                        )
                        result = {
                            "access_token": token,
                            "token_type": "Bearer",
                            "expires_in": access_ttl,
                            "session_id": str(session_id),
                        }

    if not found:
        # Execute the preferred password verifier even when the account does not
        # exist, reducing a straightforward account-enumeration timing signal.
        check_password(payload["password"], _dummy_password_hash())
        raise _invalid_credentials()
    if failure is not None:
        raise failure
    if result is None:
        raise _dependency_unavailable()
    return result


def _principal_from_claims(
    claims: dict[str, Any],
    *,
    now: datetime | None = None,
) -> Principal:
    timestamp = now or timezone.now()
    user_id = uuid.UUID(claims["sub"])
    session_id = uuid.UUID(claims["sid"])
    failure: APIError | None = None
    principal: Principal | None = None

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    s.status,
                    s.expires_at,
                    u.status::text
                FROM auth_sessions AS s
                JOIN users AS u
                  ON u.id = s.user_id
                WHERE s.id = %s
                  AND s.user_id = %s
                FOR UPDATE OF s
                """,
                [session_id, user_id],
            )
            row = cursor.fetchone()
            if row is None:
                failure = _revoked_session()
            else:
                session_status, session_expires_at, user_status = row
                if user_status != "ACTIVE":
                    failure = _invalid_token()
                elif session_status != "ACTIVE":
                    failure = _revoked_session()
                elif session_expires_at <= timestamp:
                    cursor.execute(
                        """
                        UPDATE auth_sessions
                        SET status = 'EXPIRED',
                            last_seen_at = %s
                        WHERE id = %s
                          AND user_id = %s
                          AND status = 'ACTIVE'
                        """,
                        [timestamp, session_id, user_id],
                    )
                    failure = _revoked_session()
                else:
                    roles = _active_roles(cursor, user_id)
                    token_roles = list(claims["roles"])
                    if not roles or roles != token_roles:
                        # Role changes require a new access token instead of
                        # silently elevating or retaining stale authority.
                        failure = _invalid_token()
                    else:
                        cursor.execute(
                            """
                            UPDATE auth_sessions
                            SET last_seen_at = %s
                            WHERE id = %s
                              AND user_id = %s
                              AND status = 'ACTIVE'
                            """,
                            [timestamp, session_id, user_id],
                        )
                        principal = Principal(
                            user_id=str(user_id),
                            session_id=str(session_id),
                            roles=tuple(roles),
                            token_id=str(claims["jti"]),
                        )

    if failure is not None:
        raise failure
    if principal is None:
        raise _invalid_token()
    return principal


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
    claims = _decode_access_token(token)
    return _principal_from_claims(claims)


def _revoke_session(principal: Principal) -> None:
    session_id = uuid.UUID(str(principal.session_id))
    user_id = uuid.UUID(str(principal.user_id))
    failure: APIError | None = None

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE auth_sessions
                SET status = 'REVOKED',
                    revoked_at = now(),
                    last_seen_at = now()
                WHERE id = %s
                  AND user_id = %s
                  AND status = 'ACTIVE'
                """,
                [session_id, user_id],
            )
            if cursor.rowcount != 1:
                failure = _revoked_session()

    if failure is not None:
        raise failure


def register_request(request) -> Response:
    payload = _validate_register_payload(request.data)
    user = _register_user(payload)
    return Response({"data": user, "meta": _meta(request)}, status=201)


def login_request(request) -> Response:
    payload = _validate_login_payload(request.data)
    meta = _meta(request)
    auth = _login_user(payload, request_id=meta["request_id"])
    return Response({"data": auth, "meta": meta}, status=200)


def logout_request(request) -> Response:
    principal = getattr(request, "auth", None)
    if not isinstance(principal, Principal):
        raise APIError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Authentication is required.",
        )
    _revoke_session(principal)
    return Response(status=204)
