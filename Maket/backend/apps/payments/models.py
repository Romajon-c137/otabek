import uuid
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class Payment(models.Model):
    class Direction(models.TextChoices):
        INCOMING = "incoming", "Получение"
        OUTGOING = "outgoing", "Выдача"

    document = models.OneToOneField("documents.Document", on_delete=models.CASCADE, primary_key=True, related_name="payment")
    direction = models.CharField(max_length=16, choices=Direction.choices)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    # документ (продажа, поступление), при проведении которого платёж создан; у платежей по долгу пусто
    source_document = models.ForeignKey("documents.Document", on_delete=models.SET_NULL, null=True, blank=True, related_name="source_payments")

    def __str__(self):
        return str(self.document)


class PaymentBreakdown(models.Model):
    class Method(models.TextChoices):
        CASH = "cash", "Наличные"
        MBANK = "mbank", "МБанк"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="breakdown")
    method = models.CharField(max_length=16, choices=Method.choices)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["payment", "method"], name="unique_payment_breakdown_method"),
        ]

# Create your models here.
