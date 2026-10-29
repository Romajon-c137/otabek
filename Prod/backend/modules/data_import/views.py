from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from .models import ImportBatch
from .services import apply_batch, make_template, validate_workbook
from modules.warehouses.models import Warehouse


class TemplateView(APIView):
    @extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY})
    def get(self, request):
        response = HttpResponse(make_template(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = 'attachment; filename="hozuchet-initial-data-template.xlsx"'
        return response


class ValidateImportView(APIView):
    parser_classes = [MultiPartParser]

    @extend_schema(request={"multipart/form-data": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}, "required": ["file"]}}, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        if "file" not in request.FILES:
            return Response({"file": ["Выберите XLSX-файл."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            batch = validate_workbook(request.FILES["file"], request.user)
        except (ValueError, OSError) as exc:
            return Response({"file": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        total_rows = sum(len(items) for items in batch.rows.values()) if isinstance(batch.rows, dict) else len(batch.rows)
        return Response({"id": batch.id, "status": batch.status, "rows": total_rows, "sections": {key: len(value) for key, value in batch.rows.items()}, "errors": batch.errors}, status=status.HTTP_201_CREATED)


class ApplyImportView(APIView):
    @extend_schema(request={"application/json": {"type": "object", "properties": {"warehouse_id": {"type": "integer"}}, "required": ["warehouse_id"]}}, responses={200: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        batch = get_object_or_404(ImportBatch, pk=pk)
        warehouse = get_object_or_404(Warehouse, pk=request.data.get("warehouse_id"))
        try:
            result = apply_batch(batch, request.user, warehouse)
        except ValueError as exc:
            return Response({"batch": [str(exc)]}, status=status.HTTP_409_CONFLICT)
        return Response(result)

