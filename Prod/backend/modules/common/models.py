from __future__ import annotations

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class CommandReceipt(models.Model):
    class Status(models.TextChoices):
        STARTED = "started", "Выполняется"
        COMPLETED = "completed", "Завершена"

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    operation = models.CharField(max_length=80)
    key = models.CharField(max_length=120)
    request_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.STARTED)
    result_kind = models.CharField(max_length=80, blank=True)
    result_id = models.CharField(max_length=64, blank=True)
    response_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["actor", "operation", "key"], name="uq_command_actor_operation_key")
        ]
        indexes = [models.Index(fields=["created_at"], name="command_created_idx")]

