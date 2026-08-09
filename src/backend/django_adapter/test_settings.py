"""Minimal settings used only by Stage 21 adapter contract tests."""

SECRET_KEY = "stage21-tests-only-not-for-deployment"
DEBUG = False
USE_TZ = True
TIME_ZONE = "UTC"
ALLOWED_HOSTS = ["testserver"]
INSTALLED_APPS = [
    "rest_framework",
    "backend.django_adapter",
]
MIDDLEWARE = [
    "backend.django_adapter.middleware.RequestIdMiddleware",
]
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "backend.django_adapter.authentication.Stage21BearerAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "backend.django_adapter.permissions.HasStage21Role",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "EXCEPTION_HANDLER": "backend.django_adapter.exceptions.stage21_exception_handler",
}

