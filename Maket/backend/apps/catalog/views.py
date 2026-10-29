from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework.exceptions import ValidationError

from apps.access.permissions import CatalogPermission
from .models import Category, Product
from .serializers import CategorySerializer, ProductSerializer


class CategoryViewSet(ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [CatalogPermission]
    queryset = Category.objects.all()
    pagination_class = None

    def perform_destroy(self, instance):
        if instance.products.exists():
            raise ValidationError({"detail": "В категории есть товары: сначала переместите их."})
        instance.delete()


class ProductViewSet(ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [CatalogPermission]

    def get_queryset(self):
        queryset = Product.objects.select_related("category")
        category = self.request.query_params.get("category", "").strip()
        if category:
            queryset = queryset.filter(category_id=category)
        query = self.request.query_params.get("search", "").strip()
        active = self.request.query_params.get("active")
        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(variant_name__icontains=query)
                | Q(code__icontains=query)
                | Q(category__name__icontains=query)
            )
        if active in {"true", "false"}:
            queryset = queryset.filter(active=active == "true")
        return queryset

    @action(detail=False, methods=["post"], url_path="sync-otabek")
    def sync_otabek(self, request):
        from apps.warehouses.models import WarehouseAccess
        from .otabek import OtabekError, sync_products
        is_admin = request.user.is_superuser or WarehouseAccess.objects.filter(
            user=request.user, role=WarehouseAccess.Role.ADMIN,
        ).exists()
        if not is_admin:
            return Response({"detail": "Обновлять каталог Otabek может только администратор."}, status=status.HTTP_403_FORBIDDEN)
        try:
            result = sync_products()
        except OtabekError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(result)

    def perform_destroy(self, instance):
        if instance.stock_movements.exists() or instance.receipt_lines.exists() or instance.sale_lines.exists():
            raise ValidationError({"detail": "Товар используется в учёте; отключите активность."})
        instance.delete()
