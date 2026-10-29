from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.audit.models import AuditEvent
from apps.warehouses.models import WarehouseAccess
from .models import Payment
from .serializers import PaymentReadSerializer, PaymentWriteSerializer, PostPaymentSerializer
from .services import post_payment


class PaymentViewSet(ModelViewSet):
    queryset = Payment.objects.all()
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        if not self.request.user.is_superuser and not WarehouseAccess.objects.filter(user=self.request.user).exists():
            return Payment.objects.none()
        queryset = Payment.objects.select_related("document", "document__counterparty", "document__author", "source_document").prefetch_related("breakdown")
        params = self.request.query_params
        if params.get("counterparty"):
            queryset = queryset.filter(document__counterparty_id=params["counterparty"])
        if params.get("status"):
            queryset = queryset.filter(document__status=params["status"])
        if params.get("manual") == "true":
            queryset = queryset.filter(source_document__isnull=True)
        return queryset.order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return PaymentWriteSerializer
        if self.action == "post_document":
            return PostPaymentSerializer
        return PaymentReadSerializer

    def _ensure_write_access(self):
        if self.request.user.is_superuser:
            return
        if not WarehouseAccess.objects.filter(
            user=self.request.user, role__in=[WarehouseAccess.Role.ADMIN, WarehouseAccess.Role.SELLER],
        ).exists():
            raise PermissionDenied("Нет права проводить платежи.")

    @transaction.atomic
    def perform_create(self, serializer):
        self._ensure_write_access()
        payment = serializer.save()
        AuditEvent.objects.create(actor=self.request.user, action="payment.created", document=payment.document)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(PaymentReadSerializer(serializer.instance).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        self._ensure_write_access()
        payment = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = request.headers.get("Idempotency-Key", "").strip()
        if not key:
            raise ValidationError({"Idempotency-Key": "Для проведения укажите ключ идемпотентности."})
        result = post_payment(
            payment_id=payment.pk, actor=request.user,
            version=serializer.validated_data["version"], idempotency_key=key,
            requested_allocations=serializer.validated_data["allocations"],
        )
        return Response(result)
