from decimal import Decimal

from django.db.models import Sum
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.documents.models import BuyerReturnLine, Document, SaleLine
from apps.inventory.models import StockBalance
from apps.warehouses.models import WarehouseAccess


def allowed_warehouses(user):
    if user.is_superuser:
        return None
    return list(WarehouseAccess.objects.filter(user=user).values_list("warehouse_id", flat=True))


class StockReportView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        queryset = StockBalance.objects.select_related("warehouse", "product").order_by("warehouse__name", "product__name")
        allowed = allowed_warehouses(request.user)
        if allowed is not None:
            queryset = queryset.filter(warehouse_id__in=allowed)
        warehouse = request.query_params.get("warehouse")
        if warehouse:
            queryset = queryset.filter(warehouse_id=warehouse)
        return Response({"results": [
            {
                "warehouse_id": str(item.warehouse_id), "warehouse": item.warehouse.name,
                "product_id": str(item.product_id), "code": item.product.code,
                "product": item.product.name, "unit": item.product.unit,
                "quantity": str(item.quantity), "reserved": str(item.reserved),
                "available": str(item.quantity - item.reserved), "cost": str(item.cost),
            }
            for item in queryset
        ]})


class SalesReportView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        sales = SaleLine.objects.select_related(
            "sale__document", "product", "sale__document__warehouse", "sale__document__counterparty",
        ).filter(sale__document__status=Document.Status.POSTED)
        returns = BuyerReturnLine.objects.select_related(
            "buyer_return__document", "product", "buyer_return__document__warehouse",
        ).filter(buyer_return__document__status=Document.Status.POSTED)
        allowed = allowed_warehouses(request.user)
        if allowed is not None:
            sales = sales.filter(sale__document__warehouse_id__in=allowed)
            returns = returns.filter(buyer_return__document__warehouse_id__in=allowed)
        warehouse = request.query_params.get("warehouse")
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if warehouse:
            sales = sales.filter(sale__document__warehouse_id=warehouse)
            returns = returns.filter(buyer_return__document__warehouse_id=warehouse)
        if date_from:
            sales = sales.filter(sale__document__posted_at__date__gte=date_from)
            returns = returns.filter(buyer_return__document__posted_at__date__gte=date_from)
        if date_to:
            sales = sales.filter(sale__document__posted_at__date__lte=date_to)
            returns = returns.filter(buyer_return__document__posted_at__date__lte=date_to)

        sale_totals = sales.aggregate(amount=Sum("amount"), cost=Sum("cost"))
        return_totals = returns.aggregate(amount=Sum("amount"), cost=Sum("cost"))
        revenue = (sale_totals["amount"] or Decimal("0.00")) - (return_totals["amount"] or Decimal("0.00"))
        cost = (sale_totals["cost"] or Decimal("0.00")) - (return_totals["cost"] or Decimal("0.00"))
        return Response({
            "totals": {
                "revenue": str(revenue), "cost": str(cost),
                "gross_profit": str(revenue - cost),
                "returns": str(return_totals["amount"] or Decimal("0.00")),
            },
            "results": [
                {
                    "document_id": str(line.sale.document_id), "number": line.sale.document.number,
                    "posted_at": line.sale.document.posted_at, "counterparty": line.sale.document.counterparty.name,
                    "product_id": str(line.product_id), "product": line.product_name,
                    "quantity": str(line.quantity), "amount": str(line.amount),
                    "cost": str(line.cost), "gross_profit": str(line.amount - line.cost),
                }
                for line in sales.order_by("-sale__document__posted_at", "position")
            ],
        })


class AuditReportView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not request.user.is_superuser and not WarehouseAccess.objects.filter(
            user=request.user, role=WarehouseAccess.Role.ADMIN,
        ).exists():
            raise PermissionDenied("Журнал аудита доступен администратору.")
        events = AuditEvent.objects.select_related("actor", "document")[:500]
        return Response({"results": [
            {
                "id": str(event.id), "created_at": event.created_at,
                "actor": event.actor.get_username(), "action": event.action,
                "document_id": str(event.document_id) if event.document_id else None,
                "reason": event.reason, "request_id": str(event.request_id),
            }
            for event in events
        ]})
