from __future__ import annotations

from datetime import timedelta
import hashlib
import hmac
import json
import logging
import secrets
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.mail import send_mail
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.django_adapter.middleware import create_request_id
from backend.django_adapter.runtime_auth import (
    _hash_password,
    _meta,
    _password_parameters,
    _payload_object,
    _validate_email_value,
    _validation_error,
)
from backend.errors import APIError


logger = logging.getLogger(__name__)
PASSWORD_RECOVERY_POLICY_VERSION = "password-recovery-v1.0.0"
DEFAULT_RESET_TTL_SECONDS = 30 * 60
MAX_REQUESTS_PER_EMAIL_PER_HOUR = 5
_TOKEN_SHAPE = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def _reset_error(code: str = "PASSWORD_RESET_INVALID") -> APIError:
    message = (
        "The password recovery link has expired."
        if code == "PASSWORD_RESET_EXPIRED"
        else "The password recovery link is invalid or has already been used."
    )
    return APIError(400, code, message)


def _validate_request_payload(raw: Any) -> dict[str, str]:
    payload = _payload_object(raw)
    allowed = {"email", "locale"}
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise _validation_error(
            {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}."]}
        )
    email = _validate_email_value(payload.get("email"))
    locale = payload.get("locale", "fa-IR")
    if locale not in {"fa-IR", "en-CA"}:
        raise _validation_error({"locale": ["Use fa-IR or en-CA."]})
    return {"email": email, "locale": str(locale)}


def _validate_confirm_payload(raw: Any) -> dict[str, str]:
    payload = _payload_object(raw)
    allowed = {"token", "new_password"}
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise _validation_error(
            {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}."]}
        )
    token = payload.get("token")
    password = payload.get("new_password")
    if (
        not isinstance(token, str)
        or not 32 <= len(token) <= 256
        or any(character not in _TOKEN_SHAPE for character in token)
    ):
        raise _validation_error({"token": ["Use the recovery token from the email link."]})
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise _validation_error(
            {"new_password": ["Use between 12 and 256 characters."]}
        )
    return {"token": token, "new_password": password}


def _fingerprint(email: str) -> str:
    # Domain-separated HMAC prevents the database fingerprint from becoming a
    # plain unsalted hash of a potentially guessable email address.
    secret = hashlib.sha256(
        ("gmp-password-reset-fingerprint:" + str(settings.SECRET_KEY)).encode("utf-8")
    ).digest()
    return hmac.new(secret, email.encode("utf-8"), hashlib.sha256).hexdigest()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _ttl_seconds() -> int:
    ttl = int(getattr(settings, "PASSWORD_RESET_TOKEN_TTL_SECONDS", DEFAULT_RESET_TTL_SECONDS))
    if ttl < 5 * 60 or ttl > 24 * 60 * 60:
        raise APIError(503, "DEPENDENCY_UNAVAILABLE", "Password recovery is not configured.")
    return ttl


def _public_origin() -> str:
    origin = str(getattr(settings, "PASSWORD_RESET_PUBLIC_ORIGIN", "") or "").strip().rstrip("/")
    parsed = urlparse(origin)
    app_env = str(getattr(settings, "APP_ENV", "staging") or "staging").lower()
    allowed_scheme = parsed.scheme == "https" or (
        app_env != "production" and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    )
    if (
        not origin
        or not allowed_scheme
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (parsed.path not in {"", "/"})
    ):
        raise APIError(503, "DEPENDENCY_UNAVAILABLE", "Password recovery is not configured.")
    return origin


def _email_copy(locale: str, reset_url: str, ttl_minutes: int) -> tuple[str, str]:
    if locale == "fa-IR":
        subject = "بازیابی رمز عبور Grammar Mastery"
        body = (
            "برای تعیین رمز جدید، لینک امن زیر را باز کنید:\n\n"
            f"{reset_url}\n\n"
            f"این لینک یک‌بارمصرف است و حدود {ttl_minutes} دقیقه اعتبار دارد. "
            "اگر شما این درخواست را ثبت نکرده‌اید، این پیام را نادیده بگیرید."
        )
    else:
        subject = "Reset your Grammar Mastery password"
        body = (
            "Open the secure link below to set a new password:\n\n"
            f"{reset_url}\n\n"
            f"This single-use link expires in about {ttl_minutes} minutes. "
            "If you did not request this, you can ignore this message."
        )
    return subject, body


def _record_request(email: str, locale: str) -> tuple[str | None, str | None, str | None]:
    """Create one request event without revealing account existence.

    Returns (request_row_id, raw_token, delivery_email) only for a deliverable
    active account. Raw tokens never enter persistent storage.
    """
    now = timezone.now()
    fingerprint = _fingerprint(email)
    ttl = _ttl_seconds()
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(*)
                FROM password_reset_requests
                WHERE email_fingerprint = %s
                  AND requested_at >= %s
                """,
                [fingerprint, now - timedelta(hours=1)],
            )
            throttled = int(cursor.fetchone()[0] or 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR

            cursor.execute(
                """
                SELECT u.id, u.email::text
                FROM users AS u
                JOIN user_credentials AS c ON c.user_id = u.id
                WHERE u.email = %s
                  AND u.status = 'ACTIVE'
                """,
                [email],
            )
            user_row = cursor.fetchone()

            if throttled or user_row is None:
                cursor.execute(
                    """
                    INSERT INTO password_reset_requests (
                        user_id, email_fingerprint, locale, token_hash,
                        requested_at, expires_at, consumed_at, delivery_status,
                        policy_version
                    )
                    VALUES (NULL, %s, %s, NULL, %s, NULL, NULL, 'SUPPRESSED', %s)
                    """,
                    [fingerprint, locale, now, PASSWORD_RECOVERY_POLICY_VERSION],
                )
                return None, None, None

            user_id, delivery_email = user_row
            # A newer reset request supersedes every still-live token for the account.
            cursor.execute(
                """
                UPDATE password_reset_requests
                SET consumed_at = COALESCE(consumed_at, %s)
                WHERE user_id = %s
                  AND consumed_at IS NULL
                """,
                [now, user_id],
            )

            token = secrets.token_urlsafe(32)
            token_digest = _token_hash(token)
            expires_at = now + timedelta(seconds=ttl)
            cursor.execute(
                """
                INSERT INTO password_reset_requests (
                    user_id, email_fingerprint, locale, token_hash,
                    requested_at, expires_at, consumed_at, delivery_status,
                    policy_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, NULL, 'PENDING', %s)
                RETURNING id
                """,
                [
                    user_id,
                    fingerprint,
                    locale,
                    token_digest,
                    now,
                    expires_at,
                    PASSWORD_RECOVERY_POLICY_VERSION,
                ],
            )
            request_id = str(cursor.fetchone()[0])
            return request_id, token, str(delivery_email)


def _deliver_reset(request_row_id: str, token: str, email: str, locale: str) -> None:
    try:
        origin = _public_origin()
        ttl_minutes = max(1, _ttl_seconds() // 60)
        locale_prefix = "fa" if locale == "fa-IR" else "en"
        reset_url = f"{origin}/{locale_prefix}/reset-password?token={token}"
        subject, body = _email_copy(locale, reset_url, ttl_minutes)
        sent = send_mail(
            subject,
            body,
            str(getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@grammar-mastery.local")),
            [email],
            fail_silently=False,
        )
        if sent != 1:
            raise RuntimeError("Password recovery email was not accepted by the configured backend.")
        status = "SENT"
        consumed_at = None
    except Exception:  # Do not disclose delivery/account state through the public response.
        logger.exception("Password recovery delivery failed for reset request id=%s", request_row_id)
        status = "FAILED"
        consumed_at = timezone.now()

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE password_reset_requests
                SET delivery_status = %s,
                    consumed_at = COALESCE(consumed_at, %s)
                WHERE id = %s
                  AND delivery_status = 'PENDING'
                """,
                [status, consumed_at, request_row_id],
            )


def request_password_reset(payload: dict[str, str]) -> None:
    row_id, token, email = _record_request(payload["email"], payload["locale"])
    if row_id and token and email:
        _deliver_reset(row_id, token, email, payload["locale"])


def confirm_password_reset(payload: dict[str, str]) -> None:
    now = timezone.now()
    token_digest = _token_hash(payload["token"])
    encoded = _hash_password(payload["new_password"])
    parameters = json.dumps(_password_parameters(), separators=(",", ":"))

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    pr.id,
                    pr.user_id,
                    pr.expires_at,
                    pr.consumed_at,
                    pr.delivery_status,
                    u.status::text
                FROM password_reset_requests AS pr
                JOIN users AS u ON u.id = pr.user_id
                JOIN user_credentials AS c ON c.user_id = pr.user_id
                WHERE pr.token_hash = %s
                FOR UPDATE OF pr, c
                """,
                [token_digest],
            )
            row = cursor.fetchone()
            if row is None:
                raise _reset_error()

            request_id, user_id, expires_at, consumed_at, delivery_status, user_status = row
            if consumed_at is not None or delivery_status != "SENT" or user_status != "ACTIVE":
                raise _reset_error()
            if expires_at is None or expires_at <= now:
                cursor.execute(
                    "UPDATE password_reset_requests SET consumed_at = %s WHERE id = %s",
                    [now, request_id],
                )
                raise _reset_error("PASSWORD_RESET_EXPIRED")

            cursor.execute(
                """
                UPDATE user_credentials
                SET password_hash = %s,
                    password_algorithm = 'argon2id',
                    password_parameters = %s::jsonb,
                    password_changed_at = %s,
                    failed_attempt_count = 0,
                    locked_until = NULL,
                    updated_at = %s
                WHERE user_id = %s
                """,
                [encoded, parameters, now, now, user_id],
            )
            if cursor.rowcount != 1:
                raise APIError(503, "DEPENDENCY_UNAVAILABLE", "Password recovery could not be completed.")

            cursor.execute(
                """
                UPDATE auth_sessions
                SET status = 'REVOKED',
                    revoked_at = %s,
                    last_seen_at = %s
                WHERE user_id = %s
                  AND status = 'ACTIVE'
                """,
                [now, now, user_id],
            )
            cursor.execute(
                """
                UPDATE password_reset_requests
                SET consumed_at = COALESCE(consumed_at, %s)
                WHERE user_id = %s
                  AND consumed_at IS NULL
                """,
                [now, user_id],
            )


class PasswordResetRequestView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request):
        payload = _validate_request_payload(request.data)
        # The response is intentionally generic for both known and unknown emails.
        request_password_reset(payload)
        return Response(
            {"data": {"status": "ACCEPTED"}, "meta": _meta(request)},
            status=202,
        )


class PasswordResetConfirmView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    def post(self, request):
        payload = _validate_confirm_payload(request.data)
        confirm_password_reset(payload)
        return Response(
            {"data": {"status": "PASSWORD_RESET"}, "meta": _meta(request)},
            status=200,
        )
