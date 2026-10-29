from django.db import connection
from rest_framework import serializers
from rest_framework.generics import GenericAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


class HealthSerializer(serializers.Serializer):
    status = serializers.CharField()
    database = serializers.CharField()
    api_version = serializers.CharField()


class HealthView(GenericAPIView):
    permission_classes = [AllowAny]
    serializer_class = HealthSerializer

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return Response(self.get_serializer({"status": "ok", "database": "ok", "api_version": "v1"}).data)

