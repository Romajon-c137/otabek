from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "development-only-key-change-before-deploy")
if not DEBUG and len(SECRET_KEY) < 50:
    raise RuntimeError("DJANGO_SECRET_KEY must contain at least 50 characters in production")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver")
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "Asia/Bishkek")
LANGUAGE_CODE = "ru-ru"
USE_I18N = True
USE_TZ = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "modules.common",
    "modules.auditlog",
    "modules.warehouses",
    "modules.identity",
    "modules.catalog",
    "modules.parties",
    "modules.documents",
    "modules.inventory",
    "modules.finance",
    "modules.reporting",
    "modules.data_import",
    "modules.syncfeed",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "modules.common.middleware.RequestIdentityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]


def database_settings() -> dict:
    raw = os.getenv("DATABASE_URL")
    postgres_host = os.getenv("POSTGRES_HOST", "").strip()
    if not raw and postgres_host:
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "hozuchet"),
            "USER": os.getenv("POSTGRES_USER", "hozuchet"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
            "HOST": postgres_host,
            "PORT": int(os.getenv("POSTGRES_PORT", "5432")),
            "CONN_MAX_AGE": 60,
            "OPTIONS": {"connect_timeout": 5},
        }
    if not raw:
        sqlite_path = os.getenv("HOZUCHET_SQLITE_PATH", str(BASE_DIR / "development.sqlite3"))
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": sqlite_path,
            # SQLite is a development-only fallback, but it still serves the
            # long-poll endpoint concurrently with UI writes. WAL plus an
            # immediate transaction avoids read-to-write upgrade failures.
            "OPTIONS": {
                "timeout": 20,
                "transaction_mode": "IMMEDIATE",
                "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=20000",
            },
        }
    parsed = urlparse(raw)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must use PostgreSQL")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "localhost",
        "PORT": parsed.port or 5432,
        "CONN_MAX_AGE": 60,
        "OPTIONS": {"connect_timeout": 5},
    }


DATABASES = {"default": database_settings()}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "modules.identity.authentication.ExpiringTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "modules.common.pagination.StandardPagination",
    "PAGE_SIZE": 50,
    "EXCEPTION_HANDLER": "modules.common.exceptions.api_exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "ХозУчёт API",
    "DESCRIPTION": "Продажи, складской учёт и взаиморасчёты",
    "VERSION": "2.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "12"))
OTABEK_API_URL = os.getenv("OTABEK_API_URL", "https://otabek.glasscenter.kg/api")
OTABEK_USERNAME = os.getenv("OTABEK_USERNAME", "")
OTABEK_PASSWORD = os.getenv("OTABEK_PASSWORD", "")
OTABEK_TIMEOUT_SECONDS = int(os.getenv("OTABEK_TIMEOUT_SECONDS", "15"))
OTABEK_IMAGE_MAX_BYTES = int(os.getenv("OTABEK_IMAGE_MAX_BYTES", str(20 * 1024 * 1024)))
OTABEK_IMAGE_MAX_SIZE = int(os.getenv("OTABEK_IMAGE_MAX_SIZE", "640"))
OTABEK_IMAGE_WEBP_QUALITY = int(os.getenv("OTABEK_IMAGE_WEBP_QUALITY", "76"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"standard": {"format": "{asctime} {levelname} request_id={request_id} {name}: {message}", "style": "{"}},
    "filters": {"request_id": {"()": "modules.common.logging.RequestIdFilter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "filters": ["request_id"], "formatter": "standard"}},
    "root": {"handlers": ["console"], "level": os.getenv("DJANGO_LOG_LEVEL", "INFO")},
}

