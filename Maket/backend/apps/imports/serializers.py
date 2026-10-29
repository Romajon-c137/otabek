from rest_framework import serializers

from apps.warehouses.models import Warehouse


class ValidateImportSerializer(serializers.Serializer):
    file = serializers.FileField()
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.filter(active=True))


class ApplyImportSerializer(serializers.Serializer):
    checksum = serializers.CharField(min_length=64, max_length=64)
