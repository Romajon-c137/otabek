from django.db.models import DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from modules.auditlog.services import record_action
from modules.finance.models import ObligationSide
from modules.identity.models import UserRole
from modules.identity.permissions import require_role
from .models import Party
from .serializers import PartySerializer


class PartyViewSet(viewsets.ModelViewSet):
    serializer_class = PartySerializer
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        queryset = Party.objects.all()
        query = self.request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(code__icontains=query) | Q(phone__icontains=query))
        return queryset

    def perform_create(self, serializer):
        require_role(self.request.user, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
        party = serializer.save()
        record_action(actor=self.request.user, action="party.created", entity=party, after=self.get_serializer(party).data)

    def perform_update(self, serializer):
        require_role(self.request.user, UserRole.OWNER, UserRole.MANAGER)
        if serializer.instance.is_system:
            raise ValidationError("Системного розничного покупателя нельзя изменять.")
        before = self.get_serializer(serializer.instance).data
        party = serializer.save()
        record_action(actor=self.request.user, action="party.updated", entity=party, before=before, after=self.get_serializer(party).data)

