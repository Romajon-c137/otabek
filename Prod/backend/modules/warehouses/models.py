from django.db import models
from modules.common.models import TimeStampedModel


class Warehouse(TimeStampedModel):
    code = models.CharField(max_length=24, unique=True)
    name = models.CharField(max_length=160)
    address = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [models.Index(fields=["is_active", "name"], name="warehouse_active_name_idx")]

    def __str__(self) -> str:
        return f"{self.code} — {self.name}"

