from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.audit.models import AuditEvent
from apps.warehouses.models import WarehouseAccess
from .calculations import allocate_money, money
from .models import (BuyerReturn, CustomerOrder, Document, OpeningStock, Receipt, Sale,
                     SupplierReturn)
from .serializers import (BuyerReturnReadSerializer, BuyerReturnWriteSerializer,
                          CompleteOrderSerializer, CustomerOrderReadSerializer,
                          CustomerOrderWriteSerializer, DocumentSerializer,
                          OpeningStockReadSerializer, OpeningStockWriteSerializer,
                          PostBuyerReturnWithRefundSerializer, PostDocumentSerializer,
                          PostSaleWithPaymentSerializer, PostSupplierReturnWithPaymentSerializer,
                          ReceiptReadSerializer, ReceiptWriteSerializer, ReverseDocumentSerializer,
                          SaleReadSerializer, SaleWriteSerializer, SupplierReturnReadSerializer,
                          SupplierReturnWriteSerializer)
from .services import (complete_order_sale, post_buyer_return, post_buyer_return_with_refund,
                       post_opening_stock, post_receipt, post_receipt_with_payment, post_sale,
                       post_sale_with_payment, post_supplier_return, post_supplier_return_with_payment,
                       reserve_order, reverse_document, transition_order)


def _filter_documents(queryset, request, state_field=None):
    """Общие фильтры списков: ?status=posted, ?state=reserved (заказы), ?counterparty=<id>."""
    params = request.query_params
    if params.get("status") and not state_field:
        queryset = queryset.filter(document__status=params["status"])
    if params.get("state") and state_field:
        queryset = queryset.filter(**{state_field: params["state"]})
    if params.get("counterparty"):
        queryset = queryset.filter(document__counterparty_id=params["counterparty"])
    return queryset


def _sale_like_preview(lines):
    rows = []
    total = 0
    for position, item in enumerate(lines, start=1):
        gross = money(item["quantity"] * item["price"])
        amount = money(gross - item["discount"])
        total += amount
        rows.append({
            "position": position, "product": str(item["product"].id),
            "gross": str(gross), "discount": str(item["discount"]), "amount": str(amount),
        })
    return {"lines": rows, "total": str(money(total))}


def _detach_draft_audit(document):
    """Keep audit history when a disposable draft is removed."""
    for event in document.audit_events.all():
        event.payload = {
            **event.payload,
            "deleted_document_id": str(document.id),
            "deleted_document_type": document.type,
            "deleted_document_number": document.number,
        }
        event.document = None
        event.save(update_fields=["payload", "document"])


class DocumentAccessMixin:
    """Общее для документов склада: права на запись, ключ идемпотентности, ответ полным документом."""

    write_roles = (WarehouseAccess.Role.ADMIN, WarehouseAccess.Role.SELLER)
    write_denied = "Нет права изменять документы этого склада."
    read_serializer_class = None
    audit_prefix = ""

    def _ensure_write_access(self, warehouse):
        if self.request.user.is_superuser:
            return
        if not WarehouseAccess.objects.filter(user=self.request.user, warehouse=warehouse, role__in=self.write_roles).exists():
            raise PermissionDenied(self.write_denied)

    def _idempotency_key(self):
        key = self.request.headers.get("Idempotency-Key", "").strip()
        if not key:
            raise ValidationError({"Idempotency-Key": "Для проведения укажите ключ идемпотентности."})
        return key

    def _command_args(self, document):
        """Проверка прав и тела команды: возвращает поля (версия и др.) и ключ идемпотентности."""
        self._ensure_write_access(document.warehouse)
        serializer = self.get_serializer(data=self.request.data)
        serializer.is_valid(raise_exception=True)
        return dict(serializer.validated_data), self._idempotency_key()

    def _restricted(self, queryset):
        if not self.request.user.is_superuser:
            queryset = queryset.filter(document__warehouse__user_accesses__user=self.request.user)
        return queryset

    def _read(self, instance):
        return self.read_serializer_class(instance, context=self.get_serializer_context()).data

    def _audit(self, action, document=None, reason=""):
        AuditEvent.objects.create(actor=self.request.user, action=f"{self.audit_prefix}.{action}", document=document, reason=reason)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(self._read(serializer.instance), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(self._read(serializer.instance))

    @transaction.atomic
    def perform_create(self, serializer):
        self._ensure_write_access(serializer.validated_data["warehouse"])
        instance = serializer.save()
        self._audit("created", instance.document)

    @transaction.atomic
    def perform_update(self, serializer):
        self._ensure_write_access(serializer.instance.document.warehouse)
        instance = serializer.save()
        self._audit("updated", instance.document)

    @transaction.atomic
    def perform_destroy(self, instance):
        self._ensure_write_access(instance.document.warehouse)
        if instance.document.status != Document.Status.DRAFT:
            raise ValidationError({"detail": "Удалить можно только черновик."})
        self._audit("deleted", reason=str(instance.document))
        _detach_draft_audit(instance.document)
        instance.document.delete()


class DocumentViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Создавайте документ через его типовой endpoint.")

    def get_queryset(self):
        queryset = Document.objects.select_related("warehouse", "counterparty", "author")
        if not self.request.user.is_superuser:
            queryset = queryset.filter(warehouse__user_accesses__user=self.request.user)
        status_value = self.request.query_params.get("status")
        doc_type = self.request.query_params.get("type")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if doc_type:
            queryset = queryset.filter(type=doc_type)
        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse(self, request, pk=None):
        document = self.get_object()
        self._ensure_write_access(document.warehouse)
        serializer = ReverseDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(reverse_document(
            document_id=document.id, actor=request.user,
            version=serializer.validated_data["version"],
            reason=serializer.validated_data["reason"], idempotency_key=self._idempotency_key(),
        ))


class OpeningStockViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = OpeningStock.objects.all()
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    read_serializer_class = OpeningStockReadSerializer
    audit_prefix = "opening_stock"
    write_roles = (WarehouseAccess.Role.ADMIN,)
    write_denied = "Начальные остатки может вводить только администратор склада."

    def get_queryset(self):
        queryset = OpeningStock.objects.select_related("document", "document__warehouse").prefetch_related("lines")
        return self._restricted(queryset).distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action in ["create", "partial_update", "calculate"]:
            return OpeningStockWriteSerializer
        if self.action == "post_document":
            return PostDocumentSerializer
        return OpeningStockReadSerializer

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        opening = self.get_object()
        data, key = self._command_args(opening.document)
        return Response(post_opening_stock(opening_id=opening.pk, actor=request.user, version=data["version"], idempotency_key=key))


class BuyerReturnViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = BuyerReturn.objects.all()
    http_method_names = ["get", "post", "head", "options"]
    read_serializer_class = BuyerReturnReadSerializer
    audit_prefix = "buyer_return"
    write_denied = "Нет права оформлять возврат на этот склад."

    def get_queryset(self):
        queryset = BuyerReturn.objects.select_related(
            "document", "document__warehouse", "document__counterparty", "source_sale",
        ).prefetch_related("lines")
        return _filter_documents(self._restricted(queryset), self.request).distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return BuyerReturnWriteSerializer
        if self.action == "post_document":
            return PostDocumentSerializer
        if self.action == "post_with_refund":
            return PostBuyerReturnWithRefundSerializer
        return BuyerReturnReadSerializer

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        buyer_return = self.get_object()
        data, key = self._command_args(buyer_return.document)
        return Response(post_buyer_return(return_id=buyer_return.pk, actor=request.user, version=data["version"], idempotency_key=key))

    @action(detail=True, methods=["post"], url_path="post-with-refund")
    def post_with_refund(self, request, pk=None):
        buyer_return = self.get_object()
        data, key = self._command_args(buyer_return.document)
        return Response(post_buyer_return_with_refund(
            return_id=buyer_return.pk, actor=request.user, version=data["version"], idempotency_key=key,
            breakdown=data["breakdown"],
        ))


class CustomerOrderViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = CustomerOrder.objects.all()
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    read_serializer_class = CustomerOrderReadSerializer
    audit_prefix = "order"
    write_denied = "Нет права изменять заказы этого склада."

    def get_queryset(self):
        queryset = CustomerOrder.objects.select_related(
            "document", "document__warehouse", "document__counterparty", "completed_sale",
        ).prefetch_related("lines")
        return _filter_documents(self._restricted(queryset), self.request, state_field="state").distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action in ["create", "partial_update", "calculate"]:
            return CustomerOrderWriteSerializer
        if self.action == "sale":
            return CompleteOrderSerializer
        if self.action in ["reserve", "assembled", "ship", "unship", "release", "cancel"]:
            return PostDocumentSerializer
        return CustomerOrderReadSerializer

    @action(detail=False, methods=["post"])
    def calculate(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._ensure_write_access(serializer.validated_data["warehouse"])
        return Response(_sale_like_preview(serializer.validated_data["lines"]))

    @transaction.atomic
    def perform_destroy(self, instance):
        # у заказа своё состояние: удалить можно только новый (черновик)
        self._ensure_write_access(instance.document.warehouse)
        if instance.state != CustomerOrder.State.DRAFT:
            raise ValidationError({"detail": "Удалить можно только черновик заказа."})
        super().perform_destroy(instance)

    def _command(self, request, operation):
        order = self.get_object()
        data, key = self._command_args(order.document)
        kwargs = dict(order_id=order.pk, actor=request.user, version=data["version"], idempotency_key=key)
        if operation == "reserve":
            return Response(reserve_order(**kwargs))
        if operation == "sale":
            return Response(complete_order_sale(**kwargs, breakdown=data.get("breakdown", [])))
        return Response(transition_order(**kwargs, action=operation))

    @action(detail=True, methods=["post"])
    def reserve(self, request, pk=None):
        return self._command(request, "reserve")

    @action(detail=True, methods=["post"])
    def assembled(self, request, pk=None):
        return self._command(request, "assembled")

    @action(detail=True, methods=["post"])
    def ship(self, request, pk=None):
        return self._command(request, "ship")

    @action(detail=True, methods=["post"])
    def unship(self, request, pk=None):
        return self._command(request, "unship")

    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        return self._command(request, "release")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._command(request, "cancel")

    @action(detail=True, methods=["post"])
    def sale(self, request, pk=None):
        return self._command(request, "sale")

    @action(detail=True, methods=["get"], url_path="assembly-sheet")
    def assembly_sheet(self, request, pk=None):
        order = self.get_object()
        return Response({
            "number": order.document.number,
            "counterparty": order.document.counterparty.name,
            "warehouse": order.document.warehouse.name,
            "state": order.state,
            "lines": [
                {
                    "position": line.position, "code": line.product_code,
                    "name": line.product_name, "quantity": str(line.quantity), "unit": line.unit,
                }
                for line in order.lines.order_by("position")
            ],
        })


class SupplierReturnViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = SupplierReturn.objects.all()
    http_method_names = ["get", "post", "head", "options"]
    read_serializer_class = SupplierReturnReadSerializer
    audit_prefix = "supplier_return"
    write_denied = "Нет права оформлять возврат с этого склада."

    def get_queryset(self):
        queryset = SupplierReturn.objects.select_related(
            "document", "document__warehouse", "document__counterparty", "source_receipt",
        ).prefetch_related("lines")
        return _filter_documents(self._restricted(queryset), self.request).distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return SupplierReturnWriteSerializer
        if self.action == "post_document":
            return PostDocumentSerializer
        if self.action == "post_with_payment":
            return PostSupplierReturnWithPaymentSerializer
        return SupplierReturnReadSerializer

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        supplier_return = self.get_object()
        data, key = self._command_args(supplier_return.document)
        return Response(post_supplier_return(return_id=supplier_return.pk, actor=request.user, version=data["version"], idempotency_key=key))

    @action(detail=True, methods=["post"], url_path="post-with-payment")
    def post_with_payment(self, request, pk=None):
        supplier_return = self.get_object()
        data, key = self._command_args(supplier_return.document)
        return Response(post_supplier_return_with_payment(
            return_id=supplier_return.pk, actor=request.user, version=data["version"], idempotency_key=key,
            breakdown=data["breakdown"],
        ))


class ReceiptViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = Receipt.objects.all()
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    read_serializer_class = ReceiptReadSerializer
    audit_prefix = "receipt"

    def get_queryset(self):
        queryset = Receipt.objects.select_related("document", "document__warehouse", "document__counterparty", "document__author").prefetch_related("lines", "extra_costs")
        return _filter_documents(self._restricted(queryset), self.request).distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action in ["create", "partial_update", "calculate"]:
            return ReceiptWriteSerializer
        if self.action == "post_document":
            return PostDocumentSerializer
        if self.action == "post_with_payment":
            return PostSaleWithPaymentSerializer
        return ReceiptReadSerializer

    @action(detail=False, methods=["post"])
    def calculate(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        self._ensure_write_access(data["warehouse"])
        goods = [money(item["quantity"] * item["price"]) for item in data["lines"]]
        extra_total = money(sum((item["amount"] for item in data.get("extra_costs", [])), 0))
        try:
            allocated = allocate_money(extra_total, goods)
        except Exception as exc:
            raise ValidationError({"extra_costs": getattr(exc, "messages", [str(exc)])}) from exc
        return Response({
            "lines": [
                {
                    "position": index + 1, "product": str(item["product"].id),
                    "goods_amount": str(goods[index]), "allocated_extra_cost": str(allocated[index]),
                    "total_cost": str(money(goods[index] + allocated[index])),
                }
                for index, item in enumerate(data["lines"])
            ],
            "totals": {
                "goods": str(money(sum(goods, 0))), "extra_costs": str(extra_total),
                "total": str(money(sum(goods, 0) + extra_total)),
            },
        })

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        receipt = self.get_object()
        data, key = self._command_args(receipt.document)
        return Response(post_receipt(receipt_id=receipt.pk, actor=request.user, version=data["version"], idempotency_key=key))

    @action(detail=True, methods=["post"], url_path="post-with-payment")
    def post_with_payment(self, request, pk=None):
        receipt = self.get_object()
        data, key = self._command_args(receipt.document)
        return Response(post_receipt_with_payment(
            receipt_id=receipt.pk, actor=request.user, version=data["version"], idempotency_key=key,
            breakdown=data["breakdown"],
        ))


class SaleViewSet(DocumentAccessMixin, ModelViewSet):
    queryset = Sale.objects.all()
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    read_serializer_class = SaleReadSerializer
    audit_prefix = "sale"

    def get_queryset(self):
        queryset = Sale.objects.select_related("document", "document__warehouse", "document__counterparty", "document__author").prefetch_related("lines")
        return _filter_documents(self._restricted(queryset), self.request).distinct().order_by("-document__created_at")

    def get_serializer_class(self):
        if self.action in ["create", "partial_update", "calculate"]:
            return SaleWriteSerializer
        if self.action == "post_document":
            return PostDocumentSerializer
        if self.action == "post_with_payment":
            return PostSaleWithPaymentSerializer
        return SaleReadSerializer

    @action(detail=False, methods=["post"])
    def calculate(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._ensure_write_access(serializer.validated_data["warehouse"])
        return Response(_sale_like_preview(serializer.validated_data["lines"]))

    @action(detail=True, methods=["post"], url_path="post")
    def post_document(self, request, pk=None):
        sale = self.get_object()
        data, key = self._command_args(sale.document)
        return Response(post_sale(sale_id=sale.pk, actor=request.user, version=data["version"], idempotency_key=key))

    @action(detail=True, methods=["post"], url_path="post-with-payment")
    def post_with_payment(self, request, pk=None):
        sale = self.get_object()
        data, key = self._command_args(sale.document)
        return Response(post_sale_with_payment(
            sale_id=sale.pk, actor=request.user, version=data["version"], idempotency_key=key,
            breakdown=data["breakdown"],
        ))
