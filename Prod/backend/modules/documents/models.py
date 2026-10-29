from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from modules.catalog.models import Product
from modules.common.models import TimeStampedModel
from modules.parties.models import Party
from modules.warehouses.models import Warehouse


MONEY_STEP = Decimal("0.01")


class DocumentKind(models.TextChoices):
    OPENING = "opening", "Ввод остатков"
    RECEIPT = "receipt", "Поступление"
    SALE = "sale", "Продажа"
    CUSTOMER_RETURN = "customer_return", "Возврат покупателя"
    SUPPLIER_RETURN = "supplier_return", "Возврат поставщику"
    CUSTOMER_ORDER = "customer_order", "Заказ покупателя"


class DocumentStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    CONFIRMED = "confirmed", "На сборке"
    ASSEMBLED = "assembled", "Собран"
    POSTED = "posted", "Проведён"
    FULFILLED = "fulfilled", "Выполнен"
    CANCELLED = "cancelled", "Отменён"


class DocumentSequence(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="document_sequences")
    kind = models.CharField(max_length=24, choices=DocumentKind.choices)
    year = models.PositiveSmallIntegerField()
    value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["warehouse", "kind", "year"], name="uq_document_sequence_scope")]


class TradeDocument(TimeStampedModel):
    kind = models.CharField(max_length=24, choices=DocumentKind.choices)
    status = models.CharField(max_length=16, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT)
    number = models.CharField(max_length=48)
    effective_date = models.DateField()
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="documents")
    party = models.ForeignKey(Party, null=True, blank=True, on_delete=models.PROTECT, related_name="documents")
    note = models.TextField(blank=True)
    amount_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    document_discount_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_trade_documents")
    posted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="posted_trade_documents")
    posted_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="cancelled_trade_documents")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=300, blank=True)
    source_document = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="derived_documents")

    class Meta:
        ordering = ["-effective_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["warehouse", "kind", "number"], name="uq_document_number_per_kind_warehouse"),
            models.CheckConstraint(condition=Q(amount_total__gte=0), name="document_total_nonnegative"),
        ]
        indexes = [
            models.Index(fields=["warehouse", "kind", "status", "effective_date"], name="document_main_filter_idx"),
            models.Index(fields=["party", "effective_date"], name="document_party_date_idx"),
        ]

    def recalculate_total(self) -> Decimal:
        total = sum((line.line_total for line in self.lines.all()), Decimal("0.00"))
        return total.quantize(MONEY_STEP, rounding=ROUND_HALF_UP)


class TradeLine(models.Model):
    document = models.ForeignKey(TradeDocument, on_delete=models.CASCADE, related_name="lines")
    position = models.PositiveIntegerField()
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="trade_lines")
    source_line = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="return_lines")
    product_name = models.CharField(max_length=240)
    unit = models.CharField(max_length=12)
    quantity = models.DecimalField(max_digits=16, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    unit_price = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(0)])
    discount_amount = models.DecimalField(max_digits=16, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)])
    line_total = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(0)])
    allocated_extra_cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)])

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["document", "position"], name="uq_document_line_position"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="trade_line_quantity_positive"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="trade_line_price_nonnegative"),
            models.CheckConstraint(condition=Q(discount_amount__gte=0), name="trade_line_discount_nonnegative"),
            models.CheckConstraint(condition=Q(line_total__gte=0), name="trade_line_total_nonnegative"),
        ]
        indexes = [models.Index(fields=["document", "product"], name="trade_line_doc_product_idx")]


class NeighborSupply(models.Model):
    """Part of a sale line sourced from another supplier for this order."""

    line = models.OneToOneField(TradeLine, on_delete=models.CASCADE, related_name="neighbor_supply")
    supplier = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="neighbor_supplies")
    quantity = models.DecimalField(max_digits=16, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))])
    unit_price = models.DecimalField(max_digits=16, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="neighbor_supply_quantity_positive"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="neighbor_supply_price_nonnegative"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="neighbor_supply_amount_positive"),
        ]
        indexes = [models.Index(fields=["supplier", "line"], name="neighbor_supply_supplier_idx")]


class ReceiptExtraCost(models.Model):
    document = models.ForeignKey(TradeDocument, on_delete=models.CASCADE, related_name="extra_costs")
    name = models.CharField(max_length=160)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])

    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="receipt_extra_cost_positive")]

