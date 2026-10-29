from django.conf import settings
from django.db import models


class ImportBatch(models.Model):
    class Status(models.TextChoices):
        VALIDATED = "validated", "Проверен"
        APPLIED = "applied", "Применён"
        REJECTED = "rejected", "Отклонён"

    source_name = models.CharField(max_length=240)
    content_hash = models.CharField(max_length=64)
    rows = models.JSONField(default=list)
    errors = models.JSONField(default=list)
    status = models.CharField(max_length=12, choices=Status.choices)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="import_batches")
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["created_by", "created_at"], name="import_actor_time_idx")]
        constraints = [models.UniqueConstraint(fields=["content_hash"], condition=models.Q(status="applied"), name="uq_applied_import_hash")]

