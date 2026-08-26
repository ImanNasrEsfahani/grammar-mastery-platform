from __future__ import annotations

from rest_framework.exceptions import MethodNotAllowed
from rest_framework.views import APIView

from backend.django_adapter import (
    runtime_attempt_result,
    runtime_auth,
    runtime_dashboard,
    runtime_history,
    runtime_learning,
    runtime_review,
    runtime_search,
    runtime_streak,
)
from backend.errors import APIError


class ContractEndpointView(APIView):
    """Route a frozen Stage 21 operation or an explicitly additive UI provider.

    Runtime providers are bound incrementally. History, Grammar Search and the
    Streak Detail surface are additive learner providers and intentionally stay
    outside ROUTE_OPERATION_IDS so the frozen Stage 21 operation set remains
    contract compatible.
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
            return runtime_review.submit_attempt_answer_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "completeAttempt":
            return runtime_learning.complete_attempt_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "getAttemptResult":
            return runtime_attempt_result.attempt_result_request(
                request, attempt_id=kwargs.get("attemptId")
            )
        if operation_id == "listReviews":
            return runtime_review.list_reviews_request(request)
        if operation_id == "getReviewItem":
            return runtime_review.get_review_item_request(
                request, review_id=kwargs.get("reviewId")
            )
        if operation_id == "gradeReview":
            return runtime_review.grade_review_request(
                request, review_id=kwargs.get("reviewId")
            )
        if operation_id == "revealReviewAnswer":
            return runtime_review.reveal_review_answer_request(
                request, review_id=kwargs.get("reviewId")
            )
        if operation_id == "setReviewMark":
            return runtime_review.set_review_mark_request(
                request, review_id=kwargs.get("reviewId")
            )
        if operation_id == "getDashboard":
            return runtime_review.dashboard_request(request)
        if operation_id == "getCurrentNextAction":
            return runtime_review.next_action_request(request)
        if operation_id == "listHistory":
            return runtime_history.history_request(request)
        if operation_id == "searchGrammar":
            return runtime_search.grammar_search_request(request)
        if operation_id == "getStreakDetail":
            return runtime_streak.streak_detail_request(request)

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
