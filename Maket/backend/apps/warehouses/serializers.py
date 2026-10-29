from rest_framework import serializers

from .models import Warehouse, WarehouseAccess


class WarehouseSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Warehouse
        fields = ["id", "code", "name", "active", "role", "created_at", "updated_at"]
        read_only_fields = ["id", "role", "created_at", "updated_at"]

    def get_role(self, obj) -> str | None:
        user = self.context["request"].user
        if user.is_superuser:
            return WarehouseAccess.Role.ADMIN
        access = next((item for item in obj.user_accesses.all() if item.user_id == user.id), None)
        return access.role if access else None

