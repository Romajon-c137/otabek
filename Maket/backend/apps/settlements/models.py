import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class Obligation(models.Model):
    class Side(models.TextChoices):
        RECEIVABLE = "receivable", "Нам должны"
        PAYABLE = "payable", "Мы должны"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    counterparty = models.ForeignKey("partners.Counterparty", on_delete=models.PROTECT, related_name="obligations")
    source_document = models.OneToOneField("documents.Document", on_delete=models.PROTECT, related_name="obligation")
    side = models.CharField(max_length=16, choices=Side.choices)
    original_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    open_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(open_amount__lte=models.F("original_amount")), name="obligation_open_not_over_original"),
        ]


class SettlementMovement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="settlement_movements")
    counterparty = models.ForeignKey("partners.Counterparty", on_delete=models.PROTECT, related_name="settlement_movements")
    obligation = models.ForeignKey(Obligation, on_delete=models.PROTECT, related_name="movements")
    signed_amount = models.DecimalField(max_digits=18, decimal_places=2)
    reversal_of = models.OneToOneField("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversal")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["document", "obligation"], name="unique_settlement_movement_document_obligation"),
        ]


class SettlementAllocation(models.Model):
    class Kind(models.TextChoices):
        PAYMENT = "payment", "Оплата"
        OFFSET = "offset", "Взаимозачёт"
        BUYER_RETURN = "buyer_return", "Возврат покупателя"
        SUPPLIER_RETURN = "supplier_return", "Возврат поставщику"
        REVERSAL = "reversal", "Сторно"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_document = models.ForeignKey("documents.Document", on_delete=models.PROTECT, related_name="settlement_allocations")
    obligation = models.ForeignKey(Obligation, on_delete=models.PROTECT, related_name="allocations")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    sequence = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "sequence"]
        constraints = [
            models.UniqueConstraint(fields=["source_document", "sequence"], name="unique_settlement_allocation_sequence"),
        ]
