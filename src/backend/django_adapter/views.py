from __future__ import annotations

from rest_framework.exceptions import MethodNotAllowed
from rest_framework.views import APIView

from backend.django_adapter import runtime_auth, runtime_dashboard, runtime_learning
from backend.errors import APIError


class ContractEndpointView(APIView):
    """Route a frozen Stage 21 operation to a bound runtime provider.

    Runtime providers are bound incrementally. Auth, dashboard/next action,
    lesson reads, test creation, and the complete attempt cycle are PostgreSQL-backed. Operations without a
    production provider continue to fail closed with the Stage 21 dependency
    error rather than falling through to Django's HTML 404 surface.
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
        if operation_id == "listLessons":
            return runtime_learning.list_lessons_request(request)
        if operation_id == "getLesson":
            return runtime_learning.lesson_detail_request(
                request,
                lesson_id=kwargs.get("lessonId"),
            )
        if operation_id == "createTest":
            return runtime_learning.create_test_request(request)
        if operation_id == "startAttempt":
            return runtime_learning.start_attempt_request(
                request, test_id=kwargs.get("testId")
            )
        if operation_id == "getNextAttemptQuestion":
            return runtime_learning.next_attempt_question_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "submitAttemptAnswer":
            return runtime_learning.submit_attempt_answer_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "completeAttempt":
            return runtime_learning.complete_attempt_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "getAttemptResult":
            return runtime_learning.attempt_result_request(
                request, attempt_id=kwargs.get("attemptId")
            )
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
