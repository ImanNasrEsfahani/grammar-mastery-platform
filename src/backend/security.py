from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import json
import re
import secrets
import threading
import uuid
from typing import Any, Callable

from .errors import APIError


AUTH_POLICY_VERSION = "auth-policy-v1.0.0"
ALLOWED_ROLES = {"USER", "ADMIN", "CONTENT_EDITOR", "REVIEWER"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class PasswordHasher:
    algorithm = "pbkdf2_sha256"

    def __init__(self, iterations: int = 600000, salt_bytes: int = 16, key_bytes: int = 32) -> None:
        if iterations < 100000 or salt_bytes < 16 or key_bytes < 32:
            raise ValueError("PASSWORD_HASH_PARAMETERS_UNSAFE")
        self.iterations = int(iterations)
        self.salt_bytes = int(salt_bytes)
        self.key_bytes = int(key_bytes)

    def hash(self, password: str) -> str:
        if not isinstance(password, str) or not password:
            raise ValueError("PASSWORD_REQUIRED")
        salt = secrets.token_bytes(self.salt_bytes)
        key = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, self.iterations, dklen=self.key_bytes
        )
        return f"{self.algorithm}${self.iterations}${_b64url(salt)}${_b64url(key)}"

    def verify(self, password: str, encoded: str) -> bool:
        try:
            algorithm, raw_iterations, raw_salt, raw_key = encoded.split("$", 3)
            if algorithm != self.algorithm:
                return False
            iterations = int(raw_iterations)
            salt = _unb64url(raw_salt)
            expected = _unb64url(raw_key)
            if not 100000 <= iterations <= 10000000 or len(salt) < 16 or not 32 <= len(expected) <= 64:
                return False
            candidate = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt, iterations, dklen=len(expected)
            )
            return hmac.compare_digest(candidate, expected)
        except (ValueError, TypeError, base64.binascii.Error):
            return False


@dataclass(frozen=True)
class Principal:
    user_id: str
    session_id: str
    roles: tuple[str, ...]
    token_id: str


class InMemorySessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def create(self, user_id: str, expires_at: datetime) -> str:
        session_id = str(uuid.uuid4())
        with self._lock:
            self._sessions[session_id] = {
                "user_id": str(user_id),
                "status": "ACTIVE",
                "expires_at": expires_at,
            }
        return session_id

    def revoke(self, session_id: str, user_id: str) -> None:
        with self._lock:
            session = self._sessions.get(str(session_id))
            if session is None or session["user_id"] != str(user_id):
                raise APIError(401, "SESSION_REVOKED", "The session is no longer active.")
            session["status"] = "REVOKED"

    def require_active(self, session_id: str, user_id: str, now: datetime) -> None:
        with self._lock:
            session = self._sessions.get(str(session_id))
            if session is None or session["user_id"] != str(user_id):
                raise APIError(401, "SESSION_REVOKED", "The session is no longer active.")
            if session["status"] != "ACTIVE":
                raise APIError(401, "SESSION_REVOKED", "The session is no longer active.")
            if session["expires_at"] <= now:
                session["status"] = "EXPIRED"
                raise APIError(401, "SESSION_REVOKED", "The session is no longer active.")


class TokenSigner:
    def __init__(
        self,
        secret: bytes,
        sessions: InMemorySessionRegistry,
        issuer: str = "grammar-mastery",
        audience: str = "grammar-mastery-api",
        access_ttl_seconds: int = 900,
    ) -> None:
        if not isinstance(secret, bytes) or len(secret) < 32:
            raise ValueError("TOKEN_SIGNING_SECRET_TOO_SHORT")
        if access_ttl_seconds <= 0:
            raise ValueError("TOKEN_TTL_INVALID")
        self.secret = secret
        self.sessions = sessions
        self.issuer = issuer
        self.audience = audience
        self.access_ttl_seconds = int(access_ttl_seconds)

    def issue(
        self,
        user_id: str,
        session_id: str,
        roles: list[str] | tuple[str, ...],
        now: datetime | None = None,
    ) -> str:
        timestamp = now or _now()
        role_set = sorted(set(roles))
        if not role_set or not set(role_set) <= ALLOWED_ROLES:
            raise ValueError("TOKEN_ROLES_INVALID")
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "iss": self.issuer,
            "aud": self.audience,
            "sub": str(user_id),
            "sid": str(session_id),
            "roles": role_set,
            "iat": int(timestamp.timestamp()),
            "exp": int(timestamp.timestamp()) + self.access_ttl_seconds,
            "jti": str(uuid.uuid4()),
        }
        encoded_header = _b64url(
            json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        encoded_payload = _b64url(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        signature = _b64url(hmac.new(self.secret, signing_input, hashlib.sha256).digest())
        return f"{encoded_header}.{encoded_payload}.{signature}"

    def verify(self, token: str, now: datetime | None = None) -> Principal:
        timestamp = now or _now()
        invalid = APIError(401, "TOKEN_INVALID", "The access token is invalid or expired.")
        try:
            encoded_header, encoded_payload, supplied_signature = token.split(".", 2)
            signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
            expected_signature = _b64url(
                hmac.new(self.secret, signing_input, hashlib.sha256).digest()
            )
            if not hmac.compare_digest(expected_signature, supplied_signature):
                raise invalid
            header = json.loads(_unb64url(encoded_header))
            payload = json.loads(_unb64url(encoded_payload))
            if header != {"alg": "HS256", "typ": "JWT"}:
                raise invalid
            required = {"iss", "aud", "sub", "sid", "roles", "iat", "exp", "jti"}
            if required - set(payload):
                raise invalid
            if payload["iss"] != self.issuer or payload["aud"] != self.audience:
                raise invalid
            if int(payload["iat"]) > int(timestamp.timestamp()) + 30:
                raise invalid
            if int(payload["exp"]) <= int(timestamp.timestamp()):
                raise invalid
            roles = tuple(payload["roles"])
            if not roles or not set(roles) <= ALLOWED_ROLES:
                raise invalid
            self.sessions.require_active(payload["sid"], payload["sub"], timestamp)
            return Principal(
                user_id=str(payload["sub"]),
                session_id=str(payload["sid"]),
                roles=roles,
                token_id=str(payload["jti"]),
            )
        except APIError:
            raise
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, base64.binascii.Error):
            raise invalid


class InMemoryAuthService:
    """Reference Auth application service; production storage is Patch 006."""

    def __init__(
        self,
        signing_secret: bytes,
        now: Callable[[], datetime] = _now,
        hasher: PasswordHasher | None = None,
    ) -> None:
        self.now = now
        self.hasher = hasher or PasswordHasher()
        self.sessions = InMemorySessionRegistry()
        self.tokens = TokenSigner(signing_secret, self.sessions)
        self._users_by_email: dict[str, dict[str, Any]] = {}
        self._users_by_id: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    @staticmethod
    def normalize_email(email: str) -> str:
        return str(email).strip().casefold()

    def register(self, email: str, password: str, display_name: str | None = None) -> dict[str, Any]:
        normalized = self.normalize_email(email)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The request contains invalid fields.",
                {"email": ["Enter a valid email address."]},
            )
        if not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise APIError(
                422,
                "VALIDATION_ERROR",
                "The request contains invalid fields.",
                {"password": ["Use between 12 and 256 characters."]},
            )
        with self._lock:
            if normalized in self._users_by_email:
                raise APIError(409, "STATE_CONFLICT", "An account already exists for this email.")
            user_id = str(uuid.uuid4())
            user = {
                "id": user_id,
                "email": normalized,
                "display_name": display_name,
                "password_hash": self.hasher.hash(password),
                "roles": ["USER"],
                "status": "ACTIVE",
            }
            self._users_by_email[normalized] = user
            self._users_by_id[user_id] = user
        return {"id": user_id, "email": normalized, "display_name": display_name, "roles": ["USER"]}

    def login(self, email: str, password: str) -> dict[str, Any]:
        normalized = self.normalize_email(email)
        with self._lock:
            user = self._users_by_email.get(normalized)
            valid = bool(user) and self.hasher.verify(password, user["password_hash"])
            if not valid or user["status"] != "ACTIVE":
                raise APIError(401, "TOKEN_INVALID", "The email or password is invalid.")
            timestamp = self.now()
            session_id = self.sessions.create(user["id"], timestamp + timedelta(days=30))
            token = self.tokens.issue(user["id"], session_id, user["roles"], now=timestamp)
            return {
                "access_token": token,
                "token_type": "Bearer",
                "expires_in": self.tokens.access_ttl_seconds,
                "session_id": session_id,
            }

    def authenticate(self, authorization_header: str) -> Principal:
        if not isinstance(authorization_header, str) or not authorization_header.startswith("Bearer "):
            raise APIError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        token = authorization_header[7:].strip()
        if not token:
            raise APIError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        return self.tokens.verify(token, now=self.now())

    def logout(self, authorization_header: str) -> None:
        principal = self.authenticate(authorization_header)
        self.sessions.revoke(principal.session_id, principal.user_id)

    def grant_role_for_test(self, user_id: str, role: str) -> None:
        """Reference-fixture helper; public registration never calls this method."""
        if role not in ALLOWED_ROLES:
            raise ValueError("ROLE_INVALID")
        with self._lock:
            user = self._users_by_id[str(user_id)]
            user["roles"] = sorted(set(user["roles"]) | {role})


class FixedWindowRateLimiter:
    def __init__(self) -> None:
        self._windows: dict[tuple[str, str], tuple[int, int]] = {}
        self._lock = threading.RLock()

    def require(
        self,
        policy: str,
        key: str,
        limit: int,
        window_seconds: int,
        now: datetime | None = None,
    ) -> int:
        timestamp = now or _now()
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("RATE_LIMIT_POLICY_INVALID")
        bucket = int(timestamp.timestamp()) // int(window_seconds)
        identity = (str(policy), str(key))
        with self._lock:
            current_bucket, count = self._windows.get(identity, (bucket, 0))
            if current_bucket != bucket:
                current_bucket, count = bucket, 0
            if count >= limit:
                retry_after = (bucket + 1) * window_seconds - int(timestamp.timestamp())
                raise APIError(
                    429,
                    "RATE_LIMITED",
                    "Too many requests. Try again later.",
                    {"retry_after_seconds": [str(max(1, retry_after))]},
                )
            count += 1
            self._windows[identity] = (current_bucket, count)
            return limit - count
