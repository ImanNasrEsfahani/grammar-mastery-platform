from __future__ import annotations

from rest_framework.exceptions import MethodNotAllowed
from rest_framework.views import APIView

from backend.django_adapter import runtime_auth, runtime_dashboard
from backend.errors import APIError


class ContractEndpointView(APIView):
    """Route a frozen Stage 21 operation to a bound runtime provider.

    The Stage 26 routing hotfix established the complete HTTP surface. Runtime
    providers are bound incrementally. Auth plus the Stage 18 dashboard/next
    action surfaces are now PostgreSQL-backed; operations without a production
    provider continue to fail closed with the Stage 21 JSON dependency error.
    """

    operations: dict[str, str] = {}
    required_roles_by_method: dict[str, tuple[str, ...]] = {}
    required_roles: tuple[str, ...] = ()

    def _dispatch_contract(self, request, *args, **kwargs):
        operation_id = self.operations.get(request.method.upper())
        if operation_id is None:
            raise MethodNotAllowed(request.method)

        if operation_id == "registerUser":
            return runtime_auth.register_request(request)
        if operation_id == "loginUser":
            return runtime_auth.login_request(request)
        if operation_id == "logoutUser":
            return runtime_auth.logout_request(request)
        if operation_id == "getDashboard":
            return runtime_dashboard.dashboard_request(request)
        if operation_id == "getCurrentNextAction":
            return runtime_dashboard.next_action_request(request)

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
