from django.conf import settings
from django.db import models


class ImmutableAuditQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise RuntimeError("Записи аудита неизменяемы.")

    def delete(self):
        raise RuntimeError("Записи аудита нельзя удалять.")


class AuditRecord(models.Model):
    objects = ImmutableAuditQuerySet.as_manager()

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name="audit_records")
    request_id = models.CharField(max_length=80, blank=True)
    action = models.CharField(max_length=80)
    entity_type = models.CharField(max_length=80)
    entity_id = models.CharField(max_length=64)
    warehouse_id = models.BigIntegerField(null=True, blank=True)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id", "occurred_at"], name="audit_entity_time_idx"),
            models.Index(fields=["warehouse_id", "occurred_at"], name="audit_warehouse_time_idx"),
            models.Index(fields=["actor", "occurred_at"], name="audit_actor_time_idx"),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise RuntimeError("Записи аудита неизменяемы.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Записи аудита нельзя удалять.")

