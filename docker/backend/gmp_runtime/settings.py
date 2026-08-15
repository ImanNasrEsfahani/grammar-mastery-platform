from __future__ import annotations

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parents[3]
APP_ENV = os.getenv("APP_ENV", "staging").strip().lower()


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be an integer.") from exc


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if len(SECRET_KEY) < 50 or "CHANGE_ME" in SECRET_KEY:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be injected at runtime and be at least 50 characters."
    )

DEBUG = APP_ENV == "development" and _bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = _csv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,backend")
if APP_ENV == "production" and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS is required in production.")

USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"

INSTALLED_APPS = [
    "rest_framework",
    "backend.django_adapter",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "backend.django_adapter.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "gmp_runtime.urls"
WSGI_APPLICATION = "gmp_runtime.wsgi.application"
ASGI_APPLICATION = "gmp_runtime.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DJANGO_DB_NAME", os.getenv("POSTGRES_DB", "grammar_mastery")),
        "USER": os.getenv("DJANGO_DB_USER", os.getenv("POSTGRES_USER", "grammar_mastery")),
        "PASSWORD": os.getenv("DJANGO_DB_PASSWORD", os.getenv("POSTGRES_PASSWORD", "")),
        "HOST": os.getenv("DJANGO_DB_HOST", "postgres"),
        "PORT": os.getenv("DJANGO_DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {"sslmode": os.getenv("DJANGO_DB_SSLMODE", "prefer")},
    }
}

if not DATABASES["default"]["PASSWORD"]:
    raise ImproperlyConfigured("A PostgreSQL password must be injected at runtime.")

# Stage 25: new credentials are Argon2id; Django PBKDF2 remains available only
# for verification/upgrade of older Django-format hashes.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# Auth signing material is injected through .env.docker / secret management and
# is intentionally distinct from DJANGO_SECRET_KEY. A previous key can be kept
# temporarily during rotation; tokens are selected by non-secret kid.
STAGE21_JWT_SIGNING_KEY = os.getenv("STAGE21_JWT_SIGNING_KEY", "")
STAGE21_JWT_KEY_ID = os.getenv("STAGE21_JWT_KEY_ID", "primary-v1")
STAGE21_JWT_PREVIOUS_SIGNING_KEY = os.getenv(
    "STAGE21_JWT_PREVIOUS_SIGNING_KEY", ""
)
STAGE21_JWT_PREVIOUS_KEY_ID = os.getenv("STAGE21_JWT_PREVIOUS_KEY_ID", "")
STAGE21_JWT_ISSUER = os.getenv("STAGE21_JWT_ISSUER", "grammar-mastery")
STAGE21_JWT_AUDIENCE = os.getenv(
    "STAGE21_JWT_AUDIENCE", "grammar-mastery-api"
)
STAGE21_JWT_ACCESS_TTL_SECONDS = _int(
    "STAGE21_JWT_ACCESS_TTL_SECONDS", 24 * 60 * 60
)
STAGE21_SESSION_TTL_SECONDS = _int(
    "STAGE21_SESSION_TTL_SECONDS", 30 * 24 * 60 * 60
)
STAGE21_TOKEN_VERIFIER = (
    "backend.django_adapter.runtime_auth.verify_authorization_header"
)

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

# TLS is expected to terminate at a trusted reverse proxy on the Linux host or
# at a separately managed edge. Do not expose the backend directly to Internet.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SECURE_SSL_REDIRECT = _bool("DJANGO_SECURE_SSL_REDIRECT", False)
CSRF_TRUSTED_ORIGINS = _csv("DJANGO_CSRF_TRUSTED_ORIGINS")

# The Stage 25 browser session boundary lives on the same-origin Next.js layer.
SESSION_COOKIE_SECURE = APP_ENV == "production"
CSRF_COOKIE_SECURE = APP_ENV == "production"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "concise": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "concise",
        }
    },
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}
