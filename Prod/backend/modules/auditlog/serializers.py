from rest_framework import serializers
from .models import AuditRecord


class AuditRecordSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.username", read_only=True, allow_null=True)

    class Meta:
        model = AuditRecord
        fields = ["id", "actor", "actor_name", "request_id", "action", "entity_type", "entity_id", "warehouse_id", "before", "after", "metadata", "occurred_at"]

