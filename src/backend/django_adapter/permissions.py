from __future__ import annotations

from rest_framework.permissions import BasePermission

from backend.errors import not_found
from backend.security import Principal


class HasStage21Role(BasePermission):
    """Enforce the frozen Stage 21 role contract.

    A route may expose more than one HTTP operation (for example
    GET+POST /admin/questions), so the hotfix also supports a
    required_roles_by_method mapping without weakening the existing
    required_roles behavior.
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        by_method = getattr(view, "required_roles_by_method", None)
        if isinstance(by_method, dict):
            required = set(by_method.get(str(request.method).upper(), ()))
        else:
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
