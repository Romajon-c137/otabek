from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from modules.auditlog.services import record_action
from modules.identity.models import UserRole
from modules.identity.permissions import require_role
from .models import Category, Product
from .serializers import CategorySerializer, ProductSerializer


class AuditedCatalogViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def perform_create(self, serializer):
        require_role(self.request.user, UserRole.OWNER, UserRole.MANAGER)
        entity = serializer.save()
        record_action(actor=self.request.user, action=f"{entity._meta.model_name}.created", entity=entity, after=self.get_serializer(entity).data)

    def perform_update(self, serializer):
        require_role(self.request.user, UserRole.OWNER, UserRole.MANAGER)
        before = self.get_serializer(serializer.instance).data
        entity = serializer.save()
        record_action(actor=self.request.user, action=f"{entity._meta.model_name}.updated", entity=entity, before=before, after=self.get_serializer(entity).data)


class CategoryViewSet(AuditedCatalogViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer


class ProductViewSet(AuditedCatalogViewSet):
    queryset = Product.objects.select_related("category").all()
    serializer_class = ProductSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        query = self.request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(sku__icontains=query) | Q(barcode__icontains=query))
        active = self.request.query_params.get("active")
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        category = self.request.query_params.get("category")
        if category:
            queryset = queryset.filter(category_id=category)
        return queryset

    @action(detail=False, methods=["post"], url_path="sync-otabek")
    def sync_otabek(self, request):
        require_role(request.user, UserRole.OWNER, UserRole.MANAGER)
        from .otabek import OtabekSyncError, sync_otabek_catalog
        try:
            result = sync_otabek_catalog()
        except OtabekSyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        record_action(actor=request.user, action="catalog.otabek_synced", entity=request.user, after=result)
        return Response(result)

