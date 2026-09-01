from __future__ import annotations

from django.urls import path

from backend.django_adapter.views import ContractEndpointView


PUBLIC = ("PUBLIC",)
USER = ("USER",)
AUTHENTICATED = ("USER", "ADMIN", "CONTENT_EDITOR", "REVIEWER")
ADMIN = ("ADMIN",)
VIEW_BANK = ("ADMIN", "CONTENT_EDITOR", "REVIEWER")
EDIT_DRAFT = ("ADMIN", "CONTENT_EDITOR")
REVIEW = ("ADMIN", "REVIEWER")
RETIRE_REQUEST = ("CONTENT_EDITOR", "REVIEWER")
AUDIT = ("ADMIN", "REVIEWER")


# route, {HTTP method: Stage21 operationId}, {HTTP method: accepted roles}
ROUTE_SPECS = [
    ("auth/register", {"POST": "registerUser"}, {"POST": PUBLIC}),
    ("auth/login", {"POST": "loginUser"}, {"POST": PUBLIC}),
    ("auth/logout", {"POST": "logoutUser"}, {"POST": AUTHENTICATED}),
    ("lessons", {"GET": "listLessons"}, {"GET": USER}),
    ("lessons/<str:lessonId>", {"GET": "getLesson"}, {"GET": USER}),
    ("tests", {"POST": "createTest"}, {"POST": USER}),
    ("tests/<str:testId>", {"GET": "getTest"}, {"GET": USER}),
    ("tests/<str:testId>/attempts", {"POST": "startAttempt"}, {"POST": USER}),
    ("attempts/<str:attemptId>/next", {"GET": "getNextAttemptQuestion"}, {"GET": USER}),
    ("attempts/<str:attemptId>/answers", {"POST": "submitAttemptAnswer"}, {"POST": USER}),
    ("attempts/<str:attemptId>/complete", {"POST": "completeAttempt"}, {"POST": USER}),
    ("attempts/<str:attemptId>/result", {"GET": "getAttemptResult"}, {"GET": USER}),
    ("reviews", {"GET": "listReviews"}, {"GET": USER}),
    ("reviews/<str:reviewId>", {"GET": "getReviewItem"}, {"GET": USER}),
    ("reviews/<str:reviewId>/grade", {"POST": "gradeReview"}, {"POST": USER}),
    ("reviews/<str:reviewId>/reveal", {"POST": "revealReviewAnswer"}, {"POST": USER}),
    ("reviews/<str:reviewId>/mark", {"PUT": "setReviewMark"}, {"PUT": USER}),
    ("mastery", {"GET": "getMastery"}, {"GET": USER}),
    ("progress", {"GET": "getProgress"}, {"GET": USER}),
    ("dashboard", {"GET": "getDashboard"}, {"GET": USER}),
    ("next-actions/current", {"GET": "getCurrentNextAction"}, {"GET": USER}),
    ("analytics/jobs", {"POST": "createAnalyticsJob"}, {"POST": ADMIN}),
    ("analytics/jobs/<str:jobId>", {"GET": "getAnalyticsJob"}, {"GET": ADMIN}),
    ("admin/questions", {"GET": "listAdminQuestions", "POST": "createAdminQuestionDraft"}, {"GET": VIEW_BANK, "POST": EDIT_DRAFT}),
    ("admin/questions/<str:questionId>", {"PATCH": "createAdminQuestionRevision"}, {"PATCH": EDIT_DRAFT}),
    ("admin/questions/<str:questionId>/review", {"POST": "reviewAdminQuestion"}, {"POST": REVIEW}),
    ("admin/questions/<str:questionId>/retire", {"POST": "retireAdminQuestion"}, {"POST": ADMIN}),
    ("admin/questions/<str:questionId>/retire-request", {"POST": "requestAdminQuestionRetirement"}, {"POST": RETIRE_REQUEST}),
    ("admin/imports/preview", {"POST": "previewAdminImport"}, {"POST": EDIT_DRAFT}),
    ("admin/imports/commit", {"POST": "commitAdminImport"}, {"POST": EDIT_DRAFT}),
    ("admin/questions/bulk-status/preview", {"POST": "previewAdminBulkStatus"}, {"POST": EDIT_DRAFT}),
    ("admin/questions/bulk-status/commit", {"POST": "commitAdminBulkStatus"}, {"POST": EDIT_DRAFT}),
    ("admin/audit-log", {"GET": "listAdminAuditEvents"}, {"GET": AUDIT}),
]


def _view(operations, roles_by_method):
    kwargs = {"operations": operations, "required_roles_by_method": roles_by_method}
    if roles_by_method and all("PUBLIC" in tuple(roles) for roles in roles_by_method.values()):
        kwargs["authentication_classes"] = []
    return ContractEndpointView.as_view(**kwargs)


urlpatterns = []
for route, operations, roles_by_method in ROUTE_SPECS:
    route_name = next(iter(operations.values())) if len(operations) == 1 else "adminQuestions"
    urlpatterns.append(path(route, _view(operations, roles_by_method), name=route_name))

# Additive learner/UI providers. These intentionally stay outside the frozen
# Stage 21 ROUTE_SPECS/ROUTE_OPERATION_IDS contract.
urlpatterns.append(path("history", _view({"GET": "listHistory"}, {"GET": USER}), name="listHistory"))
urlpatterns.append(path("search", _view({"GET": "searchGrammar"}, {"GET": USER}), name="searchGrammar"))
urlpatterns.append(path("streak", _view({"GET": "getStreakDetail"}, {"GET": USER}), name="getStreakDetail"))
urlpatterns.append(path("account", _view({"GET": "getAccountSummary"}, {"GET": AUTHENTICATED}), name="getAccountSummary"))
urlpatterns.append(path("mastery-map", _view({"GET": "getMasteryMap"}, {"GET": USER}), name="getMasteryMap"))

# Real persisted notifications. Read state belongs to the server, not localStorage.
urlpatterns.append(path("notifications", _view({"GET": "listNotifications"}, {"GET": USER}), name="listNotifications"))
urlpatterns.append(path("notifications/unread-count", _view({"GET": "getNotificationUnreadCount"}, {"GET": USER}), name="getNotificationUnreadCount"))
urlpatterns.append(path("notifications/seen", _view({"POST": "markNotificationsSeen"}, {"POST": USER}), name="markNotificationsSeen"))
urlpatterns.append(path("notifications/read-all", _view({"POST": "markAllNotificationsRead"}, {"POST": USER}), name="markAllNotificationsRead"))
urlpatterns.append(path("notifications/<str:notificationId>/read", _view({"POST": "markNotificationRead"}, {"POST": USER}), name="markNotificationRead"))


ROUTE_OPERATION_IDS = frozenset(
    operation_id
    for _, operations, _ in ROUTE_SPECS
    for operation_id in operations.values()
)
