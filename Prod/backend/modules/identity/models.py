from __future__ import annotations

from django.conf import settings
from django.db import models
from modules.common.models import TimeStampedModel
from modules.warehouses.models import Warehouse


class UserRole(models.TextChoices):
    OWNER = "owner", "Владелец"
    MANAGER = "manager", "Менеджер"
    CASHIER = "cashier", "Кассир"
    AUDITOR = "auditor", "Аудитор"


class UserProfile(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="business_profile")
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.CASHIER)
    display_name = models.CharField(max_length=160, blank=True)


class WarehouseGrant(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="warehouse_grants")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="user_grants")
    can_view = models.BooleanField(default=True)
    can_sell = models.BooleanField(default=False)
    can_manage_stock = models.BooleanField(default=False)
    can_manage_finance = models.BooleanField(default=False)
    can_manage_settings = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "warehouse"], name="uq_user_warehouse_grant")]
        indexes = [models.Index(fields=["user", "warehouse"], name="grant_user_warehouse_idx")]


class AccessToken(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="access_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    label = models.CharField(max_length=120, blank=True)

    @property
    def is_active(self) -> bool:
        from django.utils import timezone

        return self.revoked_at is None and self.expires_at > timezone.now()


class AccessAttempt(models.Model):
    username = models.CharField(max_length=150, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    outcome = models.CharField(max_length=24)
    request_id = models.CharField(max_length=80, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["username", "occurred_at"], name="attempt_user_time_idx")]

