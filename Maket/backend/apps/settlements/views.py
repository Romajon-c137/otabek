from decimal import Decimal

from django.db.models import Sum
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.partners.models import Counterparty
from apps.warehouses.models import WarehouseAccess
from .models import Obligation, SettlementMovement
from .serializers import ObligationSerializer, SettlementMovementSerializer


class ObligationListView(APIView):
    """Все открытые обязательства: из них клиент собирает долги людей и итоговые суммы без запроса по каждому."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not request.user.is_superuser and not WarehouseAccess.objects.filter(user=request.user).exists():
            return Response({"detail": "Нет доступа."}, status=403)
        queryset = Obligation.objects.select_related("source_document").order_by("created_at", "id")
        if request.query_params.get("open", "true") == "true":
            queryset = queryset.filter(open_amount__gt=0)
        return Response({"results": [
            {
                "id": str(item.id), "counterparty": str(item.counterparty_id), "side": item.side,
                "source_document": str(item.source_document_id), "source_type": item.source_document.type,
                "source_number": item.source_document.number,
                "original_amount": str(item.original_amount), "open_amount": str(item.open_amount),
                "created_at": item.created_at.isoformat(),
            }
            for item in queryset
        ]})


class CounterpartySettlementView(APIView):
    mode = "balance"

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, counterparty_id):
        Counterparty.objects.get(pk=counterparty_id)
        if not request.user.is_superuser and not WarehouseAccess.objects.filter(user=request.user).exists():
            return Response({"detail": "Нет доступа."}, status=403)
        if self.mode == "obligations":
            queryset = Obligation.objects.filter(counterparty_id=counterparty_id).order_by("created_at", "id")
            if request.query_params.get("open") == "true":
                queryset = queryset.filter(open_amount__gt=0)
            return Response({"results": ObligationSerializer(queryset, many=True).data})
        if self.mode == "ledger":
            queryset = SettlementMovement.objects.select_related("document").filter(
                counterparty_id=counterparty_id,
            ).order_by("created_at", "id")
            return Response({"results": SettlementMovementSerializer(queryset, many=True).data})
        balance = SettlementMovement.objects.filter(counterparty_id=counterparty_id).aggregate(
            value=Sum("signed_amount"),
        )["value"] or Decimal("0.00")
        return Response({
            "counterparty_id": str(counterparty_id), "balance": str(balance),
            "meaning": "receivable" if balance > 0 else "payable" if balance < 0 else "settled",
        })
