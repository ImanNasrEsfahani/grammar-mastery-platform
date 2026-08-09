from __future__ import annotations

from rest_framework.permissions import BasePermission

from backend.errors import not_found
from backend.security import Principal


class HasStage21Role(BasePermission):
    """Enforce view.required_roles against server-verified principal roles."""

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        required = set(getattr(view, "required_roles", ()))
        if not required:
            return False
        if "PUBLIC" in required:
            return True
        principal = getattr(request, "auth", None)
        return isinstance(principal, Principal) and bool(required & set(principal.roles))


def enforce_owner(principal: Principal, resource_owner_id: str) -> None:
    """Conceal cross-owner learner resources as a normal not-found result."""

    if str(principal.user_id) != str(resource_owner_id):
        raise not_found()

