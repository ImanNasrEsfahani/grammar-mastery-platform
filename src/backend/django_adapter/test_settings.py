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
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
REST_FRAMEWORK = {
    "UNAUTHENTICATED_USER": None,
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

STAGE21_JWT_SIGNING_KEY = "tests-only-signing-key-" + ("x" * 48)
STAGE21_JWT_KEY_ID = "tests-v1"
STAGE21_JWT_ISSUER = "grammar-mastery"
STAGE21_JWT_AUDIENCE = "grammar-mastery-api"
STAGE21_JWT_ACCESS_TTL_SECONDS = 900
STAGE21_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
STAGE21_TOKEN_VERIFIER = (
    "backend.django_adapter.runtime_auth.verify_authorization_header"
)
