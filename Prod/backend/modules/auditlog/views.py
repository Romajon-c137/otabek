from django.db.models import Q
from rest_framework import viewsets

from modules.identity.models import UserRole
from modules.identity.permissions import require_role, visible_warehouse_ids
from .models import AuditRecord
from .serializers import AuditRecordSerializer


class AuditRecordViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = AuditRecordSerializer

    def get_queryset(self):
        require_role(self.request.user, UserRole.OWNER, UserRole.AUDITOR)
        warehouse_scope = Q(warehouse_id__in=visible_warehouse_ids(self.request.user)) | Q(warehouse_id__isnull=True)
        queryset = AuditRecord.objects.select_related("actor").filter(warehouse_scope)
        for param in ("action", "entity_type", "entity_id", "request_id"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param: value})
        return queryset

