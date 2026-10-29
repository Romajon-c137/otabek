from uuid import uuid4

from rest_framework import serializers
from .models import Party


class PartySerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True, required=False)

    class Meta:
        model = Party
        fields = ["id", "code", "name", "kind", "phone", "email", "address", "note", "system_key", "is_system", "is_active", "balance", "created_at", "updated_at"]
        read_only_fields = ["system_key", "is_system", "created_at", "updated_at"]
        extra_kwargs = {
            "code": {"required": False, "allow_blank": True},
            "kind": {"required": False},
        }

    def create(self, validated_data):
        validated_data["code"] = validated_data.get("code") or f"P-{uuid4().hex[:10].upper()}"
        validated_data["kind"] = Party.Kind.BOTH
        return super().create(validated_data)

