from rest_framework import serializers


class CurrentUserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    is_superuser = serializers.BooleanField()
    warehouses = serializers.ListField(child=serializers.DictField())

