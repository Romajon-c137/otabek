from decimal import Decimal

from django.db import models
from django.db.models import Q
from modules.catalog.models import Product
from modules.documents.models import TradeDocument, TradeLine
from modules.warehouses.models import Warehouse


class StockLevel(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_levels")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_levels")
    quantity = models.DecimalField(max_digits=18, decimal_places=3, default=Decimal("0.000"))
    reserved = models.DecimalField(max_digits=18, decimal_places=3, default=Decimal("0.000"))
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["warehouse", "product"], name="uq_stocklevel_warehouse_product"),
            models.CheckConstraint(condition=Q(quantity__gte=0), name="stocklevel_quantity_nonnegative"),
            models.CheckConstraint(condition=Q(reserved__gte=0), name="stocklevel_reserved_nonnegative"),
            models.CheckConstraint(condition=Q(reserved__lte=models.F("quantity")), name="stocklevel_reserved_not_above_quantity"),
        ]
        indexes = [models.Index(fields=["warehouse", "product"], name="stocklevel_lookup_idx")]

    @property
    def available(self):
        return self.quantity - self.reserved


class StockLot(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_lots")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_lots")
    source_line = models.ForeignKey(TradeLine, on_delete=models.PROTECT, related_name="created_lots")
    received_at = models.DateTimeField()
    initial_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    remaining_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=6)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(initial_quantity__gt=0), name="stocklot_initial_positive"),
            models.CheckConstraint(condition=Q(remaining_quantity__gte=0), name="stocklot_remaining_nonnegative"),
            models.CheckConstraint(condition=Q(remaining_quantity__lte=models.F("initial_quantity")), name="stocklot_remaining_within_initial"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="stocklot_cost_nonnegative"),
        ]
        indexes = [models.Index(fields=["warehouse", "product", "received_at", "id"], name="stocklot_fifo_idx")]


class StockMovement(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_movements")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_movements")
    document = models.ForeignKey(TradeDocument, on_delete=models.PROTECT, related_name="stock_movements")
    line = models.ForeignKey(TradeLine, on_delete=models.PROTECT, related_name="stock_movements")
    quantity_delta = models.DecimalField(max_digits=18, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=6)
    occurred_at = models.DateTimeField(auto_now_add=True)
    reversal_of = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="reversals")

    class Meta:
        indexes = [
            models.Index(fields=["warehouse", "product", "occurred_at"], name="movement_stock_time_idx"),
            models.Index(fields=["document", "line"], name="movement_document_line_idx"),
        ]


class FifoAllocation(models.Model):
    outbound_line = models.ForeignKey(TradeLine, on_delete=models.PROTECT, related_name="fifo_allocations")
    lot = models.ForeignKey(StockLot, on_delete=models.PROTECT, related_name="allocations")
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=6)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["outbound_line", "lot"], name="uq_fifo_line_lot"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="fifo_quantity_positive"),
        ]


class StockReservation(models.Model):
    order_line = models.OneToOneField(TradeLine, on_delete=models.PROTECT, related_name="reservation")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="reservations")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="reservations")
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(quantity__gt=0), name="reservation_quantity_positive")]
        indexes = [models.Index(fields=["warehouse", "product", "released_at"], name="reservation_active_idx")]

