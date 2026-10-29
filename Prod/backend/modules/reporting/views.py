from decimal import Decimal

from django.db.models import DecimalField, ExpressionWrapper, F, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from modules.documents.models import DocumentKind, DocumentStatus, TradeDocument, TradeLine
from modules.finance.models import Obligation, ObligationSide, Payment
from modules.identity.permissions import visible_warehouse_ids
from modules.inventory.models import StockLevel, StockLot, StockMovement
from modules.catalog.models import Product
from modules.warehouses.models import Warehouse


MONEY = DecimalField(max_digits=18, decimal_places=2)


def scoped_warehouses(request):
    visible = list(visible_warehouse_ids(request.user))
    requested = request.query_params.get("warehouse")
    if requested:
        try:
            warehouse_id = int(requested)
        except ValueError:
            return []
        return [warehouse_id] if warehouse_id in visible else []
    return visible


class DashboardReportView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        warehouse_ids = scoped_warehouses(request)
        sales = TradeDocument.objects.filter(warehouse_id__in=warehouse_ids, kind=DocumentKind.SALE, status=DocumentStatus.POSTED)
        payments = Payment.objects.filter(warehouse_id__in=warehouse_ids, status=Payment.Status.POSTED)
        obligations = Obligation.objects.filter(warehouse_id__in=warehouse_ids, reversed_at__isnull=True)
        return Response({
            "sales_total": sales.aggregate(value=Coalesce(Sum("amount_total"), Value(Decimal("0.00")), output_field=MONEY))["value"],
            "incoming_total": payments.filter(direction=Payment.Direction.INCOMING).aggregate(value=Coalesce(Sum("amount"), Value(Decimal("0.00")), output_field=MONEY))["value"],
            "outgoing_total": payments.filter(direction=Payment.Direction.OUTGOING).aggregate(value=Coalesce(Sum("amount"), Value(Decimal("0.00")), output_field=MONEY))["value"],
            "receivable_open": obligations.filter(side=ObligationSide.RECEIVABLE).aggregate(value=Coalesce(Sum("open_amount"), Value(Decimal("0.00")), output_field=MONEY))["value"],
            "payable_open": obligations.filter(side=ObligationSide.PAYABLE).aggregate(value=Coalesce(Sum("open_amount"), Value(Decimal("0.00")), output_field=MONEY))["value"],
            "posted_sales_count": sales.count(),
        })


class StockReportView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        warehouse_ids = scoped_warehouses(request)
        products = Product.objects.filter(is_active=True).select_related("category")
        query = request.query_params.get("q", "").strip()
        if query:
            products = products.filter(Q(name__icontains=query) | Q(sku__icontains=query) | Q(barcode__icontains=query) | Q(variant_name__icontains=query))
        warehouses = list(Warehouse.objects.filter(id__in=warehouse_ids))
        levels = {(item.warehouse_id, item.product_id): item for item in StockLevel.objects.filter(warehouse_id__in=warehouse_ids, product__in=products)}
        costs = {}
        for lot in StockLot.objects.filter(warehouse_id__in=warehouse_ids, product__in=products, remaining_quantity__gt=0):
            key = (lot.warehouse_id, lot.product_id)
            costs[key] = costs.get(key, Decimal("0.00")) + lot.remaining_quantity * lot.unit_cost
        rows = []
        for warehouse in warehouses:
            for product in products.order_by("name", "variant_name"):
                level = levels.get((warehouse.id, product.id))
                quantity = level.quantity if level else Decimal("0.000")
                reserved = level.reserved if level else Decimal("0.000")
                rows.append({"warehouse_id": warehouse.id, "warehouse_name": warehouse.name, "product_id": product.id, "product_name": product.name, "variant_name": product.variant_name, "track_stock": product.track_stock, "sku": product.sku, "category": product.category.name if product.category else "", "quantity": quantity, "reserved": reserved, "available": quantity - reserved, "inventory_value": costs.get((warehouse.id, product.id), Decimal("0.00")).quantize(Decimal("0.01")), "retail_value": (quantity * product.retail_price).quantize(Decimal("0.01"))})
        return Response({
            "rows": rows,
            "totals": {
                "quantity": sum((row["quantity"] for row in rows), Decimal("0.000")),
                "reserved": sum((row["reserved"] for row in rows), Decimal("0.000")),
                "retail_value": sum((row["retail_value"] for row in rows), Decimal("0.00")),
                "inventory_value": sum((row["inventory_value"] for row in rows), Decimal("0.00")),
            },
        })


class SalesReportView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        lines = TradeLine.objects.filter(document__warehouse_id__in=scoped_warehouses(request), document__kind__in=[DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN], document__status=DocumentStatus.POSTED)
        if request.query_params.get("date_from"):
            lines = lines.filter(document__effective_date__gte=request.query_params["date_from"])
        if request.query_params.get("date_to"):
            lines = lines.filter(document__effective_date__lte=request.query_params["date_to"])
        grouped = {}
        for line in lines.select_related("document"):
            row = grouped.setdefault(line.product_id, {"product_id": line.product_id, "product_name": line.product_name, "quantity": Decimal("0.000"), "gross": Decimal("0.00"), "discount": Decimal("0.00"), "returns": Decimal("0.00"), "revenue": Decimal("0.00")})
            sign = Decimal("-1") if line.document.kind == DocumentKind.CUSTOMER_RETURN else Decimal("1")
            row["quantity"] += sign * line.quantity
            if sign > 0:
                row["gross"] += line.quantity * line.unit_price
                row["discount"] += line.discount_amount
                row["revenue"] += line.line_total
            else:
                row["returns"] += line.line_total
                row["revenue"] -= line.line_total
        rows = sorted(grouped.values(), key=lambda item: item["product_name"])
        return Response({"rows": rows, "totals": {"quantity": sum((row["quantity"] for row in rows), Decimal("0.000")), "gross": sum((row["gross"] for row in rows), Decimal("0.00")), "discount": sum((row["discount"] for row in rows), Decimal("0.00")), "returns": sum((row["returns"] for row in rows), Decimal("0.00")), "revenue": sum((row["revenue"] for row in rows), Decimal("0.00"))}})


class GrossProfitReportView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        warehouse_ids = scoped_warehouses(request)
        lines = TradeLine.objects.filter(document__warehouse_id__in=warehouse_ids, document__kind__in=[DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN], document__status=DocumentStatus.POSTED).select_related("document")
        movements = StockMovement.objects.filter(warehouse_id__in=warehouse_ids, document__kind__in=[DocumentKind.SALE, DocumentKind.CUSTOMER_RETURN], document__status=DocumentStatus.POSTED).select_related("product", "document")
        for key, lookup in (("date_from", "document__effective_date__gte"), ("date_to", "document__effective_date__lte")):
            if request.query_params.get(key):
                lines = lines.filter(**{lookup: request.query_params[key]})
                movements = movements.filter(**{lookup: request.query_params[key]})
        grouped = {}
        for line in lines:
            row = grouped.setdefault(line.product_id, {"product_id": line.product_id, "product_name": line.product_name, "revenue": Decimal("0.00"), "cost": Decimal("0.00"), "gross_profit": Decimal("0.00")})
            row["revenue"] += line.line_total if line.document.kind == DocumentKind.SALE else -line.line_total
        for movement in movements:
            row = grouped.setdefault(movement.product_id, {"product_id": movement.product_id, "product_name": movement.product.name, "revenue": Decimal("0.00"), "cost": Decimal("0.00"), "gross_profit": Decimal("0.00")})
            row["cost"] += (-movement.quantity_delta * movement.unit_cost).quantize(Decimal("0.01"))
        for row in grouped.values():
            row["cost"] = row["cost"].quantize(Decimal("0.01"))
            row["gross_profit"] = row["revenue"] - row["cost"]
        rows = sorted(grouped.values(), key=lambda item: item["product_name"])
        return Response({"rows": rows, "totals": {"revenue": sum((row["revenue"] for row in rows), Decimal("0.00")), "cost": sum((row["cost"] for row in rows), Decimal("0.00")), "gross_profit": sum((row["gross_profit"] for row in rows), Decimal("0.00"))}})


class SettlementReportView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        rows = Obligation.objects.filter(warehouse_id__in=scoped_warehouses(request), open_amount__gt=0, reversed_at__isnull=True).values("party_id", "party__name").annotate(
            receivable=Coalesce(Sum("open_amount", filter=Q(side=ObligationSide.RECEIVABLE)), Value(Decimal("0.00")), output_field=MONEY),
            payable=Coalesce(Sum("open_amount", filter=Q(side=ObligationSide.PAYABLE)), Value(Decimal("0.00")), output_field=MONEY),
        ).order_by("party__name")
        result = [{"party_id": row["party_id"], "party_name": row["party__name"], "receivable": row["receivable"], "payable": row["payable"], "balance": row["receivable"] - row["payable"]} for row in rows]
        return Response({"rows": result, "totals": {"receivable": sum((row["receivable"] for row in result), Decimal("0.00")), "payable": sum((row["payable"] for row in result), Decimal("0.00")), "balance": sum((row["balance"] for row in result), Decimal("0.00"))}})

