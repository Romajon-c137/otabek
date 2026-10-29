from django.db import connection
from django.http import JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(exclude=True)
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return JsonResponse({"status": "ok"})

