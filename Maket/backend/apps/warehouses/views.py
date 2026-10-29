from rest_framework.permissions import IsAdminUser
from rest_framework.viewsets import ModelViewSet

from .models import Warehouse
from .serializers import WarehouseSerializer


class WarehouseViewSet(ModelViewSet):
    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer

    def get_queryset(self):
        queryset = Warehouse.objects.prefetch_related("user_accesses")
        if self.request.user.is_superuser:
            return queryset
        return queryset.filter(user_accesses__user=self.request.user).distinct()

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [IsAdminUser()]
        return super().get_permissions()

# Create your views here.
