from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from modules.common.models import TimeStampedModel
from modules.documents.models import TradeDocument
from modules.catalog.models import Product
from modules.parties.models import Party
from modules.warehouses.models import Warehouse


class ObligationSide(models.TextChoices):
    RECEIVABLE = "receivable", "Нам должны"
    PAYABLE = "payable", "Мы должны"


class Obligation(models.Model):
    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="obligations")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="obligations")
    side = models.CharField(max_length=12, choices=ObligationSide.choices)
    original_amount = models.DecimalField(max_digits=18, decimal_places=2)
    open_amount = models.DecimalField(max_digits=18, decimal_places=2)
    effective_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    source_document = models.ForeignKey(TradeDocument, null=True, blank=True, on_delete=models.PROTECT, related_name="obligations")
    source_payment = models.ForeignKey("Payment", null=True, blank=True, on_delete=models.PROTECT, related_name="created_obligations")
    product = models.ForeignKey(Product, null=True, blank=True, on_delete=models.PROTECT, related_name="obligations")
    original_quantity = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True)
    unit_price = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    reason = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_obligations")
    created_at = models.DateTimeField(auto_now_add=True)
    reversed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(original_amount__gt=0), name="obligation_original_positive"),
            models.CheckConstraint(condition=Q(open_amount__gte=0), name="obligation_open_nonnegative"),
            models.CheckConstraint(condition=Q(open_amount__lte=models.F("original_amount")), name="obligation_open_within_original"),
        ]
        indexes = [
            models.Index(fields=["party", "warehouse", "side", "effective_date", "id"], name="obligation_fifo_idx"),
            models.Index(fields=["warehouse", "open_amount"], name="obligation_open_warehouse_idx"),
        ]


class PaymentSequence(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="payment_sequences")
    year = models.PositiveSmallIntegerField()
    value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["warehouse", "year"], name="uq_payment_sequence_scope")]


class Payment(TimeStampedModel):
    class Direction(models.TextChoices):
        INCOMING = "incoming", "Приход"
        OUTGOING = "outgoing", "Расход"

    class Method(models.TextChoices):
        CASH = "cash", "Наличные"
        MBANK = "mbank", "МБанк"
        AIYL = "aiyl", "Айыл Банк"

    class Status(models.TextChoices):
        POSTED = "posted", "Проведена"
        VOIDED = "voided", "Отменена"

    number = models.CharField(max_length=48)
    direction = models.CharField(max_length=12, choices=Direction.choices)
    method = models.CharField(max_length=12, choices=Method.choices)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.POSTED)
    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="payments")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    effective_date = models.DateField()
    note = models.CharField(max_length=300, blank=True)
    source_document = models.ForeignKey(TradeDocument, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_payments")
    voided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="voided_payments")
    voided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["warehouse", "number"], name="uq_payment_number_warehouse"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive"),
        ]
        indexes = [models.Index(fields=["warehouse", "effective_date", "direction"], name="payment_report_idx")]


class SettlementApplication(models.Model):
    obligation = models.ForeignKey(Obligation, on_delete=models.PROTECT, related_name="applications")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.PROTECT, related_name="applications")
    offset_pair = models.CharField(max_length=64, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    reversed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="settlement_application_positive")]
        indexes = [models.Index(fields=["obligation", "created_at"], name="settle_obligation_time_idx")]


class SettlementMovement(models.Model):
    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name="settlement_movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="settlement_movements")
    event_type = models.CharField(max_length=32)
    receivable_delta = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    payable_delta = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    obligation = models.ForeignKey(Obligation, null=True, blank=True, on_delete=models.PROTECT, related_name="movements")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.PROTECT, related_name="movements")
    document = models.ForeignKey(TradeDocument, null=True, blank=True, on_delete=models.PROTECT, related_name="settlement_movements")
    description = models.CharField(max_length=300, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["party", "warehouse", "occurred_at"], name="settlement_party_time_idx")]

