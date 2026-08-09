from __future__ import annotations

from rest_framework.exceptions import MethodNotAllowed
from rest_framework.views import APIView

from backend.errors import APIError


class ContractEndpointView(APIView):
    """Route a frozen Stage 21 operation without inventing a missing provider.

    This hotfix fixes the transport/routing defect only.  Once Django resolves
    the operation and DRF has completed authentication/authorization, an
    unbound runtime service fails closed with the Stage 21 JSON error contract
    instead of falling through to Django's HTML 404 page.
    """

    operations: dict[str, str] = {}
    required_roles_by_method: dict[str, tuple[str, ...]] = {}
    required_roles: tuple[str, ...] = ()

    def _dispatch_contract(self, request, *args, **kwargs):
        operation_id = self.operations.get(request.method.upper())
        if operation_id is None:
            raise MethodNotAllowed(request.method)
        raise APIError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "The API endpoint is routed, but its runtime service provider is not bound in this deployment.",
        )

    def get(self, request, *args, **kwargs):
        return self._dispatch_contract(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        return self._dispatch_contract(request, *args, **kwargs)

    def put(self, request, *args, **kwargs):
        return self._dispatch_contract(request, *args, **kwargs)

    def patch(self, request, *args, **kwargs):
        return self._dispatch_contract(request, *args, **kwargs)

    def delete(self, request, *args, **kwargs):
        return self._dispatch_contract(request, *args, **kwargs)
