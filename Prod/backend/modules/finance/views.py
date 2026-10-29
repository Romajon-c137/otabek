from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from modules.identity.permissions import visible_warehouse_ids
from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from .models import Obligation, ObligationSide, Payment, SettlementMovement
from .serializers import ManualDebtCreateSerializer, ObligationSerializer, PaymentCreateSerializer, PaymentSerializer, SettlementMovementSerializer, VoidPaymentSerializer
from .services import create_manual_debt, post_payment, void_payment


class ObligationViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = ObligationSerializer

    def get_queryset(self):
        queryset = Obligation.objects.select_related("party", "warehouse", "source_document").filter(warehouse_id__in=visible_warehouse_ids(self.request.user))
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(open_amount__gt=0, reversed_at__isnull=True)
        for param in ("party", "warehouse", "side"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param if param == "side" else f"{param}_id": value})
        return queryset.order_by("effective_date", "id")

    def create(self, request):
        serializer = ManualDebtCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        obligation = create_manual_debt(actor=request.user, warehouse=get_object_or_404(Warehouse, pk=data["warehouse_id"]), party=get_object_or_404(Party, pk=data["party_id"]), side=data["side"], amount=data["amount"], effective_date=data["effective_date"], reason=data["reason"], idempotency_key=request.headers.get("Idempotency-Key", ""))
        return Response(self.get_serializer(obligation).data, status=status.HTTP_201_CREATED)


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = PaymentSerializer

    def get_queryset(self):
        queryset = Payment.objects.select_related("party", "warehouse").filter(warehouse_id__in=visible_warehouse_ids(self.request.user))
        for param in ("party", "warehouse", "direction", "status"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param if param in {"direction", "status"} else f"{param}_id": value})
        return queryset.order_by("-effective_date", "-id")

    def create(self, request):
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        payment = post_payment(actor=request.user, warehouse=get_object_or_404(Warehouse, pk=data["warehouse_id"]), party=get_object_or_404(Party, pk=data["party_id"]), direction=data["direction"], method=data["method"], amount=data["amount"], effective_date=data["effective_date"], note=data.get("note", ""), idempotency_key=request.headers.get("Idempotency-Key", ""), applications=data.get("applications", []))
        return Response(self.get_serializer(payment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        serializer = VoidPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = void_payment(actor=request.user, payment=self.get_object(), reason=serializer.validated_data["reason"], idempotency_key=request.headers.get("Idempotency-Key", ""))
        return Response(self.get_serializer(payment).data)


class SettlementMovementViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = SettlementMovementSerializer

    def get_queryset(self):
        queryset = SettlementMovement.objects.filter(warehouse_id__in=visible_warehouse_ids(self.request.user)).order_by("-occurred_at", "-id")
        for param in ("party", "warehouse"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{f"{param}_id": value})
        return queryset

