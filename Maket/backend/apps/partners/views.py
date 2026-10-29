from django.db.models import Q
from rest_framework.exceptions import ValidationError
from rest_framework.viewsets import ModelViewSet

from apps.access.permissions import CatalogPermission
from .models import Counterparty
from .serializers import CounterpartySerializer


class CounterpartyViewSet(ModelViewSet):
    serializer_class = CounterpartySerializer
    permission_classes = [CatalogPermission]

    def get_queryset(self):
        queryset = Counterparty.objects.all()
        query = self.request.query_params.get("search", "").strip()
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(code__icontains=query) | Q(phone__icontains=query))
        return queryset

    def perform_destroy(self, instance):
        if instance.is_system:
            raise ValidationError({"detail": "Системного контрагента удалить нельзя."})
        if instance.documents.exists():
            raise ValidationError({"detail": "Контрагент используется в документах; отключите активность."})
        instance.delete()

# Create your views here.
