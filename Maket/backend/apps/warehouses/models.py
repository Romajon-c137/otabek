import uuid

from django.conf import settings
from django.db import models


class Warehouse(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "code"]

    def __str__(self):
        return self.name


class WarehouseAccess(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Администратор"
        SELLER = "seller", "Продавец"
        VIEWER = "viewer", "Просмотр"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="warehouse_accesses")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="user_accesses")
    role = models.CharField(max_length=16, choices=Role.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "warehouse"], name="unique_user_warehouse_access"),
        ]

    def __str__(self):
        return f"{self.user} — {self.warehouse} ({self.role})"

# Create your models here.
