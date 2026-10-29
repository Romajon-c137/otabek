from rest_framework.exceptions import PermissionDenied

from .models import UserRole, WarehouseGrant


def role_for(user) -> str:
    if user.is_superuser:
        return UserRole.OWNER
    profile = getattr(user, "business_profile", None)
    return profile.role if profile else UserRole.CASHIER


def require_role(user, *roles: str) -> None:
    if role_for(user) not in roles:
        raise PermissionDenied("Недостаточно прав для этого действия.")


def require_warehouse(user, warehouse, capability: str = "can_view") -> None:
    if user.is_superuser:
        return
    allowed = WarehouseGrant.objects.filter(user=user, warehouse=warehouse, **{capability: True}).exists()
    if not allowed:
        raise PermissionDenied("Нет доступа к выбранному складу.")


def visible_warehouse_ids(user):
    if user.is_superuser:
        from modules.warehouses.models import Warehouse

        return Warehouse.objects.values_list("id", flat=True)
    return WarehouseGrant.objects.filter(user=user, can_view=True).values_list("warehouse_id", flat=True)

