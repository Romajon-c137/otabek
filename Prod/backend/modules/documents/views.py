from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django.utils.html import escape

from modules.parties.models import Party
from modules.warehouses.models import Warehouse
from modules.identity.permissions import visible_warehouse_ids
from .models import TradeDocument
from .serializers import AssemblyStateSerializer, CancelSerializer, PostDocumentSerializer, TradeDocumentSerializer, TradeDocumentWriteSerializer
from .services import cancel_document, confirm_order, create_document, delete_draft, fulfill_order, post_document, set_order_assembled, update_document


class TradeDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = r"\d+"
    serializer_class = TradeDocumentSerializer

    def get_queryset(self):
        queryset = TradeDocument.objects.select_related("warehouse", "party", "source_document").prefetch_related("lines__product", "lines__neighbor_supply__supplier", "extra_costs").filter(warehouse_id__in=visible_warehouse_ids(self.request.user))
        kinds = [item for item in self.request.query_params.get("kind", "").split(",") if item]
        if kinds:
            queryset = queryset.filter(kind__in=kinds)
        for param in ("status", "warehouse", "party"):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{param if param == "status" else f"{param}_id": value})
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            queryset = queryset.filter(effective_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(effective_date__lte=date_to)
        return queryset

    def create(self, request):
        serializer = TradeDocumentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        warehouse = get_object_or_404(Warehouse, pk=data["warehouse_id"])
        party = get_object_or_404(Party, pk=data["party_id"]) if data.get("party_id") else None
        document = create_document(actor=request.user, warehouse=warehouse, kind=data["kind"], effective_date=data["effective_date"], party=party, note=data.get("note", ""), lines=data["lines"], document_discount_amount=data.get("document_discount_amount", 0), extra_costs=data.get("extra_costs", []))
        return Response(self.get_serializer(document).data, status=status.HTTP_201_CREATED)

    def update(self, request, pk=None):
        current = self.get_object()
        if "version" not in request.data:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"version": "Передайте версию редактируемого черновика."})
        serializer = TradeDocumentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["kind"] != current.kind or data["warehouse_id"] != current.warehouse_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Вид документа и склад нельзя менять после создания.")
        party = get_object_or_404(Party, pk=data["party_id"]) if data.get("party_id") else None
        document = update_document(actor=request.user, document=current, expected_version=data.get("version", current.version), effective_date=data["effective_date"], party=party, note=data.get("note", ""), lines=data["lines"], document_discount_amount=data.get("document_discount_amount", 0), extra_costs=data.get("extra_costs", []))
        return Response(self.get_serializer(document).data)

    def destroy(self, request, pk=None):
        delete_draft(actor=request.user, document=self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _key(self, request):
        return request.headers.get("Idempotency-Key", "")

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        serializer = PostDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = post_document(actor=request.user, document=self.get_object(), idempotency_key=self._key(request), **serializer.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        result = confirm_order(actor=request.user, document=self.get_object(), idempotency_key=self._key(request))
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def assembled(self, request, pk=None):
        serializer = AssemblyStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = set_order_assembled(actor=request.user, document=self.get_object(), idempotency_key=self._key(request), **serializer.validated_data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def fulfill(self, request, pk=None):
        result = fulfill_order(actor=request.user, document=self.get_object(), idempotency_key=self._key(request))
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        serializer = CancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = cancel_document(actor=request.user, document=self.get_object(), reason=serializer.validated_data["reason"], idempotency_key=self._key(request))
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["get"], url_path="assembly-sheet")
    def assembly_sheet(self, request, pk=None):
        order = self.get_object()
        if order.kind != "customer_order":
            return Response({"detail": "Лист сборки доступен только для заказа."}, status=status.HTTP_409_CONFLICT)
        rows = "".join(
            f"<tr><td>{line.position}</td><td>{escape(line.product_name)}</td><td>{line.quantity} {escape(line.unit)}</td><td>{line.unit_price}</td><td>{line.line_total}</td><td></td></tr>"
            for line in order.lines.all()
        )
        html = f"""<!doctype html><html lang='ru'><head><meta charset='utf-8'><title>Лист сборки {escape(order.number)}</title><style>@page{{size:A4;margin:12mm}}body{{font:13px Arial;color:#111}}h1{{font-size:20px}}table{{width:100%;border-collapse:collapse}}th,td{{border:1px solid #555;padding:6px}}thead{{display:table-header-group}}.meta{{margin-bottom:12px}}</style></head><body><h1>Лист сборки</h1><div class='meta'>Заказ: {escape(order.number)} · Дата: {order.effective_date}<br>Контрагент: {escape(order.party.name if order.party else '—')}<br>Комментарий: {escape(order.note)}</div><table><thead><tr><th>№</th><th>Товар</th><th>Количество</th><th>Цена</th><th>Сумма</th><th>Собрано</th></tr></thead><tbody>{rows}</tbody><tfoot><tr><td colspan='4'>Итого</td><td>{order.amount_total}</td><td></td></tr></tfoot></table></body></html>"""
        return HttpResponse(html, content_type="text/html; charset=utf-8")

