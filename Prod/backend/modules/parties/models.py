from django.db import models
from modules.common.models import TimeStampedModel


class Party(TimeStampedModel):
    class Kind(models.TextChoices):
        CUSTOMER = "customer", "Покупатель"
        SUPPLIER = "supplier", "Поставщик"
        BOTH = "both", "Покупатель и поставщик"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=240)
    # Kept for compatibility with existing imports and clients. A person is
    # universal and can participate in any operation; new records use BOTH.
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.BOTH)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    note = models.TextField(blank=True)
    system_key = models.CharField(max_length=32, null=True, blank=True, unique=True)
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [models.Index(fields=["is_active", "kind", "name"], name="party_active_kind_name_idx")]

    def __str__(self):
        return f"{self.code} — {self.name}"

