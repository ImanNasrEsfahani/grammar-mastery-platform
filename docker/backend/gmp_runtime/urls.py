from __future__ import annotations

from django.db import connection
from django.http import JsonResponse
from django.urls import include, path


RUNTIME_VERSION = "docker-runtime-v1.0.2-postgres-auth"


def live(_request):
    return JsonResponse({"status": "ok", "runtime": RUNTIME_VERSION})


def ready(_request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        # Do not leak driver, host, database, or credential information.
        return JsonResponse(
            {"status": "not_ready", "runtime": RUNTIME_VERSION},
            status=503,
        )
    return JsonResponse({"status": "ready", "runtime": RUNTIME_VERSION})


urlpatterns = [
    # Stage 21 contract surface.  The frontend proxy targets /api/v1/*.
    path("api/v1/", include("backend.django_adapter.urls")),
    path("health/live", live, name="health-live"),
    path("health/ready", ready, name="health-ready"),
]
