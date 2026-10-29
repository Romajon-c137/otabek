from rest_framework import viewsets

from modules.auditlog.services import record_action
from modules.identity.models import UserRole
from modules.identity.permissions import require_role, visible_warehouse_ids
from .models import Warehouse
from .serializers import WarehouseSerializer


class WarehouseViewSet(viewsets.ModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = WarehouseSerializer
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        return Warehouse.objects.filter(id__in=visible_warehouse_ids(self.request.user))

    def perform_create(self, serializer):
        require_role(self.request.user, UserRole.OWNER)
        warehouse = serializer.save()
        record_action(actor=self.request.user, action="warehouse.created", entity=warehouse, warehouse_id=warehouse.pk, after=serializer.data)

    def perform_update(self, serializer):
        require_role(self.request.user, UserRole.OWNER)
        before = WarehouseSerializer(serializer.instance).data
        warehouse = serializer.save()
        record_action(actor=self.request.user, action="warehouse.updated", entity=warehouse, warehouse_id=warehouse.pk, before=before, after=serializer.data)

