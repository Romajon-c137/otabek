import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class StockBalance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, related_name="stock_balances")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="stock_balances")
    quantity = models.DecimalField(max_digits=18, decimal_places=3, default=0, validators=[MinValueValidator(Decimal("0.000"))])
    reserved = models.DecimalField(max_digits=18, decimal_places=3, default=0, validators=[MinValueValidator(Decimal("0.000"))])
    cost = models.DecimalField(max_digits=18, decimal_places=2, default=0, validators=[MinValueValidator(Decimal("0.00"))])
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["warehouse", "product"], name="unique_warehouse_product_balance"),
            models.CheckConstraint(condition=models.Q(quantity__gte=0), name="stock_quantity_nonnegative"),
            models.CheckConstraint(condition=models.Q(reserved__gte=0), name="stock_reserved_nonnegative"),
            models.CheckConstraint(condition=models.Q(cost__gte=0), name="stock_cost_nonnegative"),
            models.CheckConstraint(condition=models.Q(reserved__lte=models.F("quantity")), name="stock_reserved_not_over_quantity"),
        ]


class Lot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, related_name="lots")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="lots")
    source_document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="created_lots")
    source_line_id = models.UUIDField()
    initial_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    remaining_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    initial_cost = models.DecimalField(max_digits=18, decimal_places=2)
    remaining_cost = models.DecimalField(max_digits=18, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=6)
    received_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["received_at", "created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["source_document", "source_line_id"], name="unique_lot_source_line"),
            models.CheckConstraint(condition=models.Q(remaining_quantity__gte=0), name="lot_quantity_nonnegative"),
            models.CheckConstraint(condition=models.Q(remaining_cost__gte=0), name="lot_cost_nonnegative"),
        ]


class StockMovement(models.Model):
    class Kind(models.TextChoices):
        RECEIPT = "receipt", "Поступление"
        OPENING = "opening", "Начальный остаток"
        SALE = "sale", "Продажа"
        BUYER_RETURN = "buyer_return", "Возврат покупателя"
        SUPPLIER_RETURN = "supplier_return", "Возврат поставщику"
        REVERSAL = "reversal", "Сторно"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="stock_movements")
    source_line_id = models.UUIDField()
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, related_name="stock_movements")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="stock_movements")
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    signed_quantity = models.DecimalField(max_digits=18, decimal_places=3)
    signed_cost = models.DecimalField(max_digits=18, decimal_places=2)
    reversal_of = models.OneToOneField("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["document", "source_line_id", "lot", "kind"], name="unique_stock_movement_source"),
        ]


class FifoAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale_line = models.ForeignKey("documents.SaleLine", on_delete=models.PROTECT, related_name="fifo_allocations")
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name="fifo_allocations")
    ordinal = models.PositiveIntegerField()
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    cost = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        ordering = ["sale_line", "ordinal"]
        constraints = [
            models.UniqueConstraint(fields=["sale_line", "ordinal"], name="unique_fifo_allocation_ordinal"),
            models.UniqueConstraint(fields=["sale_line", "lot"], name="unique_fifo_allocation_lot"),
        ]


class ReturnLotAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    return_line = models.ForeignKey("documents.BuyerReturnLine", on_delete=models.PROTECT, related_name="lot_allocations")
    original_allocation = models.ForeignKey(FifoAllocation, on_delete=models.PROTECT, related_name="return_allocations")
    ordinal = models.PositiveIntegerField()
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    cost = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        ordering = ["return_line", "ordinal"]
        constraints = [
            models.UniqueConstraint(fields=["return_line", "ordinal"], name="unique_return_lot_allocation_ordinal"),
            models.UniqueConstraint(fields=["return_line", "original_allocation"], name="unique_return_original_allocation"),
        ]


class Reservation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_line = models.OneToOneField("documents.CustomerOrderLine", on_delete=models.PROTECT, related_name="reservation")
    warehouse = models.ForeignKey("warehouses.Warehouse", on_delete=models.PROTECT, related_name="reservations")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, related_name="reservations")
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    reserved_at = models.DateTimeField(auto_now_add=True)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["warehouse", "product", "released_at"])]


class SupplierReturnLotAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    return_line = models.ForeignKey("documents.SupplierReturnLine", on_delete=models.PROTECT, related_name="lot_allocations")
    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name="supplier_return_allocations")
    ordinal = models.PositiveIntegerField()
    quantity = models.DecimalField(max_digits=18, decimal_places=3)
    cost = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        ordering = ["return_line", "ordinal"]
        constraints = [
            models.UniqueConstraint(fields=["return_line", "ordinal"], name="unique_supplier_return_lot_ordinal"),
            models.UniqueConstraint(fields=["return_line", "lot"], name="unique_supplier_return_lot"),
        ]

# Create your models here.
