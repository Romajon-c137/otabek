import uuid

from django.conf import settings
from django.db import models


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="audit_events")
    action = models.CharField(max_length=64)
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, null=True, blank=True, related_name="audit_events")
    reason = models.TextField(blank=True)
    request_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

# Create your models here.
