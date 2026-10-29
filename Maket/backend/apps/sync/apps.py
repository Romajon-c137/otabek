from django.apps import AppConfig


class SyncConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sync"
    verbose_name = "Синхронизация клиентов"

    def ready(self):
        from . import signals  # noqa: F401
