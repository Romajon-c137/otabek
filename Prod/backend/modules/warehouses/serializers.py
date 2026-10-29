from rest_framework import serializers
from .models import Warehouse


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "code", "name", "address", "is_active", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

