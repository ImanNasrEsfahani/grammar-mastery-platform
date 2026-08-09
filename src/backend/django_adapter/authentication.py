from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from backend.errors import APIError
from backend.security import Principal


@dataclass(frozen=True)
class Stage21DjangoUser:
    """Small authenticated-user facade backed by a Stage 21 Principal."""

    principal: Principal

    @property
    def id(self) -> str:
        return self.principal.user_id

    @property
    def pk(self) -> str:
        return self.principal.user_id

    @property
    def roles(self) -> tuple[str, ...]:
        return self.principal.roles

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_active(self) -> bool:
        return True

    @property
    def is_staff(self) -> bool:
        return bool({"ADMIN", "CONTENT_EDITOR", "REVIEWER"} & set(self.roles))

    def __str__(self) -> str:
        return self.principal.user_id


def _token_verifier() -> Callable[[str], Principal]:
    configured: Any = getattr(settings, "STAGE21_TOKEN_VERIFIER", None)
    if isinstance(configured, str):
        configured = import_string(configured)
    if not callable(configured):
        raise ImproperlyConfigured(
            "STAGE21_TOKEN_VERIFIER must be a callable or dotted callable path."
        )
    return configured


class Stage21BearerAuthentication(BaseAuthentication):
    """Authenticate a DRF request through the selected Stage 21 auth service."""

    keyword = b"bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if parts[0].lower() != self.keyword:
            return None
        if len(parts) != 2:
            raise APIError(401, "TOKEN_INVALID", "The access token is invalid or expired.")
        try:
            token = parts[1].decode("ascii")
        except UnicodeDecodeError as error:
            raise APIError(
                401, "TOKEN_INVALID", "The access token is invalid or expired."
            ) from error
        principal = _token_verifier()(f"Bearer {token}")
        if not isinstance(principal, Principal):
            raise ImproperlyConfigured(
                "STAGE21_TOKEN_VERIFIER must return backend.security.Principal."
            )
        return Stage21DjangoUser(principal), principal

    def authenticate_header(self, request) -> str:
        return "Bearer"

