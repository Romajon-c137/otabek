import uuid

from django.conf import settings
from django.db import models


class ImportBatch(models.Model):
    class State(models.TextChoices):
        VALID = "valid", "Проверен"
        INVALID = "invalid", "Есть ошибки"
        APPLIED = "applied", "Применён"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    checksum = models.CharField(max_length=64, db_index=True)
    file_name = models.CharField(max_length=255)
    state = models.CharField(max_length=16, choices=State.choices)
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, related_name="import_batches")
    payload = models.JSONField(default=dict)
    errors = models.JSONField(default=list)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="import_batches")
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["checksum"], condition=models.Q(state="applied"),
                name="unique_applied_import_checksum",
            ),
        ]
